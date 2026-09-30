import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../../electron/store";
import { emptyContent } from "../../src/shared";
const stores: Store[] = [];
const folders: string[] = [];
function open(path = ":memory:") {
  const s = new Store(path);
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of folders.splice(0))
    rmSync(d, { recursive: true, force: true });
});
describe("durable thoughts", () => {
  it("saves before AI and survives a restart without changing original CRLF text", () => {
    const dir = mkdtempSync(join(tmpdir(), "uki-test-"));
    folders.push(dir);
    const path = join(dir, "thoughts.db");
    const a = new Store(path);
    const id = a.capture({ raw: "城市密度\r\n需要保留原话" });
    a.append("note.started", { id });
    a.close();
    const b = open(path);
    b.recoverInterrupted();
    const note = b.snapshot().notes[0];
    expect(note.raw).toBe("城市密度\r\n需要保留原话");
    expect(note.status).toBe("failed");
    expect(note.synopsis).toBe("待生成");
  });
  it("searches Chinese originals, AI titles, synopses and short literal keywords", () => {
    const s = open();
    const id = s.capture({ raw: "我对城市密度的看法" });
    const tid = randomUUID();
    s.append("thread.added", {
      id: tid,
      title: "规划",
      createdAt: new Date().toISOString(),
    });
    s.append("note.completed", {
      id,
      threadId: tid,
      result: {
        threadId: tid,
        newThreadTitle: null,
        title: "公共交通的条件",
        synopsis: "交通能力影响住宅规模。",
        reply: "高密度是否必然带来拥堵？",
      },
    });
    for (const q of ["密度", "公共交通", "住宅规模", "拥堵", "看法"])
      expect(s.search(q).map((n) => n.id)).toContain(id);
    expect(s.search("%")).toHaveLength(0);
    expect(s.search("城市 拥堵")).toHaveLength(1);
  });
  it("requires approval, preserves history and blocks stale proposals", () => {
    const s = open();
    const id = s.capture({ raw: "我开始重新考虑职业路线" });
    const tid = randomUUID();
    s.append("thread.added", {
      id: tid,
      title: "职业",
      createdAt: new Date().toISOString(),
    });
    const make = () => ({
      id: randomUUID(),
      threadId: tid,
      baseVersion: 0,
      before: emptyContent(),
      after: { ...emptyContent(), viewpoint: "仍需更多信息" },
      reason: "原话表达了不确定性",
      evidenceIds: [id],
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    const a = make(),
      b = make();
    s.append("proposal.added", a);
    s.append("proposal.added", b);
    expect(s.cognition(tid).version).toBe(0);
    s.append("proposal.resolved", {
      id: a.id,
      decision: "accept",
      content: { ...a.after, viewpoint: "我希望先做小规模尝试" },
    });
    expect(s.cognition(tid).viewpoint).toBe("我希望先做小规模尝试");
    expect(() =>
      s.append("proposal.resolved", { id: b.id, decision: "accept" }),
    ).toThrow("过期");
    s.append("proposal.resolved", { id: b.id, decision: "reject" });
    expect(s.cognition(tid).version).toBe(1);
    expect(s.snapshot().notes[0].raw).toBe("我开始重新考虑职业路线");
    expect(
      s.eventsAfter().some((r) => r.event.type === "proposal.resolved"),
    ).toBe(true);
  });
  it("replays idempotently and rejects a damaged batch atomically", () => {
    const a = open(),
      b = open();
    a.capture({ raw: "记录" });
    const events = a.eventsAfter().map((r) => r.event);
    b.appendMany(events);
    b.appendMany(events);
    expect(b.snapshot()).toEqual(a.snapshot());
    const bad = b.event("note.moved", {
      id: randomUUID(),
      threadId: randomUUID(),
    });
    expect(() => b.appendMany([...events, bad])).toThrow();
    expect(b.latestSeq()).toBe(1);
  });
});
