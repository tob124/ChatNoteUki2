import { createHash, randomUUID } from "node:crypto";
import { Store } from "./store";
import {
  RequestError,
  type AiConfig,
  type AiTransport,
  type Completion,
  type CompletionOptions,
} from "./ai";
import { countTokens } from "./token-count";
import { outputSchema } from "./ai-schema";

export class BudgetError extends Error {}
export class PartialResultError extends Error {
  constructor(
    message: string,
    readonly value: unknown,
  ) {
    super(message);
  }
}
type Attempt = {
  id: string;
  phase: "started" | "completed" | "rejected";
  result?: Completion;
  error?: string;
  partial?: string;
  createdAt?: string;
};
export class AiRequests {
  constructor(
    private store: Store,
    private config: AiConfig,
    private transport: AiTransport,
    private progress: (stage: string) => void,
  ) {}
  budget(
    system: string,
    context: string,
    output: number,
    model = "deepseek-flash",
    text = false,
  ) {
    const settings = this.config.settings();
    const input = countTokens(
      system + context + (text ? "" : JSON.stringify(outputSchema(system))),
      model,
    );
    if (input > settings.contextTokens)
      throw new Error(
        `本次上下文约 ${input.toLocaleString()} tokens，超过设置容量；原文已保存，请拆分材料或提高上下文容量。`,
      );
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
    }).format(new Date());
    const used = this.store.dailyUsage(day);
    if (
      settings.hardBudget &&
      (used.input + input > settings.dailyInputLimit ||
        used.output + output > settings.dailyOutputLimit)
    )
      throw new BudgetError(
        "今日 AI 硬上限已到，明日自动继续；也可在设置中关闭硬上限。",
      );
    if (
      used.input > settings.dailyInputLimit ||
      used.output > settings.dailyOutputLimit
    )
      this.progress("今日 AI 用量超过提醒阈值，任务继续执行");
    return input;
  }
  async run(
    owner: string,
    system: string,
    context: string,
    model: string,
    output: number,
    signal?: AbortSignal,
    options?: CompletionOptions,
    validate?: (value: unknown) => unknown,
    onCompletion?: (r: Completion) => void,
  ): Promise<{ value: any; usage: { input: number; output: number } }> {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          owner,
          model,
          system,
          context,
          !!options?.text,
          this.store.getMeta("ai-retry:" + owner),
        ]),
      )
      .digest("hex");
    const cacheKey = "ai-step:" + owner + ":" + fingerprint;
    const attempts: Attempt[] = JSON.parse(
      this.store.getMeta(cacheKey) ?? "[]",
    );
    let repaired = false,
      expanded = false,
      last: Completion | undefined,
      repairPrompt = "";
    const save = () => this.store.setMeta(cacheKey, JSON.stringify(attempts));
    const usage = () =>
      attempts.reduce(
        (sum, a) => ({
          input: sum.input + (a.result?.input ?? 0),
          output: sum.output + (a.result?.output ?? 0),
        }),
        { input: 0, output: 0 },
      );
    for (let index = 0; index < 3; index++) {
      signal?.throwIfAborted();
      let attempt = attempts[index];
      if (attempt?.phase === "started")
        throw new Error("上次请求中断，计费无法确认；请在任务面板明确重试。");
      if (attempt?.phase === "rejected") {
        if (attempt.error === "retryable") continue;
        throw new Error(attempt.error ?? "请求失败，请手动重试");
      }
      if (!attempt) {
        const prompt = system + repairPrompt;
        const input = this.budget(
          prompt,
          context,
          output,
          model,
          !!options?.text,
        );
        const key = this.config.apiKey();
        if (!key) throw new Error("请先配置 DeepSeek API key");
        attempt = {
          id: randomUUID(),
          phase: "started",
          createdAt: new Date().toISOString(),
        };
        attempts.push(attempt);
        save();
        this.store.append("usage.reserved", {
          id: attempt.id,
          input,
          output,
          model,
          createdAt: new Date().toISOString(),
        });
        this.progress(
          repairPrompt ? "修复返回格式" : index ? "重新生成" : "生成中",
        );
        try {
          let savedLength = 0;
          const result = await this.transport.complete(
            key,
            model,
            prompt,
            context,
            output,
            signal,
            {
              ...options,
              onDelta: (text) => {
                attempt.partial = text;
                if (text.length - savedLength >= 512) {
                  save();
                  savedLength = text.length;
                }
                options?.onDelta?.(text);
              },
            },
          );
          // A confirmed provider response is durable before any parsing or application.
          attempt.result = result;
          attempt.phase = "completed";
          save();
          this.store.append("usage.recorded", {
            id: attempt.id,
            input: result.usageKnown === false ? input : result.input,
            output:
              result.usageKnown === false
                ? countTokens(result.content, model)
                : result.output,
            estimated: result.usageKnown === false,
            model,
            createdAt: new Date().toISOString(),
          });
        } catch (e) {
          save();
          if (e instanceof RequestError) {
            attempt.phase = "rejected";
            attempt.error = e.retryable ? "retryable" : e.message;
            save();
            if (e.notBilled)
              this.store.append("usage.released", { id: attempt.id });
            if (e.retryable && index < 2) {
              this.progress("等待服务重试");
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(
                  resolve,
                  Math.max(e.retryAfter, (index + 1) * 1500),
                );
                signal?.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(timer);
                    reject(signal.reason);
                  },
                  { once: true },
                );
              });
              continue;
            }
          }
          throw e;
        }
      }
      last = attempt.result!;
      if (!this.store.hasUsage(attempt.id))
        this.store.append("usage.recorded", {
          id: attempt.id,
          input:
            last.usageKnown === false
              ? countTokens(
                  system +
                    context +
                    (options?.text ? "" : JSON.stringify(outputSchema(system))),
                  model,
                )
              : last.input,
          output:
            last.usageKnown === false
              ? countTokens(last.content, model)
              : last.output,
          estimated: last.usageKnown === false,
          model,
          createdAt: attempt.createdAt ?? new Date().toISOString(),
        });
      onCompletion?.(last);
      if (last.finishReason === "length") {
        if (!expanded && index < 2) {
          expanded = true;
          output = Math.min(32768, output * 2);
          continue;
        }
        throw new Error(
          "AI 输出仍被截断，已保留返回内容；请缩小材料范围后重试。",
        );
      }
      if (!last.content.trim()) {
        if (index < 2) continue;
        throw new Error("AI 连续返回空内容，请稍后手动重试。");
      }
      try {
        const value = options?.text
          ? last.content
          : JSON.parse(
              last.content
                .trim()
                .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1"),
            );
        return {
          value: validate
            ? validate(this.store.display(value))
            : options?.text
              ? this.store.display({ reply: value }).reply
              : this.store.display(value),
          usage: usage(),
        };
      } catch (e) {
        if (options?.text || repaired || index >= 2) {
          if (e instanceof PartialResultError)
            return { value: e.value, usage: usage() };
          throw e;
        }
        repaired = true;
        repairPrompt =
          "\n只修复下面返回内容的字段类型、遗漏和 JSON 格式。不得新增事实、观点或引用；无法从已有文字确定的字段留空。原返回：" +
          last.content;
      }
    }
    throw new Error(
      "已达到本步骤三次请求上限，已保存返回内容，请手动检查后重试。",
    );
  }
  allowManualRetry(owner: string) {
    this.store.setMeta(
      "ai-retry:" + owner,
      String(Number(this.store.getMeta("ai-retry:" + owner) ?? 0) + 1),
    );
    // Completed steps are reusable; only ambiguous/not-billed failures require explicit new attempts.
    const keys = this.store.metaKeys("ai-step:" + owner + ":");
    for (const key of keys) {
      const attempts: Attempt[] = JSON.parse(this.store.getMeta(key) ?? "[]");
      if (attempts.some((a) => a.phase !== "completed"))
        this.store.setMeta(
          key,
          JSON.stringify(attempts.filter((a) => a.phase === "completed")),
        );
    }
  }
}
