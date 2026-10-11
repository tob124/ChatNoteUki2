import { useEffect, useRef, useState } from "react";
import type { UkiApi } from "../shared";
import type { Action } from "./RecordCard";
import { useDialogFocus } from "./useDialogFocus";
const states: Record<string, string> = {
  pending: "排队",
  running: "进行中",
  partial: "部分完成",
  done: "完成",
  failed: "失败",
  cancelled: "已取消",
  budget: "等待额度",
};
export function TaskPanel({
  onClose,
  onAction,
  onOpen,
}: {
  onClose(): void;
  onAction: Action;
  onOpen?(id: string, kind: "note" | "task"): void;
}) {
  useDialogFocus();
  const ref = useRef<HTMLDialogElement>(null),
    [rows, setRows] = useState<Awaited<ReturnType<UkiApi["aiTasks"]>>>([]),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [result, setResult] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    const load = () =>
      void window.uki
        .aiTasks()
        .then(setRows)
        .catch((e) => setError(e.message));
    load();
    const off = window.uki.onChanged(load);
    return () => {
      off();
      ref.current?.close();
    };
  }, []);
  return (
    <dialog
      className="task-dialog"
      aria-label="AI 任务"
      ref={ref}
      onCancel={onClose}
    >
      <header>
        <h2>AI 任务</h2>
        <button onClick={onClose}>关闭</button>
      </header>
      <p className="hint">
        取消后保留本机原文。已经发送的请求仍可能计费；已完成步骤不会自动重发。
      </p>
      {error && <p className="error">{error}</p>}
      <div className="task-list">
        {rows.length ? (
          rows.map((row) => (
            <section key={row.id} className="task-row">
              <h3>{row.title}</h3>
              <p className="hint">
                {states[row.status] ?? row.status} · {row.stage}
              </p>
              {row.error && <p className="error">{row.error}</p>}
              <div className="record-actions">
                <button
                  onClick={() =>
                    onAction(async () => {
                      setSelected(row.id);
                      if (row.kind === "note") {
                        const d = await window.uki.detail(row.id);
                        setResult(
                          [
                            d.note.title,
                            d.note.synopsis,
                            d.note.reply,
                            d.note.partialReply,
                            ...Object.values(d.note.componentErrors ?? {}),
                          ]
                            .filter(Boolean)
                            .join("\n\n"),
                        );
                      } else {
                        const t = await window.uki.taskDetail(row.id);
                        setResult(
                          t.error ??
                            (t.result
                              ? "结果已保存。请进入对应问题或资料页查看。"
                              : "尚未完成；已读取的资料和请求记录保留。"),
                        );
                      }
                    })
                  }
                >
                  查看结果与失败步骤
                </button>
                {onOpen && (
                  <button onClick={() => onOpen(row.id, row.kind)}>
                    查看对象
                  </button>
                )}
                {["pending", "running", "budget"].includes(row.status) && (
                  <button
                    onClick={() =>
                      onAction(() => window.uki.cancelAi(row.id, row.kind))
                    }
                  >
                    取消任务
                  </button>
                )}
                {["failed", "partial"].includes(row.status) && (
                  <button
                    onClick={() =>
                      onAction(() =>
                        row.kind === "note"
                          ? window.uki.retry(row.id)
                          : window.uki.retryTask(row.id),
                      )
                    }
                  >
                    重试未完成部分
                  </button>
                )}
              </div>
              {selected === row.id && (
                <p className="original">{result || "暂无结果"}</p>
              )}
            </section>
          ))
        ) : (
          <p>没有待处理任务。</p>
        )}
      </div>
    </dialog>
  );
}
