import { afterEach, expect, it } from "vitest";
import { Store } from "../../electron/store";
import { AiQueue, buildContext, type Completion } from "../../electron/ai";
import { settingsSchema } from "../../src/shared";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const stores: Store[] = [];
const open = (path = ":memory:") => {
  const s = new Store(path);
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const config = {
  apiKey: () => "test-only",
  settings: () => settingsSchema.parse({}),
};
it("rejects unavailable analysis explicitly and does not queue silent tasks", () => {
  const s = open(),
    thread = s.thread({ title: "问题", description: "", parentId: null });
  const ai = new AiQueue(s, config, () => {});
  expect(() => ai.queueAnalysis("recap", thread, "deepseek-flash")).toThrow(
    "还没有记录",
  );
  s.capture({ raw: "想法", threadId: thread });
  expect(() =>
    new AiQueue(s, { ...config, apiKey: () => "" }, () => {}).queueAnalysis(
      "recap",
      thread,
      "deepseek-flash",
    ),
  ).toThrow("配置");
  expect(s.tasks()).toHaveLength(0);
});
it("keeps a durable receipt while running and points completed analysis to its exact result", async () => {
  const s = open(),
    thread = s.thread({
      title: "王者匹配机制是否公平",
      description: "",
      parentId: null,
    });
  const note = s.capture({ raw: "匹配让我疑惑", threadId: thread });
  s.append("note.completed", {
    id: note,
    threadId: thread,
    result: {
      threadId: thread,
      newThreadTitle: null,
      title: "匹配",
      synopsis: "",
      reply: "一起思考",
    },
  });
  let finish!: (r: Completion) => void;
  const ai = new AiQueue(s, config, () => {}, {
    complete: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const id = ai.queueAnalysis("recap", thread, "deepseek-flash");
  expect(ai.queueAnalysis("recap", thread, "deepseek-flash")).toBe(id);
  const pumping = ai.pump();
  await new Promise((resolve) => setImmediate(resolve));
  expect(s.task(id).status).toBe("running");
  finish({
    content: JSON.stringify({
      expressed: `${thread.slice(0, 8)}（王者匹配机制是否公平）`,
      possible: "待观察",
      questions: "继续追问",
      evidenceIds: [note],
    }),
    input: 100,
    output: 50,
  });
  await pumping;
  expect(s.task(id).status).toBe("done");
  const resultId = (s.task(id).result as any).resultId;
  const page = s.workspace({
    workspace: thread,
    before: s.resultBefore(resultId),
  });
  expect(page.items.at(-1)?.value.id).toBe(resultId);
  expect(s.resources(thread).recaps[0].expressed).toBe(
    "「王者匹配机制是否公平」",
  );
});
it("scopes thread analysis explicitly instead of including unrelated candidate questions", () => {
  const s = open(),
    first = s.thread({ title: "当前问题", description: "", parentId: null }),
    other = s.thread({ title: "另一个问题", description: "", parentId: null });
  const id = s.capture({ raw: "当前问题的立场", threadId: first });
  s.capture({ raw: "请回看这个问题的判断与变化", threadId: other });
  const context = JSON.parse(
    buildContext(s, "请回看这个问题的判断与变化", first, null, null, true),
  );
  expect(context.selectedThread.title).toBe("当前问题");
  expect(context.threads.map((t: any) => t.id)).toEqual([first]);
  expect(context.history.map((n: any) => n.id)).toEqual([id]);
});
it("replaces full and abbreviated internal IDs in old AI prose without rewriting source history", () => {
  const s = open(),
    t = s.thread({ title: "AI 控胜率", description: "", parentId: null });
  const raw = `用户原话 ${t.slice(0, 8)}`,
    id = s.capture({ raw, threadId: t });
  const reply = `你指的是 ${t.slice(0, 8)}（AI 控胜率）还是 ${t}？`;
  s.append("note.completed", {
    id,
    threadId: t,
    result: {
      threadId: t,
      newThreadTitle: null,
      title: "标题",
      synopsis: "",
      reply,
    },
  });
  s.append("note.titled", { id, title: t.slice(0, 8) });
  const displayed = s.display(s.detail(id));
  expect(displayed.note.reply).toBe(
    "你指的是 「AI 控胜率」还是 「AI 控胜率」？",
  );
  expect(displayed.note.raw).toBe(raw);
  expect(displayed.note.title).toBe(t.slice(0, 8));
  expect(s.note(id).reply).toBe(reply);
});
it("moves legacy workspace discussion drafts atomically and only once", () => {
  const s = open();
  s.workspaceState("all", {
    draft: "旧讨论草稿",
    mode: "discussion",
    parentNoteId: "b6789f30-0000-4000-8000-000000000000",
    parentRevision: 2,
    openIds: [],
  });
  const migrated = s.workspaceState("all");
  expect(migrated).toMatchObject({
    draft: "",
    mode: "note",
    discussionDraftMoved: true,
  });
  expect(
    s.workspaceState("conversation:b6789f30-0000-4000-8000-000000000000"),
  ).toMatchObject({ draft: "旧讨论草稿", parentRevision: 2 });
  s.workspaceState("all");
  expect(
    s.workspaceState("conversation:b6789f30-0000-4000-8000-000000000000").draft,
  ).toBe("旧讨论草稿");
  expect(s.latestSeq()).toBe(0);
});
it("rolls back both drafts if local migration storage fails", () => {
  const path = join(
      mkdtempSync(join(tmpdir(), "uki-draft-migrate-")),
      "thoughts.db",
    ),
    s = open(path),
    parentNoteId = "b6789f30-0000-4000-8000-000000000000";
  s.workspaceState("all", {
    draft: "草稿不能丢",
    mode: "discussion",
    parentNoteId,
    openIds: [],
  });
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TRIGGER fail_draft BEFORE UPDATE ON meta WHEN NEW.key='workspace:all' BEGIN SELECT RAISE(ABORT,'draft storage interrupted'); END;",
  );
  db.close();
  expect(() => s.workspaceState("all")).toThrow("interrupted");
  expect(s.getMeta("workspace:conversation:" + parentNoteId)).toBeNull();
  expect(JSON.parse(s.getMeta("workspace:all")!).draft).toBe("草稿不能丢");
});
