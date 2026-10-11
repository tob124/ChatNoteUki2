import { useEffect, useRef, useState } from "react";
import { NoteReply } from "./NoteReply";
import { ResearchControls } from "./ResearchControls";
import { AssignmentSuggestion } from "./AssignmentSuggestion";
import { NoteThoughtControls } from "./NoteThoughtControls";
import { MaterialLibrary } from "./MaterialLibrary";
import { QuoteReference } from "./QuoteReference";
import type { AiTask } from "../shared";
import {
  isShortNote,
  type Note,
  type Thread,
  type UkiApi,
  type Evidence,
  type StructureProposal,
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
  onEvidence,
  revisionToken,
  tasks = [],
  hasApiKey = false,
  onResult = () => {},
  onSource = () => {},
  selected = false,
  onSelect,
  query = "",
  onDeleted,
  streaming = {},
  assignmentSuggestions = [],
}: {
  note: Note;
  assignmentSuggestions?: StructureProposal[];
  threads: Thread[];
  expanded: boolean;
  onOpen(): void;
  onAction: Action;
  onEvidence(r: Evidence): void;
  revisionToken: number;
  tasks?: AiTask[];
  hasApiKey?: boolean;
  onResult?(task: AiTask): void;
  onSource?(ownerId: string, sourceId: string): void;
  selected?: boolean;
  onSelect?(): void;
  query?: string;
  onDeleted?(): void;
  streaming?: Record<string, string>;
}) {
  const [detail, setDetail] = useState<Awaited<
    ReturnType<UkiApi["detail"]>
  > | null>(null);
  const [editing, setEditing] = useState<"body" | "title" | null>(null),
    [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false),
    [confirmPurge, setConfirmPurge] = useState(false),
    [deletedNow, setDeletedNow] = useState(false);
  const [older, setOlder] = useState<Note[]>([]),
    [beforeConversation, setBeforeConversation] = useState<string | null>(null);
  const loadedDetail = useRef<typeof detail>(null);
  const [editBase, setEditBase] = useState({
    version: note.revision ?? 0,
    title: note.title,
  });
  const editorKey = (kind: "body" | "title") => `edit:${note.id}:${kind}`;
  const edit = async (kind: "body" | "title") => {
    try {
      const saved = await window.uki.workspaceState(editorKey(kind));
      const current = await window.uki.detail(note.id);
      setDetail(current);
      setDraft(
        saved.draft ||
          (kind === "body"
            ? (current.note.currentRaw ?? current.note.raw)
            : current.note.title),
      );
      setEditBase({
        version: saved.draft
          ? (saved.parentRevision ?? current.note.revision ?? 0)
          : (current.note.revision ?? 0),
        title: saved.draft
          ? (saved.parentTitle ?? current.note.title)
          : current.note.title,
      });
      if (
        saved.draft &&
        ((kind === "body" &&
          saved.parentRevision !== (current.note.revision ?? 0)) ||
          (kind === "title" && saved.parentTitle !== current.note.title))
      )
        setError("恢复的草稿基于旧版本，请核对后重新开始编辑。");
      setEditing(kind);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  const localAction = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  const highlighted = (text: string) => {
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return text;
    const regex = new RegExp(
      `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
      "gi",
    );
    return text
      .split(regex)
      .map((part, i) =>
        words.some(
          (w) => part.toLocaleLowerCase() === w.toLocaleLowerCase(),
        ) ? (
          <mark key={i}>{part}</mark>
        ) : (
          part
        ),
      );
  };
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    const form = card.current?.querySelector(".note-reply-form");
    if (replying && form?.contains(document.activeElement))
      form.scrollIntoView({ block: "nearest" });
  }, [detail, replying]);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    void window.uki
      .detail(note.id)
      .then((d) => {
        if (active) {
          setDetail(d);
          const previous = loadedDetail.current;
          if (previous?.note.id === d.note.id) {
            setOlder((older) =>
              older.length
                ? [
                    ...new Map(
                      [...older, ...previous.discussions]
                        .filter(
                          (n) =>
                            !d.discussions.some(
                              (current) => current.id === n.id,
                            ),
                        )
                        .map((n) => [n.id, n]),
                    ).values(),
                  ]
                : older,
            );
          } else {
            setOlder([]);
            setBeforeConversation(
              d.discussions.length === 30 ? d.discussions[0].id : null,
            );
          }
          loadedDetail.current = d;
        }
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
      ref={card}
      className={`record ${expanded ? "expanded" : ""}`}
      id={`note-${note.id}`}
      data-unit={note.id}
    >
      <div className="card-tools">
        {onSelect && !note.parentNoteId && (
          <input
            type="checkbox"
            aria-label={`选择 ${note.title}`}
            checked={selected}
            onChange={onSelect}
          />
        )}
        {note.bookmarked && <span className="hint">已收藏</span>}
        <details
          className="action-menu"
          data-popover
          data-close-on-action
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.open = false;
              e.currentTarget.querySelector("summary")?.focus();
            }
          }}
          onClick={(e) => {
            if (e.target instanceof HTMLElement && e.target.closest("button"))
              e.currentTarget.open = false;
          }}
        >
          <summary aria-label={`更多操作 · ${note.title}`}>···</summary>
          <div className="menu-items">
            {note.deletedAt ? (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    onAction(() =>
                      localAction(() => window.uki.trash([note.id], "restore")),
                    )
                  }
                >
                  恢复笔记
                </button>
                <button disabled={busy} onClick={() => setConfirmPurge(true)}>
                  彻底删除…
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    if (!expanded) onOpen();
                    void edit("body");
                  }}
                >
                  更正正文
                </button>
                <button
                  onClick={() => {
                    if (!expanded) onOpen();
                    void edit("title");
                  }}
                >
                  修改标题
                </button>
                <button
                  onClick={() =>
                    onAction(() =>
                      localAction(() =>
                        window.uki.bookmark(note.id, !note.bookmarked),
                      ),
                    )
                  }
                >
                  {note.bookmarked ? "取消收藏" : "收藏笔记"}
                </button>
                <button
                  onClick={() =>
                    void localAction(async () => {
                      const d = await window.uki.detail(note.id);
                      await navigator.clipboard.writeText(
                        d.note.currentRaw ?? d.note.raw,
                      );
                      setNotice("已复制原文");
                    })
                  }
                >
                  复制原文
                </button>
                <button
                  onClick={() =>
                    onAction(() =>
                      localAction(() => window.uki.exportNotes([note.id])),
                    )
                  }
                >
                  导出笔记…
                </button>
                <button
                  onClick={() =>
                    onAction(() =>
                      localAction(() => window.uki.importFiles(note.id)),
                    )
                  }
                >
                  关联附件…
                </button>
                <label className="menu-move">
                  移动笔记与其讨论{" "}
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
                </label>
                {["pending", "running"].includes(note.status) && (
                  <button
                    onClick={() =>
                      onAction(() => window.uki.cancelAi(note.id, "note"))
                    }
                  >
                    取消 AI 处理
                  </button>
                )}
                <button
                  className="danger-text"
                  onClick={() =>
                    onAction(() =>
                      localAction(async () => {
                        await window.uki.trash([note.id], "trash");
                        setDeletedNow(true);
                        onDeleted?.();
                      }),
                    )
                  }
                >
                  移入回收站
                </button>
              </>
            )}
          </div>
        </details>
      </div>
      {confirmPurge && (
        <div className="inline-confirm" role="alert">
          <p>
            彻底删除将移除原文及更正版本。已生成的认知和分析保留，旧引用显示笔记已删除。
          </p>
          <button
            disabled={busy}
            onClick={() =>
              onAction(() =>
                localAction(async () => {
                  await window.uki.trash([note.id], "purge");
                  setConfirmPurge(false);
                }),
              )
            }
          >
            确认彻底删除
          </button>
          <button onClick={() => setConfirmPurge(false)}>取消</button>
        </div>
      )}
      {notice && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}
      {deletedNow && (
        <button
          onClick={() => onAction(() => window.uki.trash([note.id], "restore"))}
        >
          撤销删除
        </button>
      )}
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      <button className="record-open" onClick={onOpen} aria-expanded={expanded}>
        <div className="record-meta">
          <time>{dateLabel(note.createdAt)}</time>
          <span>
            {thread?.title ??
              (assignmentSuggestions.length
                ? "归属待确认"
                : ["pending", "running"].includes(note.status)
                  ? "自动整理中"
                  : "暂未归属")}
          </span>
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
                    partial: "AI 部分完成",
                    cancelled: "AI 已取消",
                  } as const
                )[note.status]
              }
            </span>
          )}
        </div>
        <h2>{highlighted(note.title)}</h2>

        <p className={short ? "raw-preview" : "synopsis"}>
          <span className="preview-label">{short ? "原文" : "AI 摘要"}</span>
          {highlighted(short ? note.raw : note.synopsis || "待生成")}
        </p>
      </button>
      {!note.deletedAt &&
        assignmentSuggestions.map((value) => (
          <AssignmentSuggestion
            key={value.id}
            value={value}
            threads={threads}
            onAction={onAction}
          />
        ))}
      {!!note.searchMatches?.some((match) => match.revision === undefined) && (
        <p className="search-hits-label">
          命中：
          {[
            ...new Set(
              note.searchMatches
                .filter((match) => match.revision === undefined)
                .map((match) => match.kind),
            ),
          ].join("、")}
        </p>
      )}
      {note.searchMatches
        ?.filter(
          (match) =>
            match.revision !== undefined ||
            ![note.title, short ? note.raw : note.synopsis].includes(
              match.text,
            ),
        )
        .map((match, index) => (
          <p className="search-match" key={index}>
            <span className="section-label">
              命中{match.kind}
              {match.revision !== undefined ? ` · v${match.revision}` : ""}
            </span>{" "}
            {highlighted(match.text)}
            {match.revision !== undefined && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEvidence({ noteId: note.id, revision: match.revision! });
                }}
              >
                核对旧正文
              </button>
            )}
          </p>
        ))}
      {expanded && (
        <div>{note.materialQuote && <QuoteReference noteId={note.id} />}</div>
      )}
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
                    onAction(() =>
                      localAction(async () => {
                        if (editing === "body")
                          await window.uki.correct(
                            note.id,
                            draft,
                            editBase.version,
                          );
                        else
                          await window.uki.title(
                            note.id,
                            draft,
                            editBase.title,
                          );
                        await window.uki.workspaceState(editorKey(editing!), {
                          draft: "",
                          mode: "note",
                          parentNoteId: null,
                          openIds: [],
                        });
                        setEditing(null);
                      }),
                    );
                  }}
                >
                  <label>
                    {editing === "body" ? "更正正文" : "手动标题"}
                    <textarea
                      aria-label={editing === "body" ? "更正正文" : "手动标题"}
                      autoFocus
                      value={draft}
                      disabled={busy}
                      onChange={(e) => {
                        const text = e.target.value;
                        setDraft(text);
                        void window.uki
                          .workspaceState(editorKey(editing), {
                            draft: text,
                            mode: "note",
                            parentNoteId: null,
                            parentRevision: editBase.version,
                            parentTitle: editBase.title,
                            openIds: [],
                          })
                          .catch((e) => setError(e.message));
                      }}
                      maxLength={editing === "body" ? 50000 : 60}
                    />
                  </label>
                  <p className="hint">
                    更正保留之前的原文版本。手动标题和归属不会被 AI 覆盖。
                  </p>
                  <button className="primary" disabled={!draft.trim() || busy}>
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
              {full.partialReply && (
                <div className="ai-reply">
                  <div className="section-label">未完成的回复 · 计费待核对</div>
                  <p>{full.partialReply}</p>
                </div>
              )}
              <details>
                <summary>关联参考资料</summary>
                <MaterialLibrary
                  noteId={note.id}
                  onAction={onAction}
                  revisionToken={revisionToken}
                />
              </details>
              {detail.discussions.length > 0 && (
                <details open={replying ? true : undefined}>
                  <summary>
                    关联讨论 · 最近 {detail.discussions.length} 条
                  </summary>
                  {beforeConversation && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void localAction(async () => {
                          const result = await window.uki.conversations(
                            note.id,
                            beforeConversation,
                          );
                          setOlder((items) => [...result.items, ...items]);
                          setBeforeConversation(result.before);
                        })
                      }
                    >
                      更早对话
                    </button>
                  )}
                  {[...older, ...detail.discussions].map((d) => (
                    <div className="discussion" key={d.id}>
                      <div className="section-label">
                        继续讨论 · {dateLabel(d.createdAt)} · 起始正文 v
                        {d.parentRevision ?? 0}
                      </div>
                      <p className="original">{d.currentRaw ?? d.raw}</p>
                      {d.reply && <p className="ai-reply">{d.reply}</p>}
                      {!d.reply &&
                        d.status === "running" &&
                        streaming[d.id] && (
                          <div className="ai-reply">
                            <span className="section-label">AI 正在回答…</span>
                            <p>{streaming[d.id]}</p>
                          </div>
                        )}
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
              {full.error && (
                <p className={full.status === "pending" ? "hint" : "error"}>
                  {full.error}
                </p>
              )}
              {replying && !note.deletedAt && (
                <NoteReply note={full} onAction={onAction} />
              )}
              <div className="record-actions note-analysis-tools">
                {["failed", "partial", "cancelled"].includes(full.status) &&
                  !note.deletedAt && (
                    <button
                      onClick={() => onAction(() => window.uki.retry(note.id))}
                    >
                      重试 AI 处理
                    </button>
                  )}
                <button
                  onClick={() => setReplying((value) => !value)}
                  disabled={thread?.archived || !!note.deletedAt}
                >
                  {replying ? "收起回复" : "回复 AI"}
                </button>
                {full.mode === "note" && (
                  <>
                    <NoteThoughtControls
                      note={full}
                      tasks={tasks}
                      hasApiKey={hasApiKey}
                      onAction={onAction}
                      onEvidence={onEvidence}
                    />
                    <ResearchControls
                      noteId={full.id}
                      threadId={full.threadId}
                      title={full.title}
                      tasks={tasks}
                      hasApiKey={hasApiKey}
                      onAction={onAction}
                      onResult={onResult}
                      onSource={onSource}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}
