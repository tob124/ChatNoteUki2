import { useEffect, useRef, useState } from "react";
import type { Note } from "../shared";
import type { Action } from "./RecordCard";

export function NoteReply({
  note,
  onAction,
  researchId,
}: {
  note: Note;
  onAction: Action;
  researchId?: string;
}) {
  const rootId = note.parentNoteId ?? note.id;
  const [draft, setDraft] = useState<string | null>(null);
  const [pro, setPro] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [parentRevision, setParentRevision] = useState(
    note.parentNoteId ? (note.parentRevision ?? 0) : (note.revision ?? 0),
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const key = "conversation:" + rootId + (researchId ? ":" + researchId : "");
  const state = (text: string) => ({
    draft: text,
    mode: "discussion" as const,
    parentNoteId: rootId,
    parentRevision,
    openIds: [],
  });
  useEffect(() => {
    let active = true;
    void window.uki
      .workspaceState(key)
      .then((saved) => {
        if (active) {
          setDraft(saved.draft);
          if (saved.draft && saved.parentRevision !== undefined)
            setParentRevision(saved.parentRevision);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [key]);
  return (
    <form
      className="note-reply-form"
      aria-label="这条笔记的对话"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft?.trim() || sending) return;
        const submitted = draft;
        setSending(true);
        onAction(async () => {
          try {
            await window.uki.capture({
              raw: submitted,
              threadId: note.threadId,
              mode: "discussion",
              parentNoteId: rootId,
              parentRevision,
              model: pro ? "deepseek-v4-pro" : "deepseek-flash",
              ...(researchId ? { researchId } : {}),
            });
            setDraft("");
            setPro(false);
            await window.uki.workspaceState(key, state(""));
            requestAnimationFrame(() => {
              if (
                document.activeElement === document.body ||
                input.current?.form?.contains(document.activeElement)
              ) {
                input.current?.focus({ preventScroll: true });
                input.current?.form?.scrollIntoView({ block: "nearest" });
              }
            });
          } finally {
            setSending(false);
          }
        });
      }}
    >
      <label>
        回复这条笔记中的 AI
        <textarea
          ref={input}
          aria-label="回复这条笔记中的 AI"
          autoFocus
          value={draft ?? ""}
          disabled={draft === null || sending}
          maxLength={50000}
          placeholder="继续追问、补充或纠正，只讨论这条笔记…"
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            void window.uki
              .workspaceState(key, state(text))
              .catch((e) => setError(e.message));
          }}
          onKeyDown={(e) => {
            if (
              (e.ctrlKey || e.metaKey) &&
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="note-reply-footer">
        <span className="hint">草稿仅本机保存 · Ctrl + Enter</span>
        <label className="check">
          <input
            type="checkbox"
            checked={pro}
            onChange={(e) => setPro(e.target.checked)}
            disabled={sending}
          />
          本次 Pro
        </label>
        <button className="primary" disabled={!draft?.trim() || sending}>
          {sending ? "保存中…" : "发送回复"}
        </button>
      </div>
    </form>
  );
}
