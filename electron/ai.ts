import { z } from "zod";
import type { Settings } from "../src/shared";
import { outputSchema } from "./ai-schema";
export interface AiConfig {
  apiKey(): string;
  settings(): Settings;
}
export interface Completion {
  content: string;
  input: number;
  output: number;
  finishReason?: string | null;
  usageKnown?: boolean;
}
export interface CompletionOptions {
  text?: boolean;
  onDelta?: (text: string) => void;
}
export interface AiTransport {
  complete(
    key: string,
    model: string,
    system: string,
    context: string,
    maxOutput: number,
    signal?: AbortSignal,
    options?: CompletionOptions,
  ): Promise<Completion>;
}
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter = 0,
  ) {
    super(message);
  }
  get notBilled() {
    return [400, 401, 402, 422, 429].includes(this.status);
  }
  get retryable() {
    return [429, 500, 503].includes(this.status);
  }
}
export class DeepSeek implements AiTransport {
  async complete(
    key: string,
    model: string,
    system: string,
    context: string,
    maxOutput: number,
    signal?: AbortSignal,
    options?: CompletionOptions,
  ): Promise<Completion> {
    const controller = new AbortController();
    let idle = setTimeout(
      () => controller.abort(new DOMException("响应等待超时", "TimeoutError")),
      120000,
    );
    const reset = () => {
      clearTimeout(idle);
      idle = setTimeout(
        () => controller.abort(new DOMException("响应中断", "TimeoutError")),
        90000,
      );
    };
    try {
      const response = await fetch("https://api.deepseek.com/responses", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(600000),
          ...(signal ? [signal] : []),
        ]),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "deepseek-flash",
          instructions: system,
          input: [{ role: "user", content: context }],
          reasoning: { effort: "none" },
          max_output_tokens: maxOutput,
          stream: !!options?.text,
          text: {
            format: options?.text
              ? { type: "text" }
              : {
                  type: "json_schema",
                  name: "chatnote_result",
                  schema: outputSchema(system),
                },
          },
        }),
      });
      if (!response.ok) {
        const messages: Record<number, string> = {
          401: "DeepSeek API key 无效，请检查设置",
          402: "DeepSeek 余额不足",
          429: "DeepSeek 请求受限，等待重试",
          500: "DeepSeek 服务异常",
          503: "DeepSeek 服务繁忙",
        };
        throw new RequestError(
          messages[response.status] ??
            `DeepSeek 请求失败（HTTP ${response.status}）`,
          response.status,
          Math.min(
            60000,
            Math.max(0, Number(response.headers.get("retry-after")) * 1000),
          ),
        );
      }
      let data: any,
        content = "";
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = response.body!.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          reset();
          buffer = (
            buffer + decoder.decode(chunk.value, { stream: true })
          ).replace(/\r\n/g, "\n");
          if (buffer.length > 2_000_000) throw new Error("AI 响应超出安全大小");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const line = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("\n");
            if (!line || line === "[DONE]") continue;
            const event = JSON.parse(line);
            if (event.type === "response.output_text.delta") {
              content += event.delta ?? "";
              if (content.length > 500000)
                throw new Error("AI 响应超出安全大小");
              options?.onDelta?.(content);
            }
            if (
              [
                "response.completed",
                "response.incomplete",
                "response.failed",
              ].includes(event.type)
            )
              data = event.response;
          }
          if (data) {
            await reader.cancel();
            break;
          }
        }
        if (!data)
          throw new Error(
            "AI 连接中断，结果与计费无法确认；已收到的文字保留，请手动重试",
          );
      } else data = await response.json();
      content =
        data.choices?.[0]?.message?.content ??
        (data.output
          ?.filter((x: any) => x.type === "message")
          .flatMap((x: any) => x.content ?? [])
          .filter((x: any) => x.type === "output_text")
          .map((x: any) => x.text)
          .join("") ||
          content);
      if (typeof content !== "string")
        throw new Error("AI 没有返回可读取的文字");
      if (data.status === "failed")
        throw new Error("AI 服务未完成本次生成，请重试");
      const input = data.usage?.input_tokens ?? data.usage?.prompt_tokens,
        output = data.usage?.output_tokens ?? data.usage?.completion_tokens;
      const known =
        Number.isInteger(input) &&
        input >= 0 &&
        Number.isInteger(output) &&
        output >= 0;
      return {
        content,
        input: known ? input : 0,
        output: known ? output : 0,
        usageKnown: known,
        finishReason:
          data.choices?.[0]?.finish_reason ??
          (data.status === "incomplete"
            ? data.incomplete_details?.reason === "max_output_tokens"
              ? "length"
              : "content_filter"
            : "stop"),
      };
    } finally {
      clearTimeout(idle);
    }
  }
}
export function safeAiError(e: unknown): string {
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return "部分 AI 字段无法读取，已保存有效内容；可重试未完成步骤。";
  if (e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name))
    return "AI 请求中断，计费待核对。已保存内容保留，可手动重试。";
  if (e instanceof Error && e.message === "fetch failed")
    return "无法连接 DeepSeek，请检查网络后重试";
  return e instanceof Error
    ? e.message.slice(0, 1000).replace(/sk-[A-Za-z0-9_-]+/g, "[已隐藏]")
    : "AI 处理失败";
}
export { AiQueue, buildContext } from "./queue-v2";
