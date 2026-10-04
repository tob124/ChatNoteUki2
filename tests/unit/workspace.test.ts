import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../../electron/store";
import { AiQueue, type AiTransport } from "../../electron/ai";
import {
  isShortNote,
  settingsSchema,
  type StructureProposal,
} from "../../src/shared";
import { SyncEngine } from "../../electron/webdav";
import { FakeDav } from "./fake-dav";
const stores: Store[] = [];
const open = (path = ":memory:") => {
  const s = new Store(path);
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const suggestion = (
  s: Store,
  ids: string[],
  kind: StructureProposal["kind"] = "create",
  extra = {},
) =>
  s.addStructure({
    kind,
    title: "一个宽泛问题",
    description: "讨论范围",
    parentId: null,
    targetId: null,
    sourceIds: [],
    noteIds: ids,
    reason: "同一问题的原文依据",
    evidence: ids.map((noteId) => ({
      noteId,
      revision: s.note(noteId).revision ?? 0,
    })),
    ...extra,
  })!;
const config = {
  apiKey: () => "test-only",
  settings: () => settingsSchema.parse({}),
};
describe("versioned library and workspace", () => {
  it("starts from healthy projections without replaying the library", () => {
    const path = join(mkdtempSync(join(tmpdir(), "uki-start-")), "thoughts.db");
    const s = new Store(path);
    s.capture({ raw: "启动不重放" });
    s.close();
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER forbid_rebuild BEFORE DELETE ON entities_v2 BEGIN SELECT RAISE(ABORT,'unexpected replay'); END;",
    );
    db.close();
    const reopened = open(path);
    expect(reopened.workspace({ workspace: "all" }).items).toHaveLength(1);
  });
  it("consolidates matching pending questions and allows an explicit existing target with safe undo", () => {
    const s = open(),
      a = s.capture({ raw: "第一条" }),
      b = s.capture({ raw: "第二条" });
    const p = suggestion(s, [a]);
    expect(suggestion(s, [b])).toBe(p);
    expect(s.structure(p).noteIds).toEqual([a, b]);
    const target = s.thread({
      title: "已有宽泛问题",
      description: "",
      parentId: null,
    });
    s.resolveStructures([p], "accept", target);
    expect(s.note(a).threadId).toBe(target);
    expect(s.note(b).threadId).toBe(target);
    s.append("structure.undone", { id: p });
    expect(s.threads().find((t) => t.id === target)?.archived).toBe(false);
    expect(s.note(a).threadId).toBeNull();
  });
  it("expires merge suggestions when a new source note arrives, and guards undo after later target activity", () => {
    const s = open(),
      a = s.thread({ title: "来源", description: "", parentId: null }),
      b = s.thread({ title: "目标", description: "", parentId: null }),
      id = s.capture({ raw: "原文", threadId: a });
    const p = suggestion(s, [id], "merge", { sourceIds: [a, b], targetId: b });
    s.capture({ raw: "新增依据", threadId: a });
    expect(() => s.resolveStructures([p], "accept", b)).toThrow("过期");
    const fresh = suggestion(s, [id], "merge", {
      sourceIds: [a, b],
      targetId: a,
    });
    s.resolveStructures([fresh], "accept", b);
    s.capture({ raw: "目标后续记录", threadId: b });
    expect(() => s.append("structure.undone", { id: fresh })).toThrow(
      "后续修改",
    );
  });
  it("retains the starting version in a discussion, moves its lineage together, and searches the discussion itself", () => {
    const s = open(),
      a = s.thread({ title: "甲", description: "", parentId: null }),
      b = s.thread({ title: "乙", description: "", parentId: null }),
      id = s.capture({ raw: "初始原文", threadId: a });
    s.append("note.corrected", { id, raw: "后来更正" });
    const discussion = s.capture({
      raw: "针对旧文字的讨论",
      mode: "discussion",
      threadId: a,
      parentNoteId: id,
      parentRevision: 0,
    });
    s.append("note.moved", { id, threadId: b });
    expect(s.note(discussion)).toMatchObject({
      threadId: b,
      parentRevision: 0,
    });
    expect(
      s.workspace({ workspace: b, query: "旧文字" }).items[0].value.id,
    ).toBe(discussion);
  });
  it("backs up and migrates a legacy library once, preserving original metadata, sources and cognition through replay", () => {
    const s = open(join(mkdtempSync(join(tmpdir(), "uki-v2-")), "thoughts.db"));
    const t = s.thread({ title: "历史问题", description: "", parentId: null });
    const n = s.createNote({ raw: "历史原文", threadId: t });
    const { revision, assignmentRevision, legacy, parentNoteId, ...old } = n;
    s.append("note.added", old);
    s.append("note.completed", {
      id: n.id,
      threadId: t,
      result: {
        threadId: t,
        newThreadTitle: null,
        title: "历史标题",
        synopsis: "已有摘要",
        reply: "已有回应",
      },
    });
    s.migrateV2();
    const after = s.latestSeq();
    expect(existsSync(s.getMeta("upgradeBackup")!)).toBe(true);
    s.migrateV2();
    expect(s.latestSeq()).toBe(after);
    expect(s.note(n.id)).toMatchObject({
      raw: "历史原文",
      title: "历史标题",
      synopsis: "已有摘要",
      reply: "已有回应",
      threadId: null,
      originalThreadId: t,
    });
    expect(s.threads()[0].archived).toBe(true);
    const restored = open();
    restored.appendMany(s.eventsAfter().map((r) => r.event));
    restored.migrateV2();
    expect(restored.snapshot()).toEqual(s.snapshot());
    const backup = open(s.getMeta("upgradeBackup")!);
    expect(backup.note(n.id).threadId).toBe(t);
  });
  it("rolls back a migration and its projection if a later event fails", () => {
    const s = open();
    const id = s.capture({ raw: "保留" });
    const seq = s.latestSeq();
    expect(() =>
      s.appendMany([
        s.event("library.migrated", { version: 2 }),
        s.event("note.moved", { id, threadId: randomUUID() }),
      ]),
    ).toThrow();
    expect(s.latestSeq()).toBe(seq);
    expect(s.getMeta("migrationV2")).toBeNull();
    expect(s.note(id).legacy).toBe(false);
  });
  it("enforces two levels and prevents cycles while supporting manual metadata and archive", () => {
    const s = open();
    const root = s.thread({
        title: "根问题",
        description: "范围",
        parentId: null,
      }),
      child = s.thread({ title: "子问题", description: "", parentId: root });
    expect(() =>
      s.thread({ title: "第三层", description: "", parentId: child }),
    ).toThrow("两层");
    expect(() =>
      s.thread({ id: root, title: "根问题", description: "", parentId: child }),
    ).toThrow();
    expect(() =>
      s.thread({
        id: root,
        title: "根问题",
        description: "",
        parentId: null,
        archived: true,
      }),
    ).toThrow("子问题");
    s.thread({
      id: child,
      title: "更名",
      description: "新的范围",
      parentId: root,
      archived: true,
    });
    expect(s.threads()[1]).toMatchObject({ title: "更名", archived: true });
  });
  it("keeps original and correction versions, and locks manual title and assignment against later AI", () => {
    const s = open(),
      t = s.thread({ title: "指定问题", description: "", parentId: null }),
      id = s.capture({ raw: "初始原文" });
    s.append("note.corrected", { id, raw: "更正原文" });
    s.append("note.titled", { id, title: "自己的标题" });
    s.append("note.moved", { id, threadId: t });
    s.append("note.completed", {
      id,
      inputRevision: 1,
      threadId: null,
      result: {
        threadId: null,
        newThreadTitle: null,
        title: "AI 标题",
        synopsis: "",
        reply: "进一步追问",
      },
    });
    expect(s.note(id)).toMatchObject({
      raw: "初始原文",
      currentRaw: "更正原文",
      title: "自己的标题",
      threadId: t,
    });
    expect(s.detail(id).revisions.map((r) => r.raw)).toEqual([
      "初始原文",
      "更正原文",
    ]);
    expect(
      s.workspace({ workspace: "all", query: "初始", includeHistory: true })
        .items,
    ).toHaveLength(1);
  });
  it("deduplicates rejected suggestions with identical evidence and expires suggestions on corrected evidence", () => {
    const s = open(),
      id = s.capture({ raw: "想法" }),
      proposal = suggestion(s, [id]);
    s.resolveStructures([proposal], "reject");
    expect(suggestion(s, [id])).toBeNull();
    s.append("note.corrected", { id, raw: "新增依据" });
    const p = suggestion(s, [id]);
    expect(p).toBeTruthy();
    s.append("note.corrected", { id, raw: "再次更正" });
    expect(() => s.resolveStructures([p], "accept")).toThrow("过期");
    expect(s.threads()).toHaveLength(0);
  });
  it("approves several assignments atomically and rejects a stale assignment version", () => {
    const s = open(),
      t = s.thread({ title: "目标", description: "", parentId: null }),
      a = s.capture({ raw: "甲" }),
      b = s.capture({ raw: "乙" });
    const one = suggestion(s, [a], "assign", { targetId: t }),
      two = suggestion(s, [b], "assign", { targetId: t });
    s.append("note.moved", { id: b, threadId: null });
    expect(() => s.resolveStructures([one, two], "accept")).toThrow("过期");
    expect(s.note(a).threadId).toBeNull();
    expect(s.structure(one).status).toBe("pending");
  });
  it("merges into the selected target and guards undo against subsequent corrections", () => {
    const s = open(),
      a = s.thread({ title: "甲", description: "", parentId: null }),
      b = s.thread({ title: "乙", description: "", parentId: null }),
      id = s.capture({ raw: "来源原文", threadId: a });
    const p = suggestion(s, [id], "merge", { sourceIds: [a, b], targetId: b });
    s.resolveStructures([p], "accept", b);
    expect(s.note(id).threadId).toBe(b);
    expect(s.threads()[0].archived).toBe(true);
    s.append("structure.undone", { id: p });
    expect(s.note(id).threadId).toBe(a);
    expect(s.threads()[0].archived).toBe(false);
    const next = suggestion(s, [id], "merge", {
      sourceIds: [a, b],
      targetId: b,
    });
    s.resolveStructures([next], "accept", b);
    s.append("note.corrected", { id, raw: "后续修改" });
    expect(() => s.append("structure.undone", { id: next })).toThrow(
      "后续修改",
    );
  });
  it("queries only a bounded page for ten thousand notes and traverses every item once", () => {
    const s = open();
    const events = Array.from({ length: 10000 }, (_, i) =>
      s.event(
        "note.added",
        s.createNote({ raw: `模拟原文 ${i} ` + "长正文".repeat(60) }),
      ),
    );
    s.appendMany(events);
    const first = s.workspace({ workspace: "all" });
    expect(first.items).toHaveLength(30);
    expect(first.total).toBe(10000);
    expect(JSON.stringify(first).length).toBeLessThan(25000);
    let p = first;
    const ids = new Set<string>();
    do {
      for (const v of p.items) {
        expect(ids.has(v.value.id)).toBe(false);
        ids.add(v.value.id);
      }
      if (!p.before) break;
      p = s.workspace({ workspace: "all", before: p.before });
    } while (true);
    expect(ids.size).toBe(10000);
    const older = s.workspace({ workspace: "all", before: first.before! });
    const newer = s.workspace({ workspace: "all", before: older.newerBefore! });
    expect(newer.items.map((i) => i.value.id)).toEqual(
      first.items.map((i) => i.value.id),
    );
  }, 60000);
  it("links discussion to its starting version in chronological units and searches original separately from AI replies", () => {
    const s = open(),
      t = s.thread({ title: "问题", description: "", parentId: null }),
      id = s.capture({ raw: "原文立场", threadId: t });
    s.capture({
      raw: "讨论追问",
      mode: "discussion",
      threadId: t,
      parentNoteId: id,
    });
    s.append("note.completed", {
      id,
      threadId: t,
      result: {
        threadId: t,
        newThreadTitle: null,
        title: "标题",
        synopsis: "摘要",
        reply: "AI 独有词汇",
      },
    });
    expect(s.workspace({ workspace: t }).items).toHaveLength(2);
    expect(s.detail(id).discussions).toHaveLength(1);
    expect(
      s.workspace({ workspace: "all", query: "独有词汇", searchIn: "original" })
        .items,
    ).toHaveLength(0);
    expect(
      s.workspace({ workspace: "all", query: "独有词汇", searchIn: "reply" })
        .items,
    ).toHaveLength(1);
  });
  it("persists local workspace drafts and preferences without putting them into cloud events", () => {
    const s = open(),
      seq = s.latestSeq(),
      draft = {
        draft: "未提交草稿",
        mode: "note" as const,
        parentNoteId: null,
        openIds: [],
        before: 10,
        scroll: 81,
        panel: "wide" as const,
      };
    s.workspaceState("all", draft);
    s.preferences({ font: 17 });
    expect(s.workspaceState("all")).toEqual(draft);
    expect(s.latestSeq()).toBe(seq);
    expect(JSON.stringify(s.eventsAfter())).not.toContain("草稿");
  });
  it("rebuilds projections on version mismatch with all corrections and migration intact", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "uki-projection-")),
      "thoughts.db",
    );
    const s = new Store(path),
      id = s.capture({ raw: "原文" });
    s.append("note.corrected", { id, raw: "更正" });
    s.close();
    const db = new DatabaseSync(path);
    db.prepare(
      "UPDATE meta SET value='invalid' WHERE key='projectionVersion'",
    ).run();
    db.exec("DELETE FROM entities_v2; DELETE FROM note_query_v2");
    db.close();
    const reopened = open(path);
    expect(reopened.note(id)).toMatchObject({
      raw: "原文",
      currentRaw: "更正",
      revision: 1,
    });
    expect(reopened.detail(id).revisions).toHaveLength(2);
  });
});
describe("short previews", () => {
  it("uses Unicode characters, two sentence limit and Chinese punctuation boundaries", () => {
    expect(isShortNote("字".repeat(120))).toBe(true);
    expect(isShortNote("字".repeat(121))).toBe(false);
    expect(isShortNote("😀".repeat(120))).toBe(true);
    expect(isShortNote("一。二！")).toBe(true);
    expect(isShortNote("一。二？三。 ")).toBe(false);
    expect(isShortNote("  一句。\r\n第二句。 ")).toBe(true);
  });
});
describe("persistent priority tasks", () => {
  it("handles new notes before background history, completes once and retains bounded references", async () => {
    const s = open(),
      old = s.createNote({ raw: "历史" });
    const { revision, legacy, ...payload } = old;
    s.append("note.added", payload);
    s.migrateV2();
    s.append("note.failed", { id: old.id, error: "legacy" });
    s.capture({ raw: "新记录" });
    const calls: string[] = [];
    const transport: AiTransport = {
      complete: async (_k, model, _sys, context) => {
        expect(model).toBe("deepseek-flash");
        const c = JSON.parse(context);
        calls.push(c.notes ? "organize" : "note");
        return {
          input: 100,
          output: 20,
          content: JSON.stringify(
            c.notes
              ? { suggestions: [] }
              : {
                  threadId: null,
                  newThreadTitle: null,
                  title: "新标题",
                  synopsis: "",
                  reply: "回应",
                },
          ),
        };
      },
    };
    const ai = new AiQueue(s, config, () => {}, transport);
    await ai.pump();
    await ai.pump();
    expect(calls).toEqual(["note", "organize"]);
    expect(s.tasks()[0]).toMatchObject({
      status: "done",
      inputVersions: [{ noteId: old.id, revision: 0 }],
    });
  });
  it("preserves valid organization items and reports rejected items as partial completion", async () => {
    const s = open(),
      id = s.capture({ raw: "依据" });
    s.addTask("organize", null, "deepseek-flash", [id]);
    s.append("note.failed", { id, error: "skip foreground" });
    const transport: AiTransport = {
      complete: async () => ({
        input: 90,
        output: 20,
        content: JSON.stringify({
          suggestions: [
            {
              kind: "create",
              title: "问题",
              reason: "依据",
              noteIds: [id],
              evidence: [{ noteId: id, revision: 0 }],
            },
            {
              kind: "assign",
              title: "无效目标",
              reason: "依据",
              targetId: randomUUID(),
              noteIds: [id],
              evidence: [{ noteId: id, revision: 0 }],
            },
          ],
        }),
      }),
    };
    await new AiQueue(s, config, () => {}, transport).pump();
    expect(s.snapshot().structures).toHaveLength(1);
    expect(s.tasks()[0].status).toBe("partial");
    expect(s.snapshot().usage).toHaveLength(1);
  });
  it("resumes budget tasks the next day but does not automatically retry interrupted billing", async () => {
    const s = open(),
      id = s.capture({ raw: "历史" });
    s.append("note.failed", { id, error: "skip" });
    const t = s.addTask("organize", null, "deepseek-flash", [id]);
    s.append("task.updated", {
      id: t,
      status: "budget",
      budgetDay: "2000-01-01",
    });
    let calls = 0;
    const transport: AiTransport = {
      complete: async () => {
        calls++;
        return { input: 50, output: 10, content: '{"suggestions":[]}' };
      },
    };
    await new AiQueue(s, config, () => {}, transport).pump();
    expect(calls).toBe(1);
    const other = s.addTask("organize", null, "deepseek-flash", [id]);
    s.append("task.updated", { id: other, status: "running" });
    s.recoverInterrupted();
    await new AiQueue(s, config, () => {}, transport).pump();
    expect(calls).toBe(1);
    expect(s.tasks()[1].error).toContain("计费");
  });
  it("rejects a cognition result if the base changes while AI is processing", async () => {
    const s = open(),
      t = s.thread({ title: "问题", description: "", parentId: null }),
      id = s.capture({ raw: "立场", threadId: t });
    s.append("note.failed", { id, error: "skip" });
    const after = {
      viewpoint: "新看法",
      reasons: [],
      uncertainties: [],
      questions: [],
      decisions: [],
    };
    const transport: AiTransport = {
      complete: async () => {
        const p = randomUUID();
        s.append("proposal.added", {
          id: p,
          threadId: t,
          baseVersion: 0,
          before: s.cognition(t),
          after,
          reason: "手动操作",
          evidenceIds: [id],
          status: "pending",
          createdAt: new Date().toISOString(),
        });
        s.append("proposal.resolved", { id: p, decision: "accept" });
        return {
          input: 100,
          output: 10,
          content: JSON.stringify({ after, reason: "AI", evidenceIds: [id] }),
        };
      },
    };
    await new AiQueue(s, config, () => {}, transport).propose(
      t,
      "deepseek-flash",
    );
    expect(s.tasks()[0].status).toBe("failed");
    expect(s.snapshot().proposals).toHaveLength(1);
  });
});
describe("idle sync and capability cache", () => {
  it("performs two reads and zero writes across cached restart when nothing changed", async () => {
    const s = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "");
    s.capture({ raw: "记录" });
    await new SyncEngine(s, dav, () => {}, "account-A").sync();
    dav.calls = [];
    await new SyncEngine(s, dav, () => {}, "account-A").sync();
    expect(dav.calls.map((c) => c.method + ":" + c.path)).toEqual([
      "GET:manifest.json",
      "GET:inbox.txt",
    ]);
  });
  it("does not probe at cache expiry until a write is needed, and isolates configuration revisions", async () => {
    const s = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "");
    await new SyncEngine(s, dav, () => {}, "A").sync();
    const key =
      "davCapability:" +
      (await import("node:crypto"))
        .createHash("sha256")
        .update("A")
        .digest("hex");
    const cache = JSON.parse(s.getMeta(key)!);
    cache.checkedAt = Date.now() - 31 * 86400000;
    s.setMeta(key, JSON.stringify(cache));
    dav.calls = [];
    const engine = new SyncEngine(s, dav, () => {}, "A");
    await engine.sync();
    expect(dav.calls.every((c) => c.method === "GET")).toBe(true);
    s.capture({ raw: "新变化" });
    await engine.backup();
    expect(
      dav.calls.some(
        (c) => c.path.startsWith(".condition-probe-") && c.method === "PUT",
      ),
    ).toBe(true);
    s.capture({ raw: "第二个变化" });
    dav.calls = [];
    await new SyncEngine(s, dav, () => {}, "B").backup();
    expect(dav.calls.some((c) => c.method === "MKCOL")).toBe(true);
  });
  it("checks unknown manifest changes even when no local upload is pending", async () => {
    const s = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "");
    s.capture({ raw: "本地" });
    const engine = new SyncEngine(s, dav);
    await engine.sync();
    const foreign = open();
    foreign.capture({ raw: "外来事件" });
    const content = JSON.stringify({
        schemaVersion: 2,
        events: foreign.eventsAfter().map((r) => r.event),
      }),
      file = `events/${randomUUID()}_${randomUUID()}.json`;
    dav.files.set(file, content);
    const m = JSON.parse(dav.files.get("manifest.json")!);
    m.batches.push({
      file,
      sha256: (await import("node:crypto"))
        .createHash("sha256")
        .update(content)
        .digest("hex"),
    });
    dav.files.set("manifest.json", JSON.stringify(m));
    await expect(engine.sync()).rejects.toThrow("本机没有的事件");
    expect(s.counts().notes).toBe(1);
  });
  it("restores version 2 tasks, corrections, structure results and recaps without restoring local drafts", async () => {
    const s = open(),
      dav = new FakeDav(),
      id = s.capture({ raw: "原文" }),
      p = suggestion(s, [id]);
    s.resolveStructures([p], "accept");
    s.append("note.corrected", { id, raw: "更正原文" });
    s.addTask("organize", null, "deepseek-flash", [id]);
    s.workspaceState("all", {
      draft: "草稿",
      mode: "note",
      parentNoteId: null,
      openIds: [],
    });
    await new SyncEngine(s, dav).backup();
    const restored = open();
    await new SyncEngine(restored, dav).restore();
    expect(restored.snapshot()).toEqual(s.snapshot());
    expect(restored.detail(id).revisions).toEqual(s.detail(id).revisions);
    expect(restored.workspaceState("all").draft).toBe("");
    expect(JSON.parse(dav.files.get("manifest.json")!).schemaVersion).toBe(5);
  });
});
