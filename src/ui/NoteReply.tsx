import { useEffect, useRef, useState } from "react";
import type { Note } from "../shared";
import type { Action } from "./RecordCard";
import type { MaterialSummary } from "../materials";

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
  const [materials, setMaterials] = useState<MaterialSummary[]>([]),
    [materialIds, setMaterialIds] = useState<string[]>([]);
  useEffect(() => {
    void window.uki
      .materialPage(undefined, undefined, false, rootId)
      .then((page) =>
        setMaterials(page.items.filter((m) => m.status !== "extracting")),
      )
      .catch((e) => setError(e.message));
  }, [rootId]);
  const [parentRevision, setParentRevision] = useState(
    note.parentNoteId ? (note.parentRevision ?? 0) : (note.revision ?? 0),
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const locked = useRef(false),
    submission = useRef<{ raw: string; id: string } | null>(null);
  const key = "conversation:" + rootId + (researchId ? ":" + researchId : "");
  const state = (text: string) => ({
    draft: text,
    mode: "discussion" as const,
    parentNoteId: rootId,
    parentRevision,
    openIds: [],
    materialIds,
  });
  useEffect(() => {
    let active = true;
    void window.uki
      .workspaceState(key)
      .then((saved) => {
        if (active) {
          setDraft(saved.draft);
          setMaterialIds(saved.materialIds ?? []);
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
        if (!draft?.trim() || sending || locked.current) return;
        locked.current = true;
        const submitted = draft;
        if (submission.current?.raw !== submitted)
          submission.current = { raw: submitted, id: crypto.randomUUID() };
        setSending(true);
        onAction(async () => {
          let committed = false;
          try {
            await window.uki.capture({
              raw: submitted,
              clientId: submission.current!.id,
              threadId: note.threadId,
              mode: "discussion",
              parentNoteId: rootId,
              parentRevision,
              model: pro ? "deepseek-v4-pro" : "deepseek-flash",
              materialIds,
              ...(researchId ? { researchId } : {}),
            });
            committed = true;
            submission.current = null;
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
          } catch (e) {
            setError(
              (committed
                ? "回复已保存；本机草稿清理失败，请核对后关闭。"
                : "") + (e instanceof Error ? e.message : String(e)),
            );
          } finally {
            setSending(false);
            locked.current = false;
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
      {materials.length > 0 && (
        <details>
          <summary>选择本轮使用的参考资料</summary>
          <p className="hint">
            仅使用所选资料的已提取内容，参考资料不代表你的观点。
          </p>
          {materials.map((m) => (
            <label className="check" key={m.id}>
              <input
                type="checkbox"
                disabled={sending}
                checked={materialIds.includes(m.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...materialIds, m.id].slice(0, 10)
                    : materialIds.filter((id) => id !== m.id);
                  setMaterialIds(next);
                  void window.uki
                    .workspaceState(key, {
                      ...state(draft ?? ""),
                      materialIds: next,
                    })
                    .catch((e) => setError(e.message));
                }}
              />
              {m.name}
            </label>
          ))}
        </details>
      )}
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
