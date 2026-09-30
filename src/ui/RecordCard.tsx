import { useState } from "react";
import type { Note, Thread } from "../shared";
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
export function RecordCard({
  note,
  threads,
  expanded,
  onOpen,
  onAction,
}: {
  note: Note;
  threads: Thread[];
  expanded: boolean;
  onOpen(): void;
  onAction(action: () => Promise<unknown>): void;
}) {
  const [moving, setMoving] = useState(false);
  const thread = threads.find((t) => t.id === note.threadId);
  const status = {
    pending: "等待 AI",
    running: "正在思考",
    done: "",
    failed: "处理失败",
  }[note.status];
  return (
    <article className={`record ${expanded ? "expanded" : ""}`}>
      <button className="record-open" onClick={onOpen} aria-expanded={expanded}>
        <div className="record-meta">
          <time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time>
          <span>{thread?.title ?? "待归入线程"}</span>
          {note.source === "inbox" ? <span>手机输入</span> : null}
          <span className={note.status === "failed" ? "failed" : "status"}>
            {status}
          </span>
        </div>
        <h2>{note.title}</h2>
        <p className={note.synopsis === "待生成" ? "muted" : "synopsis"}>
          {note.synopsis}
        </p>
      </button>
      {expanded ? (
        <div className="record-body">
          <div className="section-label">你的原话</div>
          <p className="original">{note.raw}</p>
          {note.reply ? (
            <div className="ai-reply">
              <div className="section-label">一起想一想</div>
              <p>{note.reply}</p>
            </div>
          ) : null}
          {note.error ? (
            <p className="error" role="status">
              {note.error}
            </p>
          ) : null}
          <div className="record-actions">
            {note.status === "failed" ? (
              <button onClick={() => onAction(() => window.uki.retry(note.id))}>
                重试 AI 处理
              </button>
            ) : null}
            <button
              onClick={() => setMoving(!moving)}
              disabled={!threads.length}
            >
              调整所属线程
            </button>
            {moving ? (
              <select
                aria-label="所属线程"
                value={note.threadId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) onAction(() => window.uki.move(note.id, id));
                  setMoving(false);
                }}
              >
                <option value="" disabled>
                  选择线程
                </option>
                {threads.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
