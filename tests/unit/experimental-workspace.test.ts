import { afterEach, expect, it, vi } from "vitest";
import { Store } from "../../electron/store";
import { AiQueue, type AiTransport } from "../../electron/ai";
import { settingsSchema, type Note } from "../../src/shared";
import { parseSearchResponse } from "../../electron/research-search";
const stores: Store[] = [];
const open = () => {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const config = {
  apiKey: () => "test-only",
  settings: () => settingsSchema.parse({}),
};

it("keeps new classification suggestions beside their notes on pending/search pages until approved", async () => {
  const s = open();
  const id = s.capture({ raw: "希望每天记录想法而不用花太多时间整理" });
  const transport: AiTransport = {
    complete: async () => ({
      input: 20,
      output: 20,
      content: JSON.stringify({
        title: "记录与整理",
        synopsis: "",
        reply: "可以试试每周集中整理。",
        threadId: null,
        newThreadTitle: "个人记录习惯",
        newParentId: null,
        threadDescription: "日常记录与整理方式",
      }),
    }),
  };
  await new AiQueue(s, config, () => {}, transport).pump();
  expect(s.note(id).status).toBe("done");
  expect(s.threads()).toHaveLength(0);
  const item = s.workspace({ workspace: "pending", query: "整理" }).items[0];
  expect(item.value.id).toBe(id);
  expect(item.assignmentSuggestions?.[0].title).toBe("个人记录习惯");
  expect(s.workspace({ workspace: "all" }).items.map((i) => i.kind)).toEqual([
    "note",
  ]);
  s.resolveStructures([item.assignmentSuggestions![0].id], "accept");
  expect(s.note(id).threadId).toBe(s.threads()[0].id);
  expect(s.workspace({ workspace: "pending" }).items).toHaveLength(0);
  const replay = open();
  replay.appendMany(s.eventsAfter().map((e) => e.event));
  expect(replay.note(id).raw).toBe(s.note(id).raw);
  expect(replay.note(id).threadId).toBe(s.note(id).threadId);
});

it("does not attach proposals for another page, or revive rejected/manual stale assignments", () => {
  const s = open(),
    ids: string[] = [];
  for (let i = 0; i < 61; i++) ids.push(s.capture({ raw: `正文 ${i}` }));
  const add = (id: string, title: string) =>
    s.addStructure({
      kind: "create",
      title,
      description: "",
      parentId: null,
      targetId: null,
      sourceIds: [],
      noteIds: [id],
      reason: "主题依据",
      evidence: [{ noteId: id, revision: 0 }],
    })!;
  const old = add(ids[0], "旧页主题"),
    fresh = add(ids.at(-1)!, "新页主题");
  const first = s.workspace({ workspace: "pending" });
  expect(first.items).toHaveLength(30);
  expect(
    first.items.flatMap((i) => i.assignmentSuggestions ?? []).map((p) => p.id),
  ).toEqual([fresh]);
  const found = s.workspace({ workspace: "pending", query: "正文 0" }).items[0];
  expect(found.assignmentSuggestions?.[0].id).toBe(old);
  s.resolveStructures([fresh], "reject");
  expect(
    s
      .workspace({ workspace: "pending" })
      .items.flatMap((i) => i.assignmentSuggestions ?? []),
  ).toHaveLength(0);
  s.append("note.corrected", { id: ids[0], raw: "更正后的正文" });
  expect(() => s.resolveStructures([old], "accept")).toThrow();
  expect(s.note(ids[0]).threadId).toBeNull();
});

it("plans one-click public research once, deduplicates after planning, and reuses it after failure", async () => {
  const s = open(),
    id = s.capture({ raw: "通勤是否影响幸福感 PRIVATE_MARKER" });
  s.append("note.cancelled", { id });
  let plans = 0,
    fail = true,
    q: AiQueue,
    task: string;
  const search = vi.fn(async (_key: string, query: string) => {
    expect(query).toBe("通勤 满意度 观察研究");
    expect(q.queueResearchAuto({ noteId: id })).toBe(task);
    if (fail) throw new Error("模拟检索失败");
    return parseSearchResponse({
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        server_tool_use: { web_search_requests: 1 },
      },
      content: [
        {
          type: "web_search_tool_result",
          content: [
            {
              type: "web_search_result",
              url: "https://example.com/study",
              title: "通勤研究",
            },
          ],
        },
      ],
    });
  });
  q = new AiQueue(
    s,
    config,
    () => {},
    {
      complete: async (_key, _model, system, context) => {
        if (system.includes("research-query-plan")) {
          plans++;
          return {
            input: 20,
            output: 20,
            content: JSON.stringify({
              question: "通勤与满意度是否相关",
              queries: ["通勤 满意度 观察研究"],
            }),
          };
        }
        const source = JSON.parse(context).sources[0];
        return {
          input: 20,
          output: 20,
          content: JSON.stringify({
            findings: [
              {
                sourceId: source.id,
                claim: "相关关系",
                quote: "通勤时间与满意度存在相关关系",
                relation: "context",
              },
            ],
            analysis: "研究提供比较视角，尚不能证明因果。",
            limitations: ["观察研究"],
            questions: [],
          }),
        };
      },
    },
    { search },
    async () => ({
      title: "研究",
      text: "观察研究发现通勤时间与满意度存在相关关系，但不证明因果。",
      finalUrl: "https://example.com/study",
      coverage: "全部静态正文",
    }),
  );
  task = q.queueResearchAuto({ noteId: id });
  expect(q.queueResearchAuto({ noteId: id })).toBe(task);
  await q.pump();
  expect(s.task(task).status, s.task(task).error ?? "").toBe("failed");
  expect(s.task(task).research?.planned, s.task(task).error ?? "").toBe(true);
  fail = false;
  q.allowManualRetry(task);
  s.append("task.updated", { id: task, status: "pending", error: null });
  await q.pump();
  expect(s.task(task).status, s.task(task).error ?? "").toBe("done");
  expect(plans).toBe(1);
  expect(s.snapshot().researches?.[0].queries).toEqual([
    "通勤 满意度 观察研究",
  ]);
  expect(s.note(id).raw).toContain("PRIVATE_MARKER");
  expect(s.tasks()).toHaveLength(1);
});

