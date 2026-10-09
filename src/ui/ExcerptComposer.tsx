import { useEffect, useRef, useState } from "react";
import type { QuoteLocator } from "../workspace-tools";
import type { Thread } from "../shared";
export function ExcerptComposer({
  quote,
  name,
  noteId,
  onClose,
  onSaved,
}: {
  quote: QuoteLocator;
  name: string;
  noteId?: string;
  onClose(): void;
  onSaved(id: string): void;
}) {
  const [raw, setRaw] = useState(""),
    [threadId, setThreadId] = useState<string | null>(null),
    [threads, setThreads] = useState<Thread[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    input = useRef<HTMLTextAreaElement>(null),
    submission = useRef<
      { raw: string; threadId: string | null; id: string } | undefined
    >(undefined);
  const key = `excerpt:${quote.materialId}:${quote.segmentId}:${quote.start}:${quote.end}:${quote.sha256.slice(0, 16)}`;
  useEffect(() => {
    if (ready) input.current?.focus();
  }, [ready]);
  useEffect(() => {
    let active = true;
    void Promise.all([window.uki.workspaceState(key), window.uki.bootstrap()])
      .then(([s, b]) => {
        if (!active) return;
        setThreads(b.threads.filter((t) => !t.archived));
        if (s.draft) {
          try {
            const v = JSON.parse(s.draft);
            if (
              v.quote?.sha256 === quote.sha256 &&
              v.quote?.start === quote.start &&
              v.quote?.end === quote.end &&
              (v.quote?.text === undefined || v.quote.text === quote.text) &&
              typeof v.raw === "string"
            ) {
              setRaw(v.raw);
              setThreadId(v.threadId ?? null);
            } else
              setError(
                "这段资料留有另一份摘录草稿，已保留；可选回原范围后继续。",
              );
          } catch {
            setError("旧摘录草稿需要核对，已保留。");
          }
        }
        setReady(true);
      })
      .catch(() => {
        if (active) setError("摘录草稿无法读取，请重试");
      });
    return () => {
      active = false;
    };
  }, [key]);
  const update = (text: string, target: string | null) => {
    setRaw(text);
    setThreadId(target);
    void window.uki
      .workspaceState(key, {
        draft: JSON.stringify({
          raw: text,
          threadId: target,
          quote: { ...quote, text: undefined },
        }),
        mode: "note",
        parentNoteId: null,
        openIds: [],
      })
      .catch(() => setError("摘录想法尚未保存到本机，请重试"));
  };
  return (
    <form
      className="excerpt-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        if (
          !submission.current ||
          submission.current.raw !== raw ||
          submission.current.threadId !== threadId
        )
          submission.current = { raw, threadId, id: crypto.randomUUID() };
        let id: string | undefined;
        try {
          id = await window.uki.captureExcerpt({
            raw,
            quote,
            threadId,
            clientId: submission.current.id,
          });
          await window.uki.workspaceState(key, {
            draft: "",
            mode: "note",
            parentNoteId: null,
            openIds: [],
          });
          onSaved(id);
        } catch (e) {
          setError(
            (id ? "想法已保存；草稿清理未完成，可再次点击保存确认。" : "") +
              (e instanceof Error ? e.message : String(e)),
          );
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <h3>摘录并记录想法</h3>
      <p className="hint">
        {name} · 段落 {quote.segmentId}。引用属于资料，下面只写你的理解。
      </p>
      <blockquote>{quote.text}</blockquote>
      <label>
        我的想法
        <textarea
          ref={input}
          aria-label="摘录想法"
          disabled={!ready || busy}
          rows={4}
          maxLength={50000}
          value={raw}
          onChange={(e) => update(e.target.value, threadId)}
          autoFocus
        />
      </label>
      <label>
        归属
        <select
          aria-label="摘录想法归属"
          disabled={!ready || busy}
          value={threadId ?? ""}
          onChange={(e) => update(raw, e.target.value || null)}
        >
          <option value="">自动整理</option>
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="record-actions">
        <button className="primary" disabled={busy || !ready || !raw.trim()}>
          {busy ? "正在保存…" : "保存想法"}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          收起草稿
        </button>
      </div>
    </form>
  );
}
