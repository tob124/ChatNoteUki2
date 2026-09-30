import { useEffect, useState } from "react";
import {
  isShortNote,
  type Note,
  type Thread,
  type UkiApi,
  type Evidence,
} from "../shared";
export const dateLabel = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export type Action = (fn: () => Promise<unknown>) => void;
export function RecordCard({
  note,
  threads,
  expanded,
  onOpen,
  onAction,
  onDiscuss,
  onEvidence,
  revisionToken,
}: {
  note: Note;
  threads: Thread[];
  expanded: boolean;
  onOpen(): void;
  onAction: Action;
  onDiscuss(note: Note): void;
  onEvidence(r: Evidence): void;
  revisionToken: number;
}) {
  const [detail, setDetail] = useState<Awaited<
    ReturnType<UkiApi["detail"]>
  > | null>(null);
  const [editing, setEditing] = useState<"body" | "title" | null>(null),
    [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    void window.uki
      .detail(note.id)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [note.id, expanded, revisionToken]);
  const full = detail?.note ?? note;
  const raw = full.currentRaw ?? full.raw;
  const short = note.previewKind
    ? note.previewKind === "original"
    : isShortNote(raw);
  const thread = threads.find((t) => t.id === note.threadId);
  return (
    <article
      className={`record ${expanded ? "expanded" : ""}`}
      id={`note-${note.id}`}
      data-unit={note.id}
    >
      <button className="record-open" onClick={onOpen} aria-expanded={expanded}>
        <div className="record-meta">
          <time>{dateLabel(note.createdAt)}</time>
          <span>{thread?.title ?? "待整理"}</span>
          {note.mode === "discussion" && <span>继续讨论</span>}
          {note.source === "inbox" && <span>手机输入</span>}
          {note.status !== "done" && (
            <span className={note.status === "failed" ? "failed" : "muted"}>
              {
                (
                  {
                    pending: "AI 待处理",
                    running: "AI 处理中",
                    failed: "AI 失败",
                  } as const
                )[note.status]
              }
            </span>
          )}
        </div>
        <h2>{note.title}</h2>
        <p className={short ? "raw-preview" : "synopsis"}>
          <span className="preview-label">{short ? "原文" : "AI 摘要"}</span>
          {short ? note.raw : note.synopsis || "待生成"}
        </p>
      </button>
      {expanded && (
        <div className="record-body">
          {!detail ? (
            <p className="muted">{error || "读取完整原文…"}</p>
          ) : (
            <>
              {full.parentNoteId && (
                <button
                  onClick={() =>
                    onEvidence({
                      noteId: full.parentNoteId!,
                      revision: full.parentRevision ?? 0,
                    })
                  }
                >
                  查看起始笔记 · v{full.parentRevision ?? 0}
                </button>
              )}
              <div className="section-label">
                你的原话 · 版本 {full.revision ?? 0}
              </div>
              <p className="original">{raw}</p>
              {editing && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onAction(async () => {
                      if (editing === "body")
                        await window.uki.correct(note.id, draft);
                      else await window.uki.title(note.id, draft);
                      setEditing(null);
                    });
                  }}
                >
                  <label>
                    {editing === "body" ? "更正正文" : "手动标题"}
                    <textarea
                      aria-label={editing === "body" ? "更正正文" : "手动标题"}
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      maxLength={editing === "body" ? 50000 : 60}
                    />
                  </label>
                  <p className="hint">
                    更正保留之前的原文版本。手动标题和归属不会被 AI 覆盖。
                  </p>
                  <button className="primary" disabled={!draft.trim()}>
                    保存更正
                  </button>{" "}
                  <button type="button" onClick={() => setEditing(null)}>
                    取消
                  </button>
                </form>
              )}
              {full.reply && (
                <div className="ai-reply">
                  <div className="section-label">一起想一想</div>
                  <p>{full.reply}</p>
                </div>
              )}
              {detail.discussions.length > 0 && (
                <details>
                  <summary>
                    关联讨论 · 最近 {detail.discussions.length} 条
                  </summary>
                  {detail.discussions.map((d) => (
                    <div className="discussion" key={d.id}>
                      <div className="section-label">
                        继续讨论 · {dateLabel(d.createdAt)}
                      </div>
                      <p className="original">{d.currentRaw ?? d.raw}</p>
                      {d.reply && <p className="ai-reply">{d.reply}</p>}
                      {d.error && <p className="error">{d.error}</p>}
                      {d.status === "failed" && (
                        <button
                          onClick={() => onAction(() => window.uki.retry(d.id))}
                        >
                          重试讨论
                        </button>
                      )}
                    </div>
                  ))}
                </details>
              )}
              {detail.revisions.length > 1 && (
                <details>
                  <summary>原文版本 · {detail.revisions.length}</summary>
                  {detail.revisions.map((r) => (
                    <div className="version" key={r.id}>
                      <span className="section-label">
                        版本 {r.revision} · {dateLabel(r.createdAt)}
                      </span>
                      <p className="original">{r.raw}</p>
                    </div>
                  ))}
                </details>
              )}
              {full.originalThreadId && (
                <p className="hint">
                  升级前所属：
                  {threads.find((t) => t.id === full.originalThreadId)?.title ??
                    "历史线程"}
                </p>
              )}
              {full.error && <p className="error">{full.error}</p>}
              <div className="record-actions">
                {full.status === "failed" && (
                  <button
                    onClick={() => onAction(() => window.uki.retry(note.id))}
                  >
                    重试 AI 处理
                  </button>
                )}
                <button
                  onClick={() => onDiscuss(full)}
                  disabled={!full.threadId || thread?.archived}
                >
                  继续讨论
                </button>
                <button
                  onClick={() => {
                    setEditing("body");
                    setDraft(raw);
                  }}
                >
                  更正正文
                </button>
                <button
                  onClick={() => {
                    setEditing("title");
                    setDraft(full.title);
                  }}
                >
                  修改标题
                </button>
                <select
                  aria-label="所属线程"
                  value={full.threadId ?? ""}
                  onChange={(e) =>
                    onAction(() =>
                      window.uki.move(note.id, e.target.value || null),
                    )
                  }
                >
                  <option value="">待整理</option>
                  {threads
                    .filter((t) => !t.archived || t.id === full.threadId)
                    .map((t) => (
                      <option key={t.id} value={t.id} disabled={t.archived}>
                        {t.parentId ? "↳ " : ""}
                        {t.title}
                      </option>
                    ))}
                </select>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}
