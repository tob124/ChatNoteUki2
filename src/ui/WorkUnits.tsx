import { useEffect, useState } from "react";
import type {
  Evidence,
  Proposal,
  Recap,
  StateContent,
  StructureProposal,
  Thread,
} from "../shared";
import { dateLabel, type Action } from "./RecordCard";
const groups: [keyof Omit<StateContent, "viewpoint">, string][] = [
  ["reasons", "主要理由"],
  ["uncertainties", "仍不确定"],
  ["questions", "未解决问题"],
  ["decisions", "已做决定"],
];
export function CognitionContent({ value }: { value: StateContent }) {
  return (
    <>
      <p className="viewpoint">{value.viewpoint || "尚未形成已确认认知"}</p>
      {groups.map(
        ([k, label]) =>
          value[k].length > 0 && (
            <section key={k}>
              <h4>{label}</h4>
              <ul>
                {value[k].map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </section>
          ),
      )}
    </>
  );
}
export function EvidenceLinks({
  refs,
  onEvidence,
}: {
  refs: Evidence[];
  onEvidence(r: Evidence): void;
}) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const ids = refs.map((r) => r.noteId).join(",");
  useEffect(() => {
    let active = true;
    if (ids)
      void window.uki
        .referenceTitles([...new Set(ids.split(","))])
        .then((value) => {
          if (active) setTitles(value);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [ids]);
  return (
    <div className="evidence">
      {refs.map((r, i) => (
        <button key={r.noteId + ":" + r.revision} onClick={() => onEvidence(r)}>
          {titles[r.noteId] ?? `原文 ${i + 1}`} · v{r.revision}
        </button>
      ))}
    </div>
  );
}
export function CognitionSuggestion({
  value,
  version,
  onAction,
  onEvidence,
}: {
  value: Proposal;
  version?: number;
  onAction: Action;
  onEvidence(r: Evidence): void;
}) {
  const [edit, setEdit] = useState(false),
    [draft, setDraft] = useState(value.after);
  const stale = version !== undefined && version !== value.baseVersion;
  if (value.status !== "pending")
    return (
      <details className="result-row" data-unit={value.id}>
        <summary>
          认知建议 · {value.status === "accepted" ? "已接受" : "已拒绝"} ·{" "}
          {dateLabel(value.createdAt)}
        </summary>
        <CognitionContent value={value.acceptedContent ?? value.after} />
        <EvidenceLinks refs={value.evidence ?? []} onEvidence={onEvidence} />
      </details>
    );
  return (
    <article className="proposal work-unit" data-unit={value.id}>
      <span className="eyebrow">
        认知变化建议 · 基于 v{value.baseVersion}
        {stale ? " · 已过期" : ""}
      </span>
      <h2>重新看待这个问题</h2>
      <div className="diff">
        <section>
          <h4>此前</h4>
          <CognitionContent value={value.before} />
        </section>
        <section>
          <h4>建议</h4>
          {edit ? (
            <>
              <label>
                当前看法
                <textarea
                  value={draft.viewpoint}
                  maxLength={2000}
                  onChange={(e) =>
                    setDraft({ ...draft, viewpoint: e.target.value })
                  }
                />
              </label>
              {groups.map(([k, label]) => (
                <label key={k}>
                  {label}（每行一项）
                  <textarea
                    value={draft[k].join("\n")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [k]: e.target.value.split("\n").filter(Boolean),
                      })
                    }
                  />
                </label>
              ))}
            </>
          ) : (
            <CognitionContent value={value.after} />
          )}
        </section>
      </div>
      <p>{value.reason}</p>
      <EvidenceLinks
        refs={
          value.evidence ??
          value.evidenceIds.map((noteId) => ({ noteId, revision: 0 }))
        }
        onEvidence={onEvidence}
      />
      <div className="record-actions">
        <button
          className="primary"
          disabled={stale}
          onClick={() =>
            onAction(() =>
              window.uki.resolve(value.id, "accept", edit ? draft : undefined),
            )
          }
        >
          {edit ? "保存并接受" : "接受认知建议"}
        </button>
        <button disabled={stale} onClick={() => setEdit(!edit)}>
          {edit ? "取消修改" : "修改后接受"}
        </button>
        <button
          onClick={() => onAction(() => window.uki.resolve(value.id, "reject"))}
        >
          拒绝
        </button>
      </div>
    </article>
  );
}
export function StructureSuggestion({
  value,
  threads,
  onAction,
  onEvidence,
  selected,
  onSelect,
  onTarget,
}: {
  value: StructureProposal;
  threads: Thread[];
  onAction: Action;
  onEvidence(r: Evidence): void;
  selected: boolean;
  onSelect(target?: string): void;
  onTarget(target: string): void;
}) {
  const [target, setTarget] = useState(value.targetId ?? "");
  const matching = threads.find(
    (t) =>
      !t.archived && t.parentId === value.parentId && t.title === value.title,
  );
  const destination =
    target || (value.kind === "create" ? (matching?.id ?? "") : "");
  const names = (ids: string[]) =>
    ids
      .map((id) => threads.find((t) => t.id === id)?.title ?? "历史线程")
      .join("、");
  const kind = {
    create: "建立问题",
    assign: "调整归属",
    merge: "合并问题",
    reparent: "调整层级",
  }[value.kind];
  const before = value.sourceIds.length
    ? names(value.sourceIds)
    : `${value.noteIds.length} 条待整理记录`;
  const after =
    value.kind === "create"
      ? destination
        ? names([destination])
        : `${value.parentId ? names([value.parentId]) + " / " : ""}${value.title}`
      : value.kind === "reparent"
        ? `${value.parentId ? names([value.parentId]) : "主问题"} / ${names(value.sourceIds)}`
        : names(target ? [target] : []);
  const impact = Object.keys(value.bases.notes).length;
  const detail = (
    <>
      <p className="structure-diff">
        <span>{before}</span>
        <span aria-hidden="true">→</span>
        <strong>{after || "选择目标问题"}</strong>
      </p>
      <p>{value.reason}</p>
      <p className="hint">
        影响 {impact} 条记录 · 原文与来源历史保留
        {value.kind === "merge"
          ? "；目标认知保持原版本，来源认知留在历史资料。"
          : ""}
      </p>
      <EvidenceLinks refs={value.evidence} onEvidence={onEvidence} />
    </>
  );
  if (value.status !== "pending")
    return (
      <details className="result-row" data-unit={value.id}>
        <summary>
          {kind} ·{" "}
          {
            (
              {
                accepted: "已接受",
                rejected: "已拒绝",
                deferred: "已暂缓",
                undone: "已撤销",
              } as const
            )[value.status]
          }{" "}
          · {value.title}
        </summary>
        {detail}
        <div className="record-actions">
          {value.status === "accepted" && (
            <button onClick={() => onAction(() => window.uki.undo(value.id))}>
              撤销结构操作
            </button>
          )}
          {["rejected", "deferred"].includes(value.status) && (
            <button
              onClick={() => onAction(() => window.uki.regenerate(value.id))}
            >
              重新核对依据
            </button>
          )}
        </div>
      </details>
    );
  return (
    <article className="structure work-unit" data-unit={value.id}>
      <div className="unit-heading">
        <span className="eyebrow">整理建议 · {kind}</span>
        <label className="check">
          <input
            aria-label={`选择建议 ${value.title}`}
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(destination || undefined)}
          />
          选择
        </label>
      </div>
      <h2>{value.title}</h2>
      {detail}
      {value.kind === "create" && (
        <label>
          归属选择
          <select
            aria-label="新问题或已有问题"
            value={destination}
            onChange={(e) => {
              setTarget(e.target.value);
              onTarget(e.target.value);
            }}
          >
            <option value="" disabled={!!matching}>
              建立新问题
            </option>
            {threads
              .filter((t) => !t.archived)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  归入：{t.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {value.kind === "merge" && (
        <label>
          合并后的目标线程
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              onTarget(e.target.value);
            }}
          >
            <option value="">请选择目标</option>
            {value.sourceIds.map((id) => (
              <option key={id} value={id}>
                {names([id])}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="record-actions">
        <button
          className="primary"
          disabled={value.kind === "merge" && !target}
          onClick={() =>
            onAction(() =>
              window.uki.structure(
                [value.id],
                "accept",
                ["merge", "create"].includes(value.kind)
                  ? destination || undefined
                  : undefined,
              ),
            )
          }
        >
          接受整理建议
        </button>
        <button
          onClick={() =>
            onAction(() => window.uki.structure([value.id], "defer"))
          }
        >
          暂缓
        </button>
        <button
          onClick={() =>
            onAction(() => window.uki.structure([value.id], "reject"))
          }
        >
          拒绝
        </button>
        <button onClick={() => onAction(() => window.uki.regenerate(value.id))}>
          重新生成
        </button>
      </div>
    </article>
  );
}
export function RecapContent({
  value,
  onEvidence,
  threadTitle,
  onThread,
}: {
  value: Recap;
  onEvidence(r: Evidence): void;
  threadTitle?: string;
  onThread?(threadId: string): void;
}) {
  return (
    <article className="recap work-unit" data-unit={value.id}>
      <span className="eyebrow">引用回顾 · {dateLabel(value.createdAt)}</span>
      <h2>{threadTitle ? `${threadTitle} · 回顾` : "这段时间的思考"}</h2>
      {onThread && (
        <button onClick={() => onThread(value.threadId)}>进入问题</button>
      )}
      <p className="hint">
        {dateLabel(value.start)} — {dateLabel(value.end)} · 问题内共{" "}
        {value.total} 条，实际取样 {value.sampled} 条 · 基础认知 v
        {value.baseVersion}
      </p>
      <h4>用户明确表达</h4>
      <p>{value.expressed}</p>
      <h4>AI 推测 · 待核对</h4>
      <p className="inference">{value.possible || "本次未提出新的推测。"}</p>
      <h4>继续追问</h4>
      <p>{value.questions || "本次未提出新的追问。"}</p>
      <EvidenceLinks refs={value.evidence} onEvidence={onEvidence} />
    </article>
  );
}
