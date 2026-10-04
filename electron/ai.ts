import { z } from "zod";
import type { Settings } from "../src/shared";
export interface AiConfig {
  apiKey(): string;
  settings(): Settings;
}
export interface Completion {
  content: string;
  input: number;
  output: number;
  finishReason?: string | null;
}
export interface AiTransport {
  complete(
    key: string,
    model: string,
    system: string,
    context: string,
    maxOutput: number,
    signal?: AbortSignal,
  ): Promise<Completion>;
}
class RejectedRequest extends Error {
  readonly notBilled = true;
}
export class DeepSeek implements AiTransport {
  async complete(
    key: string,
    model: string,
    system: string,
    context: string,
    maxOutput: number,
    signal?: AbortSignal,
  ): Promise<Completion> {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: context },
        ],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: maxOutput,
        stream: false,
      }),
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new RejectedRequest("DeepSeek API key 无效，请检查设置");
      if (response.status === 402)
        throw new RejectedRequest("DeepSeek 余额不足");
      if (response.status === 429)
        throw new RejectedRequest("DeepSeek 请求受限，请稍后手动重试");
      throw new Error(`DeepSeek 请求失败（HTTP ${response.status}）`);
    }
    const data = z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({ content: z.string().nullable() }),
              finish_reason: z.string().nullable().optional(),
            }),
          )
          .min(1),
        usage: z.object({
          prompt_tokens: z.number().int().nonnegative(),
          completion_tokens: z.number().int().nonnegative(),
        }),
      })
      .parse(await response.json());
    return {
      content: data.choices[0].message.content ?? "",
      input: data.usage.prompt_tokens,
      output: data.usage.completion_tokens,
      finishReason: data.choices[0].finish_reason,
    };
  }
}
export function safeAiError(e: unknown): string {
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return "AI 返回格式不完整或字段长度不符。原文已保留，可手动重试。";
  if (
    e instanceof Error &&
    (e.name === "TimeoutError" || e.name === "AbortError")
  )
    return "AI 请求超时，无法确认计费。请检查后手动重试。";
  if (e instanceof Error && e.message === "fetch failed")
    return "无法连接 DeepSeek，请检查网络后手动重试";
  return e instanceof Error
    ? e.message.slice(0, 1000).replace(/sk-[A-Za-z0-9_-]+/g, "[已隐藏]")
    : "AI 处理失败";
}
export { AiQueue, buildContext } from "./queue-v2";
