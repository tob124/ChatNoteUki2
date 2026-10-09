import { afterEach, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "../../electron/store";
import { AiQueue } from "../../electron/ai";
import { settingsSchema } from "../../src/shared";
import { exportNotes } from "../../electron/export-notes";
import { SyncEngine } from "../../electron/webdav";
import { FakeDav } from "./fake-dav";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const open = () => {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function material(s: Store) {
  const id = randomUUID(),
    text = "外部作者认为：需要区分相关关系和因果关系。",
    sha256 = hash(text);
  s.append("material.updated", {
    id,
    value: {
      id,
      name: "中文参考.txt",
      format: "txt",
      bytes: Buffer.byteLength(text),
      sha256,
      chunks: [{ sha256, bytes: Buffer.byteLength(text) }],
      noteId: null,
      createdAt: new Date().toISOString(),
      revision: 0,
      status: "done",
      error: null,
      coverage: "全部文字",
      segments: [{ id: 1, page: null, paragraph: 1, text }],
      summary: "",
      summaries: [],
    },
  });
  return {
    id,
    text,
    quote: {
      materialId: id,
      sha256,
      segmentId: 1,
      start: 7,
      end: text.length,
      text: text.slice(7),
    },
  };
}
it("persists named query conditions, renames without duplicating, replays deletion, and rejects missing scopes", () => {
  const s = open(),
    condition = {
      name: "因果",
      workspace: "all",
      query: "因果",
      includeHistory: true,
    };
  const id = s.saveQuery(condition);
  const count = s.latestSeq();
  s.saveQuery({ ...condition, id });
  expect(s.latestSeq()).toBe(count);
  s.saveQuery({ ...condition, id, name: "核对因果" });
  const restored = open();
  restored.appendMany(s.eventsAfter().map((r) => r.event));
  expect(restored.savedQueries()).toEqual(s.savedQueries());
  expect(restored.savedQueries()[0].includeHistory).toBe(true);
  s.deleteQuery(id);
  restored.appendMany(s.eventsAfter().map((r) => r.event));
  expect(restored.savedQueries()).toEqual([]);
  expect(() => s.saveQuery({ ...condition, workspace: randomUUID() })).toThrow(
    "不存在",
  );
  expect(() => s.saveQuery({ ...condition, id })).toThrow("已删除");
});
it("captures user thought separately from an exact excerpt, supports idempotence, and exports labelled provenance", () => {
  const s = open(),
    m = material(s),
    input = {
      clientId: randomUUID(),
      raw: "我需要重新核对自己的推论。",
      threadId: null,
      quote: m.quote,
    };
  const id = s.captureExcerpt(input);
  expect(s.captureExcerpt(input)).toBe(id);
  const assigned = s.thread({
    title: "后来的人工归属",
    description: "",
    parentId: null,
  });
  s.append("note.moved", { id, threadId: assigned });
  expect(s.captureExcerpt(input)).toBe(id);
  expect(s.note(id).threadId).toBe(assigned);
  expect(s.note(id).raw).toBe(input.raw);
  expect(s.note(id).raw).not.toContain(m.text);
  expect(s.quoteSource(id).current).toBe(true);
  expect(s.workspace({ workspace: "all" }).items[0].value).toMatchObject({
    materialQuote: { text: "" },
  });
  const output = [...exportNotes(s, [s.note(id)])].join("");
  expect(output).toContain("参考摘录（非用户原话）");
  expect(output).toContain(m.quote.text);
  expect(() =>
    s.captureExcerpt({
      ...input,
      clientId: randomUUID(),
      quote: { ...m.quote, start: 0 },
    }),
  ).toThrow();
  expect(() =>
    s.captureExcerpt({
      ...input,
      clientId: randomUUID(),
      quote: { ...m.quote, sha256: "f".repeat(64) },
    }),
  ).toThrow("变化");
});
it("does not present removed source text, keeps the user's thought, and redacts quote snapshots on permanent deletion and replay", () => {
  const s = open(),
    m = material(s),
    id = s.captureExcerpt({
      clientId: randomUUID(),
      raw: "我的独立理解应该保留",
      quote: m.quote,
      threadId: null,
    });
  s.append("material.updated", {
    id: m.id,
    value: { deletedAt: new Date().toISOString() },
  });
  const draftKey = `excerpt:${m.id}:1:7:100`;
  s.workspaceState(draftKey, {
    draft: JSON.stringify({ raw: "未提交的理解", quote: m.quote }),
    mode: "note",
    parentNoteId: null,
    openIds: [],
  });
  expect(s.quoteSource(id).material).toBe(null);
  expect([...exportNotes(s, [s.note(id)])].join("")).not.toContain(
    m.quote.text,
  );
  s.append("material.updated", {
    id: m.id,
    value: { purged: true, segments: [], summary: "", summaries: [] },
  });
  expect(JSON.stringify(s.eventsAfter())).not.toContain(m.text);
  expect(s.note(id).materialQuote?.text).toBe("资料已删除");
  expect(s.workspaceState(draftKey).draft).not.toContain(m.quote.text);
  expect(JSON.parse(s.workspaceState(draftKey).draft).raw).toBe("未提交的理解");
  const restored = open();
  restored.appendMany(s.eventsAfter().map((r) => r.event));
  expect(restored.note(id).raw).toBe("我的独立理解应该保留");
  expect(restored.note(id).materialQuote?.text).toBe("资料已删除");
});
it("detects changed extraction even when original file identity stays the same", () => {
  const s = open(),
    m = material(s),
    id = s.captureExcerpt({
      clientId: randomUUID(),
      raw: "我的理解",
      quote: m.quote,
      threadId: null,
    });
  s.append("material.updated", {
    id: m.id,
    value: {
      segments: [{ id: 1, page: null, paragraph: 1, text: "新版提取文字" }],
    },
  });
  expect(s.quoteSource(id).current).toBe(false);
  expect(s.quoteSource(id).quote.text).toBe(m.quote.text);
});
function queue(s: Store, complete: any, contextTokens = 32768) {
  return new AiQueue(
    s,
    {
      apiKey: () => "mock-key",
      settings: () => settingsSchema.parse({ contextTokens }),
    },
    () => {},
    { complete },
  );
}
it("analyzes exactly selected latest bodies, deduplicates queued operations, and restores global recap and saved query from format 6", async () => {
  const s = open(),
    ids = ["第一条想法", "第二条判断", "不要装入的其他想法"].map((raw) =>
      s.capture({ raw }),
    );
  ids.forEach((id) => s.append("note.failed", { id, error: "mock" }));
  const complete = vi.fn(async (_key, _model, _system, context) => {
    const payload = JSON.parse(context);
    expect(payload.history.map((n: any) => n.raw).sort()).toEqual(
      ["第一条想法", "第二条判断"].sort(),
    );
    return {
      content: JSON.stringify({
        expressed: "用户关注两个相关问题",
        possible: "仍需核对",
        questions: "继续观察？",
        evidenceIds: ids.slice(0, 2),
      }),
      input: 100,
      output: 30,
    };
  });
  const q = queue(s, complete),
    input = {
      question: "这两条之间有什么联系？",
      notes: ids.slice(0, 2).map((noteId) => ({ noteId, revision: 0 })),
    };
  const task = q.queueSelection(input);
  expect(
    q.queueSelection({ ...input, notes: input.notes.slice().reverse() }),
  ).toBe(task);
  await q.pump();
  expect(s.task(task).status, s.task(task).error ?? "").toBe("done");
  expect(complete).toHaveBeenCalledTimes(1);
  const recap = s.snapshot().recaps![0];
  expect(recap).toMatchObject({
    scope: "selection",
    threadId: null,
    total: 2,
    sampled: 2,
    question: input.question,
  });
  expect(s.workspace({ workspace: "review" }).items).toHaveLength(1);
  s.saveQuery({ name: "我的范围", workspace: "all", query: "想法" });
  const dav = new FakeDav();
  await new SyncEngine(s, dav, () => {}).backup();
  expect(JSON.parse(dav.files.get("manifest.json")!).schemaVersion).toBe(6);
  const restored = open();
  await new SyncEngine(restored, dav, () => {}).restore();
  expect(restored.savedQueries()).toEqual(s.savedQueries());
  expect(restored.snapshot().recaps).toEqual([recap]);
});
it.each(["correction", "assignment", "delete"])(
  "does not apply selected analysis after concurrent %s",
  async (kind) => {
    const s = open(),
      id = s.capture({ raw: "当时的判断" });
    s.append("note.failed", { id, error: "mock" });
    const q = queue(s, async () => {
      if (kind === "correction")
        s.append("note.corrected", { id, raw: "后来更正" });
      else if (kind === "assignment")
        s.append("note.moved", { id, threadId: null });
      else s.append("note.trashed", { id });
      return {
        content: JSON.stringify({
          expressed: "旧结论",
          possible: "",
          questions: "",
          evidenceIds: [id],
        }),
        input: 10,
        output: 10,
      };
    });
    const task = q.queueSelection({
      question: "这个判断有哪些变化",
      notes: [{ noteId: id, revision: 0 }],
    });
    await q.pump();
    expect(["failed", "cancelled"]).toContain(s.task(task).status);
    expect(s.snapshot().recaps).toHaveLength(0);
  },
);
it("rejects stale or excessive selection before making paid requests", () => {
  const s = open(),
    id = s.capture({ raw: "很长的中文观点。".repeat(6000) }),
    complete = vi.fn(),
    q = queue(s, complete, 32768);
  expect(() =>
    q.queueSelection({
      question: "核对范围和判断",
      notes: [{ noteId: id, revision: 1 }],
    }),
  ).toThrow("更正");
  expect(() =>
    q.queueSelection({
      question: "核对范围和判断",
      notes: [{ noteId: id, revision: 0 }],
    }),
  ).toThrow("容量");
  expect(complete).not.toHaveBeenCalled();
  expect(s.tasks()).toHaveLength(0);
});

it("keeps late AI response text out of caches after an excerpt source is purged", async () => {
  const s = open(),
    m = material(s),
    id = s.captureExcerpt({
      clientId: randomUUID(),
      raw: "自己的判断",
      quote: m.quote,
      threadId: null,
    });
  const q = queue(
    s,
    async (_key: any, _model: any, _system: any, context: string) => {
      expect(JSON.parse(context).referenceExcerpt).toMatchObject({
        materialId: m.id,
        text: m.quote.text,
      });
      s.append("material.updated", {
        id: m.id,
        value: {
          purged: true,
          deletedAt: new Date().toISOString(),
          segments: [],
          summary: "",
          summaries: [],
        },
      });
      return {
        content: JSON.stringify({
          threadId: null,
          newThreadTitle: null,
          title: "自己的判断",
          synopsis: "",
          reply: m.quote.text,
        }),
        input: 10,
        output: 10,
      };
    },
  );
  await q.pump();
  expect(s.note(id).reply).toBe(null);
  expect(s.note(id).error).toContain("摘录");
  const cache = s.metaKeys("ai-step:" + id + ":").map((k) => s.getMeta(k));
  expect(JSON.stringify(cache)).not.toContain(m.quote.text);
  expect(s.note(id).raw).toBe("自己的判断");
});
