import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../../electron/store";
import { AiQueue, buildContext, type AiTransport } from "../../electron/ai";
import { settingsSchema } from "../../src/shared";
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
  it("generates title, synopsis, classification and reply in one call and reuses a new thread", async () => {
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
    expect(s.snapshot().threads).toHaveLength(1);
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
    expect(calls).toBe(1);
    expect(s.snapshot().notes[0].status).toBe("failed");
    expect(s.snapshot().notes[0].raw).toBe("不可丢失");
    expect(s.snapshot().usage).toHaveLength(1);
    s.append("note.retried", { id });
    await ai.pump();
    expect(calls).toBe(2);
  });
  it("does not call AI when key or daily budget is unavailable", async () => {
    const s = open();
    expect(() =>
      s.capture({ raw: "自动记录", model: "deepseek-v4-pro" }),
    ).toThrow("Pro 仅用于主动讨论");
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
        settingsSchema.parse({ dailyInputLimit: 8000, dailyOutputLimit: 1000 }),
    };
    s.append("usage.recorded", {
      id: crypto.randomUUID(),
      input: 1,
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
    expect(Buffer.byteLength(context)).toBeLessThan(7400);
    expect(JSON.parse(context).history.length).toBeLessThanOrEqual(10);
    expect(() => buildContext(s, "想法".repeat(2000), null)).toThrow("预算");
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
    expect(s.snapshot().notes[0].status).toBe("failed");
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
        settingsSchema.parse({ dailyInputLimit: 8000, dailyOutputLimit: 1000 }),
    };
    await new AiQueue(s, limited, () => {}, transport).pump();
    expect(calls).toBe(1);
    expect(s.snapshot().reservations).toHaveLength(1);
    expect(s.snapshot().notes[1].error).toContain("预算");
  });
});
