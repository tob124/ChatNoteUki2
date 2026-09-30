import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../../electron/store";
import { AiQueue } from "../../electron/ai";
import { parseRecapResult } from "../../electron/recap-result";
import { parseNoteResult } from "../../electron/note-result";
import { settingsSchema } from "../../src/shared";
const stores: Store[] = [];
const open = () => {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const id = "12345678-0000-4000-8000-000000000000",
  refs = [{ noteId: id, revision: 0 }];
it("accepts text or text lists in recap sections, resolves unique reference prefixes and removes duplicates", () => {
  expect(
    parseRecapResult(
      {
        expressed: ["观察", "待证实"],
        possible: [],
        questions: ["还需要什么证据？"],
        evidenceIds: [id, "12345678"],
      },
      refs,
    ),
  ).toEqual({
    expressed: "观察\n待证实",
    possible: "",
    questions: "还需要什么证据？",
    evidenceIds: [id],
  });
});
it("rejects fabricated, ambiguous and missing recap evidence and reports only field names", () => {
  const value = {
    expressed: "观察",
    possible: "",
    questions: "",
    evidenceIds: [randomUUID()],
  };
  expect(() => parseRecapResult(value, refs)).toThrow("不在本次上下文");
  expect(() =>
    parseRecapResult({ ...value, evidenceIds: ["12345678"] }, [
      ...refs,
      { noteId: "12345678-0000-4000-8000-000000000001", revision: 0 },
    ]),
  ).toThrow("不能唯一识别");
  expect(() =>
    parseRecapResult(
      {
        expressed: { secretText: "不应显示这个值" },
        possible: "",
        questions: "",
        evidenceIds: [id],
      },
      refs,
    ),
  ).toThrow("明确表达");
  expect(() => parseRecapResult({ ...value, evidenceIds: [] }, refs)).toThrow(
    "原文引用",
  );
  expect(() => parseRecapResult({ ...value, expressed: "" }, refs)).toThrow(
    "明确表达",
  );
});
it("normalizes empty optional note metadata and bounds generated titles/replies without altering original text", () => {
  const s = open(),
    n = s.createNote({ raw: "😀真实原话" });
  const result = parseNoteResult(
    {
      title: "😀".repeat(20),
      synopsis: null,
      reply: ["回应".repeat(100)],
      threadDescription: null,
    },
    n,
  );
  expect(result.threadId).toBeNull();
  expect(result.newThreadTitle).toBeNull();
  expect(result.threadDescription).toBe("");
  expect(result.synopsis).toBe("");
  expect(result.title.length).toBeLessThanOrEqual(24);
  expect(result.reply.length).toBeLessThanOrEqual(150);
  expect(result.reply.endsWith("…")).toBe(true);
  expect(n.raw).toBe("😀真实原话");
  expect(() =>
    parseNoteResult({ title: "标题", synopsis: "", reply: null }, n),
  ).toThrow("回应");
  const long = s.createNote({ raw: "中文".repeat(100) });
  expect(() =>
    parseNoteResult(
      { title: "标题", synopsis: "摘要".repeat(60), reply: "回应" },
      long,
    ),
  ).toThrow("摘要");
});
it.each([
  { content: "", finishReason: "stop", error: "空内容" },
  { content: '{"title":"unfinished', finishReason: "length", error: "被截断" },
])(
  "records usage for empty/truncated responses and never automatically retries them",
  async (response) => {
    const s = open(),
      note = s.capture({ raw: "不要丢失的原文" });
    let calls = 0;
    const ai = new AiQueue(
      s,
      { apiKey: () => "test-only", settings: () => settingsSchema.parse({}) },
      () => {},
      {
        complete: async () => {
          calls++;
          return { ...response, input: 100, output: 20 };
        },
      },
    );
    await ai.pump();
    await ai.pump();
    expect(calls).toBe(1);
    expect(s.note(note).error).toContain(response.error);
    expect(s.note(note).raw).toBe("不要丢失的原文");
    expect(s.snapshot().usage).toHaveLength(1);
  },
);
it("tracks new units in each workspace without treating tasks, usage or other threads as new content", () => {
  const s = open(),
    a = s.thread({ title: "当前问题", description: "", parentId: null }),
    b = s.thread({ title: "其他问题", description: "", parentId: null });
  const note = s.capture({ raw: "原文", threadId: a }),
    before = s.workspace({ workspace: a }).newestSeq;
  const task = s.addTask("recap", a, "deepseek-flash");
  s.append("task.updated", { id: task, status: "failed", error: "模拟失败" });
  s.capture({ raw: "其他线程笔记", threadId: b });
  s.append("note.moved", { id: note, threadId: a });
  expect(s.workspace({ workspace: a }).newestSeq).toBe(before);
  s.capture({ raw: "本线程新增笔记", threadId: a });
  expect(s.workspace({ workspace: a }).newestSeq).toBeGreaterThan(before);
});
it("saves a list-shaped recap atomically into both the thread and review archive", async () => {
  const s = open(),
    thread = s.thread({ title: "一个问题", description: "", parentId: null }),
    note = s.capture({ raw: "明确表达", threadId: thread });
  s.append("note.failed", { id: note, error: "skip note AI" });
  const ai = new AiQueue(
    s,
    { apiKey: () => "test-only", settings: () => settingsSchema.parse({}) },
    () => {},
    {
      complete: async () => ({
        input: 100,
        output: 20,
        content: JSON.stringify({
          expressed: ["明确表达"],
          possible: [],
          questions: [],
          evidenceIds: [note],
        }),
      }),
    },
  );
  const task = ai.queueAnalysis("recap", thread, "deepseek-flash");
  await ai.pump();
  expect(s.task(task).status).toBe("done");
  expect(s.counts().recaps).toBe(1);
  expect(s.workspace({ workspace: "review" }).items[0].value.id).toBe(
    (s.task(task).result as any).resultId,
  );
});
