import { useState } from "react";
import type { AiTask, Note } from "../shared";
import type { Action } from "./RecordCard";
export function AnalysisControls({
  threadId,
  count,
  tasks,
  hasApiKey,
  onAction,
  onSettings,
  onResult,
}: {
  threadId: string;
  count: number;
  tasks: AiTask[];
  hasApiKey: boolean;
  onAction: Action;
  onSettings(): void;
  onResult(task: AiTask): void;
}) {
  const [pro, setPro] = useState(false),
    [submitting, setSubmitting] = useState<string | null>(null),
    [error, setError] = useState("");
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const taskFor = (kind: AiTask["kind"]) => {
    const matching = tasks
      .filter((t) => t.threadId === threadId && t.kind === kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return (
      matching.find((t) => t.id === receipts[kind]) ??
      matching.find((t) => t.status === "running") ??
      matching.find((t) => t.status === "pending") ??
      matching[0]
    );
  };
  const start = (kind: "cognition" | "recap") => {
    setSubmitting(kind);
    setError("");
    const model: Note["model"] = pro ? "deepseek-v4-pro" : "deepseek-flash";
    setPro(false);
    onAction(async () => {
      try {
        const id = await (kind === "recap"
          ? window.uki.recap(threadId, model)
          : window.uki.propose(threadId, model));
        setReceipts((r) => ({ ...r, [kind]: id }));
      } catch (e) {
        setError(
          String(e instanceof Error ? e.message : e).replace(
            /^Error invoking remote method '[^']+': Error: /,
            "",
          ),
        );
        throw e;
      } finally {
        setSubmitting(null);
      }
    });
  };
  return (
    <div className="analysis-controls">
      <label className="check">
        <input
          type="checkbox"
          checked={pro}
          onChange={(e) => setPro(e.target.checked)}
          disabled={!!submitting}
        />
        本次主动分析使用 Pro
      </label>
      {(["cognition", "recap"] as const).map((kind) => {
        const task = taskFor(kind),
          active =
            !!task && ["pending", "running", "budget"].includes(task.status),
          busy = submitting === kind;
        const label = kind === "cognition" ? "检查认知变化" : "生成线程回顾";
        const status = busy
          ? "正在提交任务…"
          : task?.status === "pending"
            ? "已排队，等待 AI 执行"
            : task?.status === "running"
              ? "AI 正在生成，请稍候…"
              : task?.status === "budget"
                ? "今日预算不足，明日自动继续"
                : task?.status === "failed"
                  ? "生成失败"
                  : task?.status === "partial"
                    ? "部分完成，有些内容需要重试"
                    : task?.status === "done"
                      ? "生成完成，结果已保存"
                      : null;
        return (
          <section className="analysis-task" key={kind}>
            <button
              onClick={() => start(kind)}
              disabled={!hasApiKey || !count || busy || active}
            >
              {label}
            </button>
            <p className="hint">
              {kind === "cognition"
                ? "对照已确认认知提出修改建议，由你审批。"
                : "总结相关记录与讨论，附原文引用。"}
            </p>
            {status && (
              <div
                className={`analysis-progress ${task?.status ?? "pending"}`}
                role="status"
                aria-live="polite"
              >
                <strong>{status}</strong>
                {task?.error && <p>{task.error}</p>}
                {task?.status === "done" && task.resultId && (
                  <button onClick={() => onResult(task)}>
                    {kind === "recap" ? "查看回顾" : "查看认知建议"}
                  </button>
                )}
                {task &&
                  ["failed", "budget", "partial"].includes(task.status) && (
                    <button
                      disabled={!hasApiKey || busy}
                      onClick={() => {
                        setSubmitting(kind);
                        onAction(async () => {
                          try {
                            await window.uki.retryTask(task.id);
                          } finally {
                            setSubmitting(null);
                          }
                        });
                      }}
                    >
                      手动重试
                    </button>
                  )}
              </div>
            )}
          </section>
        );
      })}
      {!hasApiKey && (
        <p className="hint">
          配置 DeepSeek 后才能生成分析。
          <button onClick={onSettings}>打开设置</button>
        </p>
      )}
      {!count && <p className="hint">这个问题还没有记录，请先添加笔记。</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
