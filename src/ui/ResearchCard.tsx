import { useEffect, useState } from "react";
import type { Evidence, Note } from "../shared";
import { NoteReply } from "./NoteReply";
import type { Research } from "../research";
import { dateLabel, type Action } from "./RecordCard";
export function ResearchCard({
  value,
  onSource,
  onEvidence,
  onAction,
  revisionToken = 0,
}: {
  value: Research;
  onSource(researchId: string, sourceId: string): void;
  onEvidence(evidence: Evidence): void;
  onAction: Action;
  revisionToken?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [discussionNote, setDiscussionNote] = useState<Note | null>(null);
  const [discussions, setDiscussions] = useState<Note[]>([]);
  useEffect(() => {
    if (!discussionNote) return;
    let active = true;
    void window.uki
      .detail(discussionNote.id)
      .then((detail) => {
        if (active)
          setDiscussions(
            detail.discussions.filter((n) => n.researchId === value.id),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [discussionNote?.id, value.id, revisionToken]);
  const draftKey = `research-reflection:${value.id}`;
  useEffect(() => {
    let active = true;
    void window.uki
      .workspaceState(draftKey)
      .then((state) => {
        if (active) {
          if (state.draft) setDraft(state.draft);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setReady(true);
          setDraftError("无法读取判断草稿，请检查本机资料目录。");
        }
      });
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (!ready) return;
    const save = () =>
      window.uki.workspaceState(draftKey, {
        draft: draft ?? "",
        mode: "note",
        parentNoteId: null,
        openIds: [],
      });
    void save().then(
      () => setDraftError(""),
      () => setDraftError("判断草稿尚未保存，请检查本机资料目录后重试。"),
    );
  }, [draftKey, ready, draft]);
  const relation = {
    support: "支持或补充",
    challenge: "不同证据",
    context: "背景与条件",
  };
  return (
    <article className="record research-card" data-unit={value.id}>
      <header>
        <span className="section-label">外部资料分析</span>
        <time>{dateLabel(value.createdAt)}</time>
        <h2>{value.question}</h2>
      </header>
      <div className="research-findings">
        <h3>资料提供的依据</h3>
        {value.report.findings.length ? (
          value.report.findings.map((finding, i) => {
            const source = value.sources.find((s) => s.id === finding.sourceId);
            return (
              <section key={i}>
                <span className="section-label">
                  {relation[finding.relation]}
                </span>
                <p>{finding.claim}</p>
                <blockquote>{finding.quote}</blockquote>
                <button
                  className="back-link"
                  onClick={() => onSource(value.id, finding.sourceId)}
                >
                  核对来源：{source?.title ?? "来源"}
                </button>
              </section>
            );
          })
        ) : (
          <p className="hint">
            本次没有足够的直接证据。下面的联系是 AI 暂定分析。
          </p>
        )}
      </div>
      <section>
        <h3>
          与想法的联系 <span className="hint">AI 暂定分析</span>
        </h3>
        {value.report.analysis.length > 600 ? (
          <>
            <p className="original">{value.report.analysis.slice(0, 240)}…</p>
            <details>
              <summary>展开完整分析</summary>
              <p className="original">{value.report.analysis}</p>
            </details>
          </>
        ) : (
          <p className="original">{value.report.analysis}</p>
        )}
      </section>
      <section>
        <h3>还不能确定的部分</h3>
        <ul>
          {value.report.limitations.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      </section>
      {!!value.report.questions.length && (
        <section>
          <h3>可以继续想</h3>
          <ul>
            {value.report.questions.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      <details>
        <summary>检索与阅读范围</summary>
        <p className="hint">
          查询：{value.queries.join("；")}。服务端报告 {value.searches}{" "}
          次搜索；只分析已取得正文的选读片段，不代表全面研究。
        </p>
        {value.sources.map((source) => (
          <div key={source.id} className="research-source-row">
            <button onClick={() => onSource(value.id, source.id)}>
              {source.title}
            </button>
            <span className="hint">
              {source.status === "read"
                ? "已读取正文"
                : source.status === "discovered"
                  ? "仅搜索结果"
                  : "读取未完成"}
            </span>
          </div>
        ))}
        <p className="hint">本次用户表达依据：</p>
        {value.evidence.map((e) => (
          <button
            key={`${e.noteId}:${e.revision}`}
            onClick={() => onEvidence(e)}
          >
            核对笔记原文版本 {e.revision}
          </button>
        ))}
      </details>
      <button
        disabled={!ready}
        onClick={() => {
          setDraft((d) => d ?? "");
          setSaved(false);
        }}
      >
        记录我的判断
      </button>
      {!!value.evidence.length && (
        <button
          onClick={() =>
            onAction(async () => {
              const origin = value.noteId ?? value.evidence[0].noteId;
              const detail = await window.uki.detail(origin);
              setDiscussionNote(detail.note);
            })
          }
        >
          参考资料继续讨论
        </button>
      )}
      {discussionNote && (
        <>
          <p className="hint">
            仍围绕「{discussionNote.title}」讨论，AI 会参考这份资料；资料与 AI
            判断不代表你已认同。
          </p>
          {discussions.map((note) => (
            <div className="discussion" key={note.id}>
              <p className="original">{note.currentRaw ?? note.raw}</p>
              {note.reply ? (
                <p className="ai-reply">{note.reply}</p>
              ) : (
                <p role="status" className="hint">
                  {note.status === "failed"
                    ? note.error
                    : "已保存，AI 正在处理回复…"}
                </p>
              )}
              {note.status === "failed" && (
                <button
                  onClick={() => onAction(() => window.uki.retry(note.id))}
                >
                  重试回复
                </button>
              )}
            </div>
          ))}
          <NoteReply
            note={discussionNote}
            researchId={value.id}
            onAction={onAction}
          />
          <button onClick={() => setDiscussionNote(null)}>收起讨论</button>
        </>
      )}
      {draft !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSaving(true);
            onAction(async () => {
              try {
                await window.uki.capture({
                  raw: draft,
                  threadId: value.threadId,
                });
                setSaved(true);
                setDraft(null);
              } finally {
                setSaving(false);
              }
            });
          }}
        >
          <label>
            写下你认可或仍疑惑的部分
            <textarea
              aria-label="资料后的我的判断"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={50000}
              required
            />
          </label>
          <p className="hint">
            只保存你自己输入的文字，不把 AI 分析自动当作你的立场。
          </p>
          {draftError && (
            <p className="error-text" role="alert">
              {draftError}
            </p>
          )}
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="primary"
          >
            保存新笔记
          </button>
          <button type="button" onClick={() => setDraft(null)}>
            取消
          </button>
        </form>
      )}
      {saved && <p role="status">你的判断已保存为新笔记。</p>}
    </article>
  );
}
