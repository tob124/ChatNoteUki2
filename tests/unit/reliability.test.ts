import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../../electron/store";
import { AiRequests } from "../../electron/ai-request";
import { DeepSeek, AiQueue } from "../../electron/ai";
import { settingsSchema } from "../../src/shared";
import { SyncEngine } from "../../electron/webdav";
import { observeInbox } from "../../electron/inbox";
import { FakeDav } from "./fake-dav";
const stores: Store[] = [];
const open = () => {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
};
const config = {
  apiKey: () => "test-only",
  settings: () => settingsSchema.parse({}),
};
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.unstubAllGlobals();
});
it("uses Responses JSON Schema and retains output when usage is missing", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"title":"长标题"}' }],
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await new DeepSeek().complete(
    "test-only",
    "deepseek-flash",
    "生成标题",
    "原文",
    2048,
  );
  const [url, request] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://api.deepseek.com/responses");
  expect(JSON.parse(request.body as string).text.format.type).toBe(
    "json_schema",
  );
  expect(result).toMatchObject({
    content: '{"title":"长标题"}',
    usageKnown: false,
  });
});
it("parses fragmented SSE and emits plain-text updates", async () => {
  const body =
    'data: {"type":"response.output_text.delta","delta":"你好"}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"你好"}]}],"usage":{"input_tokens":10,"output_tokens":2}}}\n\n';
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const piece of [
              body.slice(0, 35),
              body.slice(35, 81),
              body.slice(81),
            ])
              c.enqueue(new TextEncoder().encode(piece));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const delta = vi.fn();
  const result = await new DeepSeek().complete(
    "test-only",
    "deepseek-flash",
    "讨论",
    "原文",
    8192,
    undefined,
    { text: true, onDelta: delta },
  );
  expect(result.content).toBe("你好");
  expect(delta).toHaveBeenCalledWith("你好");
});
it("persists a response before validation, reuses it after a recreated runner and keeps actual usage", async () => {
  const s = open(),
    complete = vi.fn(async () => ({
      content: '{"ok":true}',
      input: 20,
      output: 5,
    }));
  const id = randomUUID();
  const first = new AiRequests(s, config, { complete }, () => {});
  await first.run(id, "标题", "原文", "deepseek-flash", 2048);
  const next = new AiRequests(s, config, { complete }, () => {});
  await next.run(id, "标题", "原文", "deepseek-flash", 2048);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(s.snapshot().usage).toHaveLength(1);
});
it("repairs malformed JSON once without unbounded retries", async () => {
  const s = open();
  let calls = 0;
  const complete = vi.fn(async () => ({
    content: ++calls === 1 ? "```json\n{bad}\n```" : '{"ok":true}',
    input: 20,
    output: 5,
  }));
  const result = await new AiRequests(s, config, { complete }, () => {}).run(
    randomUUID(),
    "标题",
    "原文",
    "deepseek-flash",
    2048,
  );
  expect(result.value).toEqual({ ok: true });
  expect(calls).toBe(2);
  expect(s.snapshot().usage).toHaveLength(2);
});
it("keeps valid title and reply despite a nonexistent classification, and ignores a result arriving after deletion", async () => {
  const s = open(),
    id = s.capture({ raw: "我的原话" });
  const transport = {
    complete: async () => ({
      content: JSON.stringify({
        title: "真实标题",
        synopsis: "",
        reply: "完整回应".repeat(100),
        threadId: randomUUID(),
        newThreadTitle: null,
      }),
      input: 50,
      output: 20,
    }),
  };
  await new AiQueue(s, config, () => {}, transport).pump();
  expect(s.note(id)).toMatchObject({
    status: "partial",
    title: "真实标题",
    threadId: null,
    reply: "完整回应".repeat(100),
  });
  const gone = s.capture({ raw: "运行中删除" });
  await new AiQueue(s, config, () => {}, {
    complete: async () => {
      s.append("note.trashed", { id: gone });
      return {
        content: JSON.stringify({
          title: "不能覆盖",
          synopsis: "",
          reply: "回应",
          threadId: null,
          newThreadTitle: null,
        }),
        input: 50,
        output: 20,
      };
    },
  }).pump();
  expect(s.note(gone).deletedAt).toBeTruthy();
  expect(s.note(gone).title).not.toBe("不能覆盖");
  expect(s.workspace({ workspace: "all" }).total).toBe(1);
});
it("trash excludes whole conversations, restore preserves cancelled status, and historical search is explicit", () => {
  const s = open(),
    id = s.capture({ raw: "旧正文关键词" });
  s.capture({ raw: "关联追问", mode: "discussion", parentNoteId: id });
  s.append("note.corrected", { id, raw: "最新正文" });
  s.append("note.titled", { id, title: "最新标题" });
  expect(s.workspace({ workspace: "all", query: "关键词" }).total).toBe(0);
  expect(
    s.workspace({ workspace: "all", query: "关键词", includeHistory: true })
      .total,
  ).toBe(1);
  s.append("note.trashed", { id });
  expect(s.counts().notes).toBe(0);
  expect(s.recent(null)).toHaveLength(0);
  s.append("note.restored", { id });
  expect(s.note(id).status).toBe("cancelled");
  expect(s.counts().notes).toBe(1);
});
it("manual cognition and batch undo reject stale versions", () => {
  const s = open(),
    thread = s.thread({ title: "问题", description: "", parentId: null }),
    id = s.capture({ raw: "原文" });
  const content = {
    viewpoint: "手动认知",
    reasons: [],
    uncertainties: [],
    questions: [],
    decisions: [],
  };
  s.append("cognition.edited", { threadId: thread, baseVersion: 0, content });
  expect(() =>
    s.append("cognition.edited", { threadId: thread, baseVersion: 0, content }),
  ).toThrow("已变化");
  const move = randomUUID();
  s.append("notes.move-batch", {
    id: move,
    ids: [id],
    threadId: thread,
    bases: { [id]: 0 },
  });
  s.append("note.moved", { id, threadId: null });
  expect(() => s.append("notes.undo-move", { id: move })).toThrow("已有修改");
});
it("permanent deletion redacts shared batches without removing another note, and restore cannot revive it", async () => {
  const s = open(),
    dav = new FakeDav(),
    sync = new SyncEngine(s, dav);
  const first = s.capture({ raw: "必须移除的独特原文" }),
    second = s.capture({ raw: "其他笔记完整保留" });
  s.append("note.corrected", { id: first, raw: "更正后也应移除的原文" });
  await sync.backup();
  s.append("note.trashed", { id: first });
  s.append("note.purged", { id: first });
  await sync.backup();
  const canonical = JSON.stringify(s.eventsAfter());
  expect(canonical).not.toContain("必须移除的独特原文");
  expect(canonical).not.toContain("更正后也应移除的原文");
  expect([...dav.files.values()].join("\n")).not.toContain(
    "必须移除的独特原文",
  );
  const restored = open();
  await new SyncEngine(restored, dav).restore();
  expect(restored.note(first).purged).toBe(true);
  expect(restored.note(second).raw).toBe("其他笔记完整保留");
  expect(restored.workspace({ workspace: "all" }).total).toBe(1);
});
it("a deleted import receipt still deduplicates an unchanged inbox and an appended suffix", () => {
  const s = open(),
    batch = observeInbox(s, "删除此项\n\n保留此项", '"first"')!;
  s.append("note.trashed", { id: batch.items[0].id });
  s.append("note.purged", { id: batch.items[0].id });
  observeInbox(s, "删除此项\n\n保留此项", '"second"');
  const appended = observeInbox(s, "删除此项\n\n保留此项\n\n新项", '"third"')!;
  expect(appended.items[0].id).toBe(batch.items[0].id);
  expect(appended.snapshot).not.toContain("删除此项");
  expect(s.workspace({ workspace: "all" }).total).toBe(2);
});

it("normalizes a legacy Pro request to Flash at the transport boundary", async () => {
  const { DeepSeek } = await import("../../electron/ai");
  const send = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      ),
  );
  vi.stubGlobal("fetch", send);
  try {
    await new DeepSeek().complete(
      "fixture",
      "deepseek-v4-pro",
      "系统提示",
      "合成材料",
      100,
    );
    expect(JSON.parse(String(send.mock.calls[0][1]?.body)).model).toBe(
      "deepseek-flash",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
