import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../../electron/store";
import { AiQueue, buildContext, type AiTransport } from "../../electron/ai";
import { settingsSchema } from "../../src/shared";
import { countTokens } from "../../electron/token-count";
import { randomUUID } from "node:crypto";
const stores: Store[] = [];
function open() {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const config = {
  apiKey: () => "test-only",
  settings: () => settingsSchema.parse({}),
};
describe("bounded AI processing", () => {
  it("keeps note conversations scoped and includes both sides at the cited original version", () => {
    const s = open(),
      t = s.thread({ title: "共同问题", description: "", parentId: null });
    const id = s.capture({ raw: "起始原文", threadId: t });
    const complete = (id: string, reply: string) =>
      s.append("note.completed", {
        id,
        threadId: t,
        inputRevision: 0,
        result: {
          threadId: t,
          newThreadTitle: null,
          title: "标题",
          synopsis: "",
          reply,
        },
      });
    complete(id, "起始 AI 追问");
    const first = s.capture({
      raw: "我的补充",
      threadId: t,
      mode: "discussion",
      parentNoteId: id,
    });
    complete(first, "讨论中的 AI 回答");
    const other = s.capture({ raw: "同线程另一条无关笔记", threadId: t });
    complete(other, "无关 AI 回答");
    s.append("note.corrected", { id, raw: "后来更正的起始原文" });
    const current = s.capture({
      raw: "继续回复 AI",
      threadId: t,
      mode: "discussion",
      parentNoteId: id,
      parentRevision: 0,
    });
    const future = s.capture({
      raw: "尚未轮到的下一条回复",
      threadId: t,
      mode: "discussion",
      parentNoteId: id,
    });
    const context = JSON.parse(
      buildContext(s, "继续回复 AI", t, current, { noteId: id, revision: 0 }),
    );
    expect(context.history.map((n: any) => n.id)).toEqual([id, first]);
    expect(context.history[0]).toMatchObject({
      raw: "起始原文",
      revision: 0,
      aiReply: "起始 AI 追问",
    });
    expect(context.history[1]).toMatchObject({
      raw: "我的补充",
      aiReply: "讨论中的 AI 回答",
      parentNoteId: id,
    });
    expect(context.history.some((n: any) => n.id === future)).toBe(false);
    expect(
      JSON.parse(buildContext(s, "新笔记", t)).history.every(
        (n: any) => n.aiReply === undefined,
      ),
    ).toBe(true);
  });
  it("allows repeated discussion before assignment without creating new thread suggestions", async () => {
    const s = open(),
      contexts: any[] = [];
    const ai = new AiQueue(s, config, () => {}, {
      complete: async (_key, _model, _system, text, _max, _signal, options) => {
        const context = JSON.parse(text);
        contexts.push(context);
        return {
          content: options?.text ? `AI 回答 ${contexts.length}` : JSON.stringify({
            threadId: null,
            newThreadTitle: "建议问题",
            title: "标题",
            synopsis: "",
            reply: `AI 回答 ${contexts.length}`,
          }),
          input: 100,
          output: 50,
        };
      },
    });
    const root = s.capture({ raw: "起始笔记" });
    await ai.pump();
    const first = s.capture({
      raw: "第一轮回复",
      mode: "discussion",
      parentNoteId: root,
    });
    await ai.pump();
    s.capture({ raw: "第二轮回复", mode: "discussion", parentNoteId: root });
    await ai.pump();
    expect(contexts[1].history[0].aiReply).toBe("AI 回答 1");
    expect(contexts[2].history.map((n: any) => n.aiReply)).toEqual([
      "AI 回答 1",
      "AI 回答 2",
    ]);
    expect(s.detail(root).discussions).toHaveLength(2);
    expect(s.snapshot().structures).toHaveLength(1);
    const t = s.thread({ title: "随后归属", description: "", parentId: null });
    s.append("note.moved", { id: first, threadId: t });
    expect(s.note(root).threadId).toBe(t);
    expect(s.detail(root).discussions.every((n) => n.threadId === t)).toBe(
      true,
    );
  });
  it("uses user and AI dialogue in thread reviews while distinguishing attribution", async () => {
    const s = open(),
      t = s.thread({ title: "线程回顾", description: "", parentId: null });
    const root = s.capture({ raw: "原始想法", threadId: t });
    const reply = s.capture({
      raw: "我明确补充的立场",
      threadId: t,
      mode: "discussion",
      parentNoteId: root,
    });
    for (const [id, text] of [
      [root, "AI 的追问"],
      [reply, "AI 的建议"],
    ])
      s.append("note.completed", {
        id,
        threadId: t,
        inputRevision: 0,
        result: {
          threadId: t,
          newThreadTitle: null,
          title: "标题",
          synopsis: "",
          reply: text,
        },
      });
    const contexts: any[] = [];
    const ai = new AiQueue(s, config, () => {}, {
      complete: async (_key, _model, instructions, text) => {
        const context = JSON.parse(text);
        contexts.push(context);
        expect(instructions).toContain("aiReply");
        expect(instructions).toContain("用户");
        const evidenceIds = context.history.map((n: any) => n.id);
        return {
          content: JSON.stringify(
            instructions.includes("输出 after")
              ? {
                  after: {
                    viewpoint: "用户观点",
                    reasons: [],
                    uncertainties: [],
                    questions: [],
                    decisions: [],
                  },
                  reason: "对话中的原话",
                  evidenceIds,
                }
              : {
                  expressed: "用户明确表达",
                  possible: "AI 推测",
                  questions: "待追问",
                  evidenceIds,
                },
          ),
          input: 100,
          output: 100,
        };
      },
    });
    await ai.recap(t, "deepseek-flash");
    await ai.propose(t, "deepseek-flash");
    expect(contexts).toHaveLength(2);
    for (const c of contexts) {
      expect(c.history.find((n: any) => n.id === root).aiReply).toBe(
        "AI 的追问",
      );
      expect(c.history.find((n: any) => n.id === reply)).toMatchObject({
        raw: "我明确补充的立场",
        aiReply: "AI 的建议",
        parentNoteId: root,
      });
    }
    expect(s.snapshot().recaps[0].sampled).toBe(2);
  });
  it("generates metadata in one call and proposes a thread without creating it", async () => {
    const s = open();
    s.capture({ raw: "城市密度" });
    s.capture({ raw: "同一问题的新想法" });
    let calls = 0;
    const transport: AiTransport = {
      complete: async (_key, model, _system, context) => {
        calls++;
        expect(model).toBe("deepseek-flash");
        const data = JSON.parse(context);
        const thread = data.threads[0];
        return {
          content: JSON.stringify({
            threadId: thread?.id ?? null,
            newThreadTitle: thread ? null : "城市规划",
            title: "密度的权衡",
            synopsis: "我在思考密度与生活的关系。",
            reply: "密度之外，交通能力是否同样重要？",
          }),
          input: 100,
          output: 80,
        };
      },
    };
    const ai = new AiQueue(s, config, () => {}, transport);
    await ai.pump();
    await ai.pump();
    expect(calls).toBe(2);
    expect(s.snapshot().threads).toHaveLength(0);
    expect(s.snapshot().structures).toHaveLength(1);
    expect(s.snapshot().structures[0].noteIds).toHaveLength(2);
    s.resolveStructures([s.snapshot().structures[0].id], "accept");
    expect(s.snapshot().threads).toHaveLength(1);
    expect(s.snapshot().notes[0].synopsis).toBe("");
    expect(s.snapshot().notes.every((n) => n.status === "done")).toBe(true);
    expect(s.snapshot().notes[0].raw).toBe("城市密度");
    expect(s.snapshot().usage).toHaveLength(2);
  });
  it("retains original and returned usage when AI gives invalid fields, with no automatic retry", async () => {
    const s = open();
    const id = s.capture({ raw: "不可丢失" });
    let calls = 0;
    const transport: AiTransport = {
      complete: async () => {
        calls++;
        return { content: '{"title":"缺失字段"}', input: 100, output: 20 };
      },
    };
    const ai = new AiQueue(s, config, () => {}, transport);
    await ai.pump();
    await ai.pump();
    expect(calls).toBe(2);
    expect(s.snapshot().notes[0].status).toBe("partial");
    expect(s.snapshot().notes[0].raw).toBe("不可丢失");
    expect(s.snapshot().usage).toHaveLength(2);
    s.append("note.retried", { id });
    await ai.pump();
    expect(calls).toBe(2); // Reuses the durable response; does not bill the same incomplete step again.
  });
  it("does not call AI when key or daily budget is unavailable", async () => {
    const s = open();
    expect(() =>
      s.capture({ raw: "自动记录", model: "deepseek-v4-pro" }),
    ).toThrow("当前仅支持 DeepSeek Flash");
    s.capture({ raw: "原文" });
    let calls = 0;
    const transport: AiTransport = {
      complete: async () => {
        calls++;
        throw new Error("should not call");
      },
    };
    await new AiQueue(
      s,
      { ...config, apiKey: () => "" },
      () => {},
      transport,
    ).pump();
    expect(s.snapshot().notes[0].status).toBe("pending");
    expect(calls).toBe(0);
    const limited = {
      ...config,
      settings: () =>
        settingsSchema.parse({ hardBudget: true, dailyInputLimit: 8000, dailyOutputLimit: 3000 }),
    };
    s.append("usage.recorded", {
      id: crypto.randomUUID(),
      input: 8000,
      output: 1,
      model: "deepseek-flash",
      createdAt: new Date().toISOString(),
    });
    await new AiQueue(s, limited, () => {}, transport).pump();
    expect(calls).toBe(0);
    expect(s.snapshot().notes[0].error).toContain("预算");
  });
  it("bounds the context regardless of history length and rejects oversized source", () => {
    const s = open();
    for (let i = 0; i < 30; i++) s.capture({ raw: "城市密度".repeat(100) + i });
    const context = buildContext(s, "城市密度", null);
    expect(countTokens(context)).toBeLessThan(32768);
    expect(JSON.parse(context).history.length).toBeLessThanOrEqual(30);
    expect(() => buildContext(s, "想法".repeat(50000), null)).toThrow("预算");
  });
  it("preserves a manual move made while an AI request is in flight", async () => {
    const s = open();
    const old = randomUUID(),
      moved = randomUUID();
    for (const id of [old, moved])
      s.append("thread.added", {
        id,
        title: id === old ? "旧线程" : "新线程",
        createdAt: new Date().toISOString(),
      });
    const id = s.capture({ raw: "思考", threadId: old });
    const transport: AiTransport = {
      complete: async () => {
        s.append("note.moved", { id, threadId: moved });
        return {
          content: JSON.stringify({
            threadId: old,
            newThreadTitle: null,
            title: "思考的条件",
            synopsis: "我记录了一个想法。",
            reply: "还需要哪些条件？",
          }),
          input: 100,
          output: 50,
        };
      },
    };
    await new AiQueue(s, config, () => {}, transport).pump();
    expect(s.snapshot().notes[0].threadId).toBe(moved);
    expect(s.snapshot().notes[0].status).toBe("done");
  });
  it("rejects a hallucinated thread without losing the note or retrying automatically", async () => {
    const s = open();
    s.capture({ raw: "新想法" });
    const transport: AiTransport = {
      complete: async () => ({
        content: JSON.stringify({
          threadId: randomUUID(),
          newThreadTitle: null,
          title: "标题",
          synopsis: "概述。",
          reply: "追问。",
        }),
        input: 100,
        output: 50,
      }),
    };
    await new AiQueue(s, config, () => {}, transport).pump();
    expect(s.snapshot().notes[0].status).toBe("partial");
    expect(s.snapshot().threads).toHaveLength(0);
    expect(s.snapshot().notes[0].raw).toBe("新想法");
  });
  it("counts an unconfirmed request against the budget instead of making further paid attempts", async () => {
    const s = open();
    s.capture({ raw: "第一条" });
    s.capture({ raw: "第二条" });
    let calls = 0;
    const transport: AiTransport = {
      complete: async () => {
        calls++;
        throw new Error("模拟请求中断");
      },
    };
    const limited = {
      ...config,
      settings: () =>
        settingsSchema.parse({ hardBudget: true, dailyInputLimit: 8000, dailyOutputLimit: 2500 }),
    };
    await new AiQueue(s, limited, () => {}, transport).pump();
    expect(calls).toBe(1);
    expect(s.snapshot().reservations).toHaveLength(1);
    expect(s.snapshot().notes[1].error).toContain("预算");
  });
});
