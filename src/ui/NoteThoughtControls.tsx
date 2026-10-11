import { useEffect, useRef, useState } from "react";
import type { AiTask, Evidence, Note, Recap } from "../shared";
import type { Action } from "./RecordCard";
import { RecapContent } from "./WorkUnits";

export function NoteThoughtControls({
  note,
  tasks,
  hasApiKey,
  onAction,
  onEvidence,
}: {
  note: Note;
  tasks: AiTask[];
  hasApiKey: boolean;
  onAction: Action;
  onEvidence(value: Evidence): void;
}) {
  const [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const [open, setOpen] = useState(false),
    [result, setResult] = useState<Recap | null>(null);
  const task = tasks
    .filter(
      (t) =>
        t.kind === "recap" &&
        t.selection?.notes.length === 1 &&
        t.selection.notes[0].noteId === note.id,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const active =
    !!task && ["pending", "running", "budget"].includes(task.status);
  useEffect(() => {
    setOpen(false);
  }, [task?.id]);
  return (
    <div className="note-thought-controls">
      <button
        disabled={sending || active || !hasApiKey || !!note.deletedAt}
        title={
          !hasApiKey
            ? "请先配置 DeepSeek"
            : active
              ? "已有分析任务正在执行"
              : "分析这条笔记的最新正文：依据、不同视角与下一步问题"
        }
        onClick={() => {
          if (lock.current || sending || active) return;
          lock.current = true;
          setSending(true);
          setError("");
          onAction(async () => {
            try {
              await window.uki.analyzeSelection({
                question:
                  "请围绕这条笔记进一步思考：梳理明确表达、值得核对的假设、不同视角与下一步问题。",
                notes: [{ noteId: note.id, revision: note.revision ?? 0 }],
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              lock.current = false;
              setSending(false);
            }
          });
        }}
      >
        AI 思考
      </button>
      {(sending || active) && (
        <span role="status" className="hint">
          {sending
            ? "正在提交…"
            : task?.status === "running"
              ? "AI 正在思考…"
              : task?.status === "budget"
                ? "等待预算恢复"
                : "已排队"}
        </span>
      )}
      {task && ["done", "partial"].includes(task.status) && task.resultId && (
        <button
          aria-expanded={open}
          onClick={async () => {
            setOpen((v) => !v);
            if (result?.id !== task.resultId) {
              try {
                setResult(await window.uki.recapDetail(task.resultId!));
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }
          }}
        >
          {open ? "收起思考" : "查看思考"}
        </button>
      )}
      {open && (
        <section
          className="note-thought-result"
          aria-label="这条笔记的 AI 思考"
        >
          {result?.id === task?.resultId ? (
            <RecapContent value={result!} onEvidence={onEvidence} />
          ) : (
            <p role="status">正在打开结果…</p>
          )}
        </section>
      )}
      {task?.status === "failed" && (
        <span className="error" role="status">
          {task.error}
          <button onClick={() => onAction(() => window.uki.retryTask(task.id))}>
            重试思考
          </button>
        </span>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
