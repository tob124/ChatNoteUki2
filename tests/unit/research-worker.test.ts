import { afterEach, expect, it, vi } from "vitest";
import { Store } from "../../electron/store";
import { AiQueue } from "../../electron/ai";
import { settingsSchema } from "../../src/shared";
import { parseSearchResponse } from "../../electron/research-search";
import { runResearch, researchContext } from "../../electron/research-worker";
import type { ResearchCheckpoint } from "../../src/research";
import { SyncEngine } from "../../electron/webdav";
import { FakeDav } from "./fake-dav";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const makeStore = () => {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
};
const searchResult = () =>
  parseSearchResponse({
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      server_tool_use: { web_search_requests: 1 },
    },
    content: [
      {
        type: "web_search_tool_result",
        content: [
          {
            type: "web_search_result",
            url: "https://example.com/study",
            title: "公开研究",
          },
        ],
      },
    ],
  });
const page = {
  title: "通勤研究",
  text: "一项观察研究发现，通勤时间与满意度存在相关关系。研究对象和方法限制了结论，不代表因果关系。",
  finalUrl: "https://example.com/study",
  coverage: "静态正文",
};
const report = () => ({
  findings: [
    {
      sourceId: searchResult().sources[0].id,
      quote: "通勤时间与满意度存在相关关系",
      claim: "研究报告相关关系",
      relation: "context",
    },
  ],
  analysis: "可能为想法提供一个比较视角",
  limitations: ["观察研究不能确认因果"],
  questions: ["适用对象是否一致？"],
});
it("research task saves exact original versions, sources and result atomically, without changing raw thoughts or cognition", async () => {
  const s = makeStore();
  const id = s.capture({ raw: "我在想通勤时间会怎样影响幸福感" });
  s.append("note.failed", {
    id,
    error: "mock: prevent automatic note processing",
  });
  const search = vi.fn(async (_key, _query, onResponse) => {
    const r = searchResult();
    onResponse(r);
    return r;
  });
  const read = vi.fn(async () => page);
  const complete = vi.fn(async () => ({
    content: JSON.stringify(report()),
    input: 100,
    output: 80,
  }));
  const q = new AiQueue(
    s,
    { apiKey: () => "test-key", settings: () => settingsSchema.parse({}) },
    () => {},
    { complete },
    { search },
    read,
  );
  const taskId = q.queueResearch({
    noteId: id,
    threadId: null,
    question: "通勤和满意度是否相关",
    queries: ["通勤 满意度 研究"],
  });
  expect(
    q.queueResearch({
      noteId: id,
      threadId: null,
      question: "通勤和满意度是否相关",
      queries: ["通勤 满意度 研究"],
    }),
  ).toBe(taskId);
  await q.pump();
  expect(s.task(taskId).status, s.task(taskId).error ?? "").toBe("done");
  const saved = s.snapshot().researches![0];
  expect(saved.evidence).toEqual([{ noteId: id, revision: 0 }]);
  expect(saved.report.findings[0].quote).toBe("通勤时间与满意度存在相关关系");
  expect(saved.sources[0].text).toBe(page.text);
  expect(s.note(id).raw).toBe("我在想通勤时间会怎样影响幸福感");
  expect(s.snapshot().cognitions).toHaveLength(0);
  expect(s.researchSource(saved.id, saved.sources[0].id)).toEqual(saved.sources[0]);
  expect(s.researchSource(taskId, saved.sources[0].id)).toEqual(saved.sources[0]);
  expect(() => s.researchSource(taskId, "b".repeat(24))).toThrow("没有这个来源");
  expect(search).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  expect(s.usage().reduce((sum, u) => sum + u.input, 0)).toBe(110);
  const replayed = makeStore();
  replayed.appendMany(s.eventsAfter().map((row) => row.event));
  expect(replayed.snapshot().researches).toEqual([saved]);
  const dav = new FakeDav();
  await new SyncEngine(s, dav, () => {}).backup();
  expect(JSON.parse(dav.files.get("manifest.json")!).schemaVersion).toBe(4);
  const recovered = makeStore();
  await new SyncEngine(recovered, dav, () => {}).restore();
  expect(recovered.snapshot().researches).toEqual([saved]);
  expect(recovered.task(taskId).status).toBe("done");
  expect(s.workspace({ workspace: "research" }).items[0].value).toMatchObject({
    sources: [{ text: "" }],
  });
  complete.mockResolvedValueOnce({
    content: JSON.stringify({
      threadId: null,
      newThreadTitle: null,
      title: "进一步讨论",
      synopsis: "",
      reply: "可以继续区分观察证据与因果解释。",
    }),
    input: 20,
    output: 20,
  });
  s.capture({
    raw: "根据这份资料，还需要注意什么？",
    mode: "discussion",
    parentNoteId: id,
    researchId: saved.id,
  });
  await q.pump();
  expect(s.detail(id).discussions[0].researchId).toBe(saved.id);
  expect(s.detail(id).discussions[0].reply).toContain("观察证据");
  expect(() => s.capture({ raw: "错误关联", researchId: saved.id })).toThrow(
    "主动讨论",
  );
});
it("cancelled dispatched search keeps its uncertain billing reserve and does not auto-retry", async () => {
  const s = makeStore(),
    id = s.capture({ raw: "公开样例" });
  s.append("note.failed", { id, error: "mock" });
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const search = vi.fn(
    (_key, _query, _usage, signal?: AbortSignal) =>
      new Promise<ReturnType<typeof searchResult>>((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        began();
      }),
  );
  const complete = vi.fn();
  const q = new AiQueue(
    s,
    { apiKey: () => "test-key", settings: () => settingsSchema.parse({}) },
    () => {},
    { complete },
    { search },
    async () => page,
  );
  const task = q.queueResearch({
    noteId: id,
    threadId: null,
    question: "公开问题",
    queries: ["公开搜索"],
  });
  const pending = q.pump();
  await started;
  q.cancelResearch(task);
  await pending;
  expect(s.task(task).status).toBe("cancelled");
  expect(s.snapshot().reservations).toHaveLength(1);
  await q.pump();
  expect(search).toHaveBeenCalledTimes(1);
  expect(complete).not.toHaveBeenCalled();
});
it("exhausted daily budget defers a research task before dispatching any search", async () => {
  const s = makeStore(),
    id = s.capture({ raw: "公开样例" });
  s.append("note.failed", { id, error: "mock" });
  s.append("usage.recorded", {
    id: "12345678-0000-4000-8000-000000000000",
    input: 8000,
    output: 0,
    model: "mock",
    createdAt: new Date().toISOString(),
  });
  const search = vi.fn(),
    complete = vi.fn();
  const q = new AiQueue(
    s,
    {
      apiKey: () => "test-key",
      settings: () => settingsSchema.parse({ dailyInputLimit: 8000 }),
    },
    () => {},
    { complete },
    { search },
    async () => page,
  );
  const task = q.queueResearch({
    noteId: id,
    threadId: null,
    question: "公开问题",
    queries: ["公开搜索"],
  });
  await q.pump();
  expect(s.task(task).status).toBe("budget");
  expect(search).not.toHaveBeenCalled();
  expect(s.snapshot().reservations).toHaveLength(0);
});
it("retry uses durable search and page checkpoints instead of repeating billed discovery", async () => {
  let checkpoint: ResearchCheckpoint | undefined;
  const search = vi.fn(async () => searchResult()),
    read = vi.fn(async () => page);
  const input = {
    noteId: "12345678-0000-4000-8000-000000000000",
    threadId: null,
    question: "通勤和满意度是否相关",
    queries: ["通勤 满意度"],
  };
  const options = {
    input,
    user: { question: input.question },
    signal: new AbortController().signal,
    search,
    read,
    save: (value: ResearchCheckpoint) => {
      checkpoint = structuredClone(value);
    },
    analyze: vi.fn(async () => {
      throw new Error("analysis network timeout");
    }),
  };
  await expect(runResearch(options)).rejects.toThrow("timeout");
  expect(checkpoint?.stage).toBe("analyze");
  const result = await runResearch({
    ...options,
    checkpoint,
    analyze: async () => report(),
  });
  expect(result.report.findings).toHaveLength(1);
  expect(search).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
});
it("search summaries cannot produce verified analysis if every page is inaccessible", async () => {
  const analyze = vi.fn();
  let checkpoint: ResearchCheckpoint | undefined;
  await expect(
    runResearch({
      input: {
        noteId: "12345678-0000-4000-8000-000000000000",
        threadId: null,
        question: "公开问题",
        queries: ["查询词"],
      },
      user: {},
      signal: new AbortController().signal,
      search: async () => searchResult(),
      read: async () => {
        throw new Error("not public");
      },
      save: (c) => {
        checkpoint = c;
      },
      analyze,
    }),
  ).rejects.toThrow("未取得");
  expect(checkpoint?.sources[0].status).toBe("failed");
  expect(analyze).not.toHaveBeenCalled();
});
it("actual excessive server search counts stop a second client request", async () => {
  const search = vi.fn(async () => ({ ...searchResult(), searches: 5 }));
  const result = await runResearch({
    input: {
      noteId: "12345678-0000-4000-8000-000000000000",
      threadId: null,
      question: "公开问题",
      queries: ["第一查询", "第二查询"],
    },
    user: {},
    signal: new AbortController().signal,
    search,
    read: async () => page,
    save: () => {},
    analyze: async () => report(),
  });
  expect(search).toHaveBeenCalledTimes(1);
  expect(result.checkpoint.searches).toBe(5);
});
it("stale user context stays versioned and only supplied passages can be quoted", () => {
  const source = {
    ...searchResult().sources[0],
    status: "read" as const,
    text:
      "起始片段".repeat(100) +
      "\n" +
      "通勤结论".repeat(100) +
      "\n" +
      "未选择的隐藏文本".repeat(100),
  };
  const context = researchContext({ question: "通勤" }, [source], ["通勤"]);
  expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(5600);
  expect(context.sources[0].text).toContain("通勤结论");
  expect(context.sources[0].text).not.toContain("未选择的隐藏文本");
});
