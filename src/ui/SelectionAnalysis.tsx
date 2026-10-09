import { useEffect, useRef, useState } from "react";
import type { Note } from "../shared";
export function SelectionAnalysis({
  notes,
  onClose,
  onQueued,
}: {
  notes: Note[];
  onClose(): void;
  onQueued(id: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    lock = useRef(false);
  const [question, setQuestion] = useState(
      "这几条想法之间有什么变化、联系和未解决的问题？",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const queued = useRef<string | undefined>(undefined);
  const latest = useRef({ draftKey, question, ready: false });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) input.current?.focus();
  }, [ready]);
  latest.current = { draftKey, question, ready };
  useEffect(
    () =>
      window.uki.onFlush(async () => {
        const s = latest.current;
        if (s.ready && !queued.current)
          await window.uki.workspaceState(s.draftKey, {
            draft: s.question,
            mode: "note",
            parentNoteId: null,
            openIds: [],
          });
      }),
    [],
  );
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    let live = true;
    void (async () => {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          notes
            .map((n) => `${n.id}:${n.revision ?? 0}`)
            .sort()
            .join("|"),
        ),
      );
      const key =
        "selection:" +
        [...new Uint8Array(hash)]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
      const s = await window.uki.workspaceState(key);
      if (live) {
        setDraftKey(key);
        if (s.draft) setQuestion(s.draft);
        setReady(true);
      }
    })().catch(() => {
      if (live) setError("分析问题草稿无法读取，请重试");
    });
    return () => {
      live = false;
      dialog.current?.close();
      if (opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    if (ready)
      void window.uki
        .workspaceState(draftKey, {
          draft: question,
          mode: "note",
          parentNoteId: null,
          openIds: [],
        })
        .catch(() => setError("分析问题草稿尚未保存，请重试"));
  }, [ready, question]);
  return (
    <dialog
      ref={dialog}
      className="context-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError("");
          try {
            const id =
              queued.current ??
              (await window.uki.analyzeSelection({
                question,
                notes: notes.map((n) => ({
                  noteId: n.id,
                  revision: n.revision ?? 0,
                })),
              }));
            queued.current = id;
            await window.uki.workspaceState(draftKey, {
              draft: "",
              mode: "note",
              parentNoteId: null,
              openIds: [],
            });
            onQueued(id);
          } catch (e) {
            setError(
              (queued.current
                ? "分析已排队，草稿清理未完成；再次确认可完成操作，不会重复请求。"
                : "") + (e instanceof Error ? e.message : String(e)),
            );
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <h2>分析所选笔记</h2>
        <p className="hint">
          仅分析下面 {notes.length}{" "}
          条最新正文。不会调整归属或更新认知，不包含其他记录或对话。
        </p>
        <div className="selection-sources">
          {notes.map((n) => (
            <p key={n.id}>
              {n.title} <span className="hint">正文 v{n.revision ?? 0}</span>
            </p>
          ))}
        </div>
        <label>
          这次想了解什么？
          <textarea
            ref={input}
            aria-label="分析问题"
            disabled={!ready || busy || !!queued.current}
            maxLength={500}
            rows={4}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="record-actions">
          <button
            className="primary"
            disabled={
              busy || !ready || !notes.length || question.trim().length < 3
            }
          >
            {busy ? "正在排队…" : queued.current ? "完成" : "确认并分析"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </dialog>
  );
}
