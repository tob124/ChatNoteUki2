import { afterEach, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../../electron/store";
import { observeInbox } from "../../electron/inbox";
import { SyncEngine } from "../../electron/webdav";
import { FakeDav } from "./fake-dav";
import { AiQueue } from "../../electron/ai";
import { settingsSchema } from "../../src/shared";
const stores: Store[] = [];
const open = (path = ":memory:") => {
  const s = new Store(path);
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture(s: Store) {
  const t = s.thread({
    title: "旧问题",
    description: "旧说明",
    parentId: null,
  });
  const n = s.createNote({ raw: "最初正文", threadId: t });
  const { edition, ...old } = n;
  s.append("note.added", old);
  s.append("note.corrected", { id: n.id, raw: "最后更正的正文" });
  s.append("note.titled", { id: n.id, title: "不导入的手动标题" });
  s.append("note.completed", {
    id: n.id,
    threadId: t,
    inputRevision: 1,
    result: {
      threadId: t,
      newThreadTitle: null,
      title: "旧标题",
      synopsis: "旧摘要",
      reply: "旧回答",
    },
  });
  s.capture({
    raw: "不导入的追问",
    threadId: t,
    mode: "discussion",
    parentNoteId: n.id,
  });
  s.capture({ raw: "重复正文" });
  s.capture({ raw: "重复正文" });
  s.addTask("recap", t, "deepseek-flash");
  return n;
}
it("reenters latest root bodies in order with fresh IDs and no old derived data or dialogue", () => {
  const s = open(),
    original = fixture(s);
  s.reimportRawNotes();
  const state = s.snapshot();
  expect(state.notes.map((n) => n.raw)).toEqual([
    "最后更正的正文",
    "重复正文",
    "重复正文",
  ]);
  expect(state.notes[0].id).not.toBe(original.id);
  expect(state.notes[0].createdAt).toBe(original.createdAt);
  for (const n of state.notes)
    expect(n).toMatchObject({
      status: "pending",
      threadId: null,
      reply: null,
      synopsis: "待生成",
      revision: 0,
      legacy: false,
      edition: 3,
      mode: "note",
    });
  expect(state.threads).toEqual([]);
  expect(state.cognitions).toEqual([]);
  expect(state.tasks).toEqual([]);
  expect(state.structures).toEqual([]);
  expect(s.workspace({ workspace: "all", query: "旧摘要" }).items).toEqual([]);
  const seq = s.latestSeq();
  s.reimportRawNotes();
  expect(s.latestSeq()).toBe(seq);
  const restored = open();
  restored.appendMany(s.eventsAfter().map((r) => r.event));
  restored.reimportRawNotes();
  expect(restored.snapshot()).toEqual(state);
});
it("backs up the old database and rebuilds new projections without repeating reentry", () => {
  const path = join(mkdtempSync(join(tmpdir(), "uki-raw-")), "thoughts.db");
  const s = new Store(path);
  const old = fixture(s);
  s.reimportRawNotes();
  const expected = s.snapshot(),
    backup = s.getMeta("rawReimportBackup")!;
  expect(existsSync(backup)).toBe(true);
  expect(open(backup).note(old.id).currentRaw).toBe("最后更正的正文");
  s.close();
  const db = new DatabaseSync(path);
  db.prepare(
    "UPDATE meta SET value='broken' WHERE key='projectionVersion'",
  ).run();
  db.close();
  const reopened = open(path);
  reopened.reimportRawNotes();
  expect(reopened.snapshot()).toEqual(expected);
});
it("rolls back the entire raw reset and retries safely after interrupted projection writes", () => {
  const path = join(
      mkdtempSync(join(tmpdir(), "uki-raw-fail-")),
      "thoughts.db",
    ),
    s = open(path);
  fixture(s);
  const before = s.snapshot(),
    seq = s.latestSeq();
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TRIGGER fail_raw BEFORE INSERT ON entities_v2 WHEN NEW.kind='notes' BEGIN SELECT RAISE(ABORT,'simulated crash'); END;",
  );
  expect(() => s.reimportRawNotes()).toThrow("simulated crash");
  expect(s.snapshot()).toEqual(before);
  expect(s.latestSeq()).toBe(seq);
  expect(s.getMeta("rawReimport")).toBeNull();
  db.exec("DROP TRIGGER fail_raw");
  db.close();
  s.reimportRawNotes();
  expect(s.snapshot().notes).toHaveLength(3);
});
it("preserves unfinished inbox receipts and daily budget accounting during reentry", () => {
  const s = open();
  fixture(s);
  observeInbox(s, "手机正文", '"one"');
  const usage = s.event("usage.recorded", {
    id: crypto.randomUUID(),
    input: 100,
    output: 30,
    model: "deepseek-flash",
    createdAt: new Date().toISOString(),
  });
  s.appendMany([usage]);
  const batches = s.snapshot().batches;
  s.reimportRawNotes();
  expect(s.snapshot().batches).toEqual(batches);
  expect(s.dataReport().usage.input).toBe(100);
  observeInbox(s, "手机正文", '"one"');
  expect(s.snapshot().notes).toHaveLength(4);
  observeInbox(s, "手机正文\n\n新增正文", '"two"');
  expect(s.snapshot().notes).toHaveLength(5);
});
it("publishes format 3 and restores reentered data without another AI request or duplicate notes", async () => {
  const s = open(),
    dav = new FakeDav();
  fixture(s);
  s.reimportRawNotes();
  await new SyncEngine(s, dav).backup();
  expect(JSON.parse(dav.files.get("manifest.json")!).schemaVersion).toBe(3);
  const restored = open();
  await new SyncEngine(restored, dav).restore();
  expect(restored.snapshot()).toEqual(s.snapshot());
  const seq = restored.latestSeq();
  restored.reimportRawNotes();
  expect(restored.latestSeq()).toBe(seq);
});
it("leaves records made by the new edition intact on subsequent starts", () => {
  const s = open(),
    id = s.capture({ raw: "新软件原文" });
  s.append("note.titled", { id, title: "我的标题" });
  const seq = s.latestSeq();
  s.reimportRawNotes();
  expect(s.latestSeq()).toBe(seq);
  expect(s.note(id).title).toBe("我的标题");
});
it("prioritizes fresh input and retains raw imports as pending until the next budget day", async () => {
  const s = open();
  fixture(s);
  s.reimportRawNotes();
  const fresh = s.capture({ raw: "刚刚输入的新想法" });
  expect(s.nextNote()?.id).toBe(fresh);
  s.append("usage.recorded", {
    id: crypto.randomUUID(),
    input: 1,
    output: 0,
    model: "deepseek-flash",
    createdAt: new Date().toISOString(),
  });
  let calls = 0;
  const config = {
    apiKey: () => "test-only",
    settings: () => settingsSchema.parse({ dailyInputLimit: 8000 }),
  };
  const ai = new AiQueue(s, config, () => {}, {
    complete: async () => {
      calls++;
      return {
        input: 1,
        output: 1,
        content: JSON.stringify({
          threadId: null,
          newThreadTitle: null,
          title: "想法",
          synopsis: "",
          reply: "继续想想",
        }),
      };
    },
  });
  await ai.pump();
  expect(calls).toBe(0);
  expect(s.note(fresh).status).toBe("pending");
  const seq = s.latestSeq();
  await ai.pump();
  expect(s.latestSeq()).toBe(seq);
  s.setMeta("noteBudgetDay", "2000-01-01");
  config.settings = () => settingsSchema.parse({});
  await ai.pump();
  expect(calls).toBe(4);
  expect(s.snapshot().notes.every((n) => n.status === "done")).toBe(true);
});