it("does not search when a note changes during automatic query planning", async () => {
  const s = open(),
    id = s.capture({ raw: "通勤与幸福感" });
  s.append("note.cancelled", { id });
  const search = vi.fn();
  const q = new AiQueue(
    s,
    config,
    () => {},
    {
      complete: async () => {
        s.append("note.corrected", { id, raw: "更正后的想法" });
        return {
          input: 20,
          output: 20,
          content: JSON.stringify({
            question: "通勤与满意度",
            queries: ["通勤 满意度"],
          }),
        };
      },
    },
    { search },
  );
  const idTask = q.queueResearchAuto({ noteId: id });
  await q.pump();
  expect(search).not.toHaveBeenCalled();
  expect(s.task(idTask).status).toBe("failed");
  expect(s.task(idTask).error).toContain("更正");
});

it("rejects private contact details in automatic public query planning before searching", async () => {
  const s = open(),
    id = s.capture({ raw: "讨论一种记录习惯" });
  s.append("note.cancelled", { id });
  const search = vi.fn();
  const q = new AiQueue(
    s,
    config,
    () => {},
    {
      complete: async () => ({
        input: 20,
        output: 20,
        content: JSON.stringify({
          question: "记录习惯",
          queries: ["private@example.invalid 记录习惯"],
        }),
      }),
    },
    { search },
  );
  const task = q.queueResearchAuto({ noteId: id });
  await q.pump();
  expect(search).not.toHaveBeenCalled();
  expect(s.task(task).status).toBe("failed");
});
