import { useState } from "react";
import {
  emptyContent,
  type AppView,
  type Proposal,
  type StateContent,
} from "../shared";
const groups: [keyof Omit<StateContent, "viewpoint">, string][] = [
  ["reasons", "主要理由"],
  ["uncertainties", "仍不确定"],
  ["questions", "待解决的问题"],
  ["decisions", "已做的决定"],
];
function Content({ content }: { content: StateContent }) {
  return (
    <>
      <p className="viewpoint">{content.viewpoint || "尚未形成当前认知"}</p>
      {groups.map(([key, label]) =>
        content[key].length ? (
          <section key={key}>
            <h4>{label}</h4>
            <ul>
              {content[key].map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </>
  );
}
function ProposalCard({
  proposal,
  data,
  stale,
  onAction,
  onEvidence,
}: {
  proposal: Proposal;
  data: AppView;
  stale: boolean;
  onAction(action: () => Promise<unknown>): void;
  onEvidence(id: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StateContent>(proposal.after);
  return (
    <article className="proposal">
      <h3>认知变化建议</h3>
      <p className="muted">
        基于认知版本 {proposal.baseVersion}
        {stale ? " · 已过期" : ""}
      </p>
      <div className="diff-before">
        <span className="section-label">此前</span>
        <Content content={proposal.before} />
      </div>
      <div className="diff-after">
        <span className="section-label">候选认知</span>
        {editing ? (
          <div className="edit-content">
            <label>
              当前看法
              <textarea
                value={draft.viewpoint}
                onChange={(e) =>
                  setDraft({ ...draft, viewpoint: e.target.value })
                }
                maxLength={2000}
              />
            </label>
            {groups.map(([key, label]) => (
              <label key={key}>
                {label}（每行一项）
                <textarea
                  value={draft[key].join("\n")}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value.split("\n") })
                  }
                />
              </label>
            ))}
          </div>
        ) : (
          <Content content={proposal.after} />
        )}
      </div>
      <p className="proposal-reason">{proposal.reason}</p>
      <div className="evidence">
        <span className="section-label">历史依据</span>
        {proposal.evidenceIds.map((id) => (
          <button key={id} onClick={() => onEvidence(id)}>
            {data.notes.find((n) => n.id === id)?.title ?? "查看原文"}
          </button>
        ))}
      </div>
      <div className="proposal-actions">
        <button
          className="primary"
          disabled={stale}
          onClick={() =>
            onAction(() =>
              window.uki.resolve(
                proposal.id,
                "accept",
                editing
                  ? {
                      ...draft,
                      reasons: draft.reasons.filter(Boolean),
                      uncertainties: draft.uncertainties.filter(Boolean),
                      questions: draft.questions.filter(Boolean),
                      decisions: draft.decisions.filter(Boolean),
                    }
                  : undefined,
              ),
            )
          }
        >
          {editing ? "保存并接受" : "接受"}
        </button>
        <button disabled={stale} onClick={() => setEditing(!editing)}>
          {editing ? "取消修改" : "修改后接受"}
        </button>
        <button
          onClick={() =>
            onAction(() => window.uki.resolve(proposal.id, "reject"))
          }
        >
          拒绝
        </button>
      </div>
    </article>
  );
}
export function CognitionPanel({
  data,
  threadId,
  onClose,
  onAction,
  onEvidence,
}: {
  data: AppView;
  threadId: string | null;
  onClose(): void;
  onAction(action: () => Promise<unknown>): void;
  onEvidence(id: string): void;
}) {
  const cognition = data.cognitions.find((c) => c.threadId === threadId);
  const proposals = data.proposals.filter(
    (p) => p.threadId === threadId && p.status === "pending",
  );
  return (
    <aside className="cognition-panel">
      <header>
        <h2>当前认知</h2>
        <button onClick={onClose} aria-label="收起当前认知">
          收起
        </button>
      </header>
      {threadId ? (
        <>
          <p className="muted">
            版本 {cognition?.version ?? 0} · 只有你能确认改变
          </p>
          <Content content={cognition ?? emptyContent()} />
          <button
            className="suggest-button"
            onClick={() =>
              onAction(() => window.uki.propose(threadId, "deepseek-flash"))
            }
          >
            回看历史，提出认知差异
          </button>
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              data={data}
              stale={p.baseVersion !== (cognition?.version ?? 0)}
              onAction={onAction}
              onEvidence={onEvidence}
            />
          ))}
          {data.proposals.some(
            (p) => p.threadId === threadId && p.status !== "pending",
          ) ? (
            <details className="resolved">
              <summary>已处理的变化建议</summary>
              {data.proposals
                .filter(
                  (p) => p.threadId === threadId && p.status !== "pending",
                )
                .map((p) => (
                  <div key={p.id}>
                    <strong>
                      {p.status === "accepted"
                        ? `已接受为版本 ${p.baseVersion + 1}`
                        : "已拒绝"}
                    </strong>
                    <p>{p.reason}</p>
                    <Content content={p.acceptedContent ?? p.after} />
                  </div>
                ))}
            </details>
          ) : null}
        </>
      ) : (
        <p className="muted">
          选择一个思考线程，查看你目前的看法、理由和未解决的问题。
        </p>
      )}
    </aside>
  );
}
