import { useEffect, useRef, useState } from "react";
import type { Thread } from "../shared";
import type { Action } from "./RecordCard";
import { useDialogFocus } from "./useDialogFocus";
export function ThreadDialog({
  thread,
  threads,
  onAction,
  onClose,
}: {
  thread?: Thread;
  threads: Thread[];
  onAction: Action;
  onClose(): void;
}) {
  useDialogFocus();
  const ref = useRef<HTMLDialogElement>(null),
    [title, setTitle] = useState(thread?.title ?? ""),
    [description, setDescription] = useState(thread?.description ?? ""),
    [parentId, setParent] = useState(thread?.parentId ?? "");
  const [closing, setClosing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const close = () => {
    if (busy) return;
    if (
      title !== (thread?.title ?? "") ||
      description !== (thread?.description ?? "") ||
      parentId !== (thread?.parentId ?? "")
    )
      setClosing(true);
    else onClose();
  };
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className="thread-dialog"
      aria-label={thread ? "管理问题" : "新建问题"}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          onAction(async () => {
            try {
              await window.uki.thread({
                id: thread?.id,
                title,
                description,
                parentId: parentId || null,
              });
              onClose();
            } catch (e) {
              setError(String(e instanceof Error ? e.message : e));
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        <header>
          <h2>{thread ? "管理问题" : "新建问题"}</h2>
          <button type="button" onClick={close} disabled={busy}>
            关闭
          </button>
        </header>
        {closing && (
          <div className="inline-confirm" role="alert">
            <p>问题信息有未保存修改。</p>
            <button type="submit" disabled={busy}>
              保存并关闭
            </button>
            <button type="button" onClick={onClose}>
              放弃修改
            </button>
            <button type="button" onClick={() => setClosing(false)}>
              继续编辑
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <label>
          问题名称
          <input
            autoFocus
            required
            maxLength={60}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          问题说明
          <textarea
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="这个问题讨论什么，不讨论什么？"
          />
        </label>
        <label>
          上级问题
          <select value={parentId} onChange={(e) => setParent(e.target.value)}>
            <option value="">主问题</option>
            {threads
              .filter((t) => !t.archived && !t.parentId && t.id !== thread?.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
        <p className="hint">
          最多主问题与子问题两层。已有子问题的主问题不能直接降级。
        </p>
        <div className="record-actions">
          <button className="primary" disabled={busy}>
            保存问题
          </button>
          {thread && (
            <button
              type="button"
              onClick={() =>
                onAction(async () => {
                  await window.uki.thread({
                    id: thread.id,
                    title,
                    description,
                    parentId: parentId || null,
                    archived: !thread.archived,
                  });
                  onClose();
                })
              }
            >
              {thread.archived ? "恢复活动" : "归档问题"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
