import { useEffect, useRef, useState } from "react";
import type { AiTask } from "../shared";
import type { Action } from "./RecordCard";
export function ResearchControls({
  noteId = null,
  threadId = null,
  title,
  tasks,
  hasApiKey,
  onAction,
  onResult,
  onSource,
}: {
  noteId?: string | null;
  threadId?: string | null;
  title: string;
  tasks: AiTask[];
  hasApiKey: boolean;
  onAction: Action;
  onResult(task: AiTask): void;
  onSource(ownerId: string, sourceId: string): void;
}) {
  const [open, setOpen] = useState(false),
    [question, setQuestion] = useState(title.slice(0, 300)),
    [queries, setQueries] = useState(title.slice(0, 180)),
    [ready, setReady] = useState(false),
    [receipt, setReceipt] = useState<string | null>(null),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState("");
  const key = `research:${noteId ?? threadId}`;
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void window.uki
      .workspaceState(key)
      .then((saved) => {
        if (!active) return;
        if (saved.draft) {
          try {
            const value = JSON.parse(saved.draft);
            if (
              typeof value.question === "string" &&
              typeof value.queries === "string"
            ) {
              setQuestion(value.question);
              setQueries(value.queries);
            }
          } catch {
            /* Leave invalid local draft untouched until edited. */
          }
        }
        setReady(true);
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    const save = () =>
      window.uki.workspaceState(key, {
        draft: JSON.stringify({ question, queries }),
        mode: "note",
        parentNoteId: null,
        openIds: [],
      });
    void save().catch((e) => setError(String(e.message)));
  }, [key, ready, question, queries]);
  const matching = tasks
    .filter(
      (t) =>
        t.kind === "research" &&
        (noteId
          ? t.research?.noteId === noteId
          : !t.research?.noteId && t.threadId === threadId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const task =
    matching.find((t) => t.id === receipt) ??
    matching.find((t) => ["pending", "running", "budget"].includes(t.status)) ??
    matching[0];
  const busy =
    submitting ||
    (!!task && ["pending", "running", "budget"].includes(task.status));
  const status = submitting
    ? "正在提交…"
    : task?.status === "running"
      ? task.research?.automatic && !task.research.planned
        ? "正在提炼公开检索词…"
        : {
            search: "正在检索公开资料…",
            read: "正在读取来源正文…",
            analyze: "正在分析资料与想法…",
            queued: "正在准备…",
            done: "正在保存结果…",
          }[task.researchStage ?? "queued"]
      : task?.status === "pending"
        ? "已排队，等待查找资料"
        : task?.status === "budget"
          ? "今日预算不足，明日继续；已完成的步骤会保留"
          : task?.status === "partial"
            ? "资料分析部分完成"
            : task?.status === "done"
              ? "资料分析完成"
              : task?.status === "failed"
                ? "资料分析未完成"
                : task?.status === "cancelled"
                  ? "已取消"
                  : "";
  const start = (automatic: boolean) => {
    if (lock.current || busy || !hasApiKey) return;
    lock.current = true;
    setSubmitting(true);
    setError("");
    onAction(async () => {
      try {
        const id = automatic
          ? await window.uki.researchAuto(
              noteId ? { noteId } : { threadId: threadId! },
            )
          : await window.uki.research({
              noteId,
              threadId,
              question,
              queries: queries
                .split(/\r?\n/)
                .map((q) => q.trim())
                .filter(Boolean),
            });
        setReceipt(id);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        lock.current = false;
        setSubmitting(false);
      }
    });
  };
  return (
    <section className="research-controls">
      <button
        onClick={() => start(true)}
        disabled={busy || !hasApiKey}
        title={
          !hasApiKey
            ? "请先配置 DeepSeek"
            : "会联网。AI 从当前对象提炼公开检索词，再查找并核对来源；无需重新填写问题。"
        }
      >
        外部资料查证
      </button>
      <button
        className="quiet"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        自定义查证
      </button>
      {status && (
        <p role="status" className="hint">
          {status}
          {task?.sourceCount ? ` · ${task.sourceCount} 个来源` : ""}
        </p>
      )}
      {task?.error && <p className="error-text">{task.error}</p>}
      {!!task?.sourceLabels?.length && task.status !== "done" && (
        <details>
          <summary>查看已找到的来源</summary>
          {task.sourceLabels.map((source) => (
            <p key={source.id} className="research-source-row">
              <button onClick={() => onSource(task.id, source.id)}>
                {source.title}
              </button>
              <span className="hint">
                {source.status === "read" ? "已读片段" : "未取得正文"}
              </span>
            </p>
          ))}
        </details>
      )}
      {task && ["done", "partial"].includes(task.status) && task.resultId && (
        <button onClick={() => onResult(task)}>查看资料分析</button>
      )}
      {task && ["failed", "budget", "partial"].includes(task.status) && (
        <button onClick={() => onAction(() => window.uki.retryTask(task.id))}>
          重试资料分析
        </button>
      )}
      {task && ["pending", "running", "budget"].includes(task.status) && (
        <button
          onClick={() => onAction(() => window.uki.cancelResearch(task.id))}
        >
          取消查找
        </button>
      )}
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(false);
          }}
        >
          <p className="hint">
            围绕这个想法核对事实或寻找不同视角。只有你确认后才联网，结果不会自动修改原文或已确认认知。
          </p>
          <label>
            想核对什么
            <textarea
              aria-label="资料分析问题"
              maxLength={300}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
            />
          </label>
          <label>
            可公开的搜索词
            <textarea
              aria-label="公开搜索词"
              placeholder="每行一组，最多两组；不要包含姓名、账户或私人细节"
              maxLength={362}
              value={queries}
              onChange={(e) => setQueries(e.target.value)}
              required
            />
          </label>
          <p className="hint">
            搜索服务只接收这里的搜索词。AI
            分析会使用所选笔记或问题的少量原文与已读资料。检索和分析共用每日
            Flash 预算。
          </p>
          {!hasApiKey && (
            <p className="hint">请先在设置中配置 DeepSeek API key。</p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="primary"
            disabled={!ready || busy || !hasApiKey}
          >
            确认搜索并分析
          </button>
        </form>
      )}
      {!open && error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}
