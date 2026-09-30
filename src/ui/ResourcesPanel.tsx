import { useEffect, useRef, useState } from "react";
import type {
  Evidence,
  Thread,
  ThreadResources,
  UkiApi,
  WorkspaceState,
} from "../shared";
import { CognitionContent, RecapContent } from "./WorkUnits";
import { dateLabel, type Action } from "./RecordCard";
export type Reference = {
  detail: Awaited<ReturnType<UkiApi["detail"]>>;
  revision: number;
};
export function ResourcesPanel({
  resources,
  reference,
  panel,
  onPanel,
  onClear,
  onEvidence,
  onAction,
  onManage,
}: {
  resources: ThreadResources | null;
  reference: Reference | null;
  panel: NonNullable<WorkspaceState["panel"]>;
  onPanel(p: NonNullable<WorkspaceState["panel"]>): void;
  onClear(): void;
  onEvidence(r: Evidence): void;
  onAction: Action;
  onManage(thread: Thread): void;
}) {
  const [history, setHistory] = useState<ThreadResources | null>(null),
    [pro, setPro] = useState(false),
    [historyError, setHistoryError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    previous = useRef<"normal" | "wide">("normal");
  useEffect(() => {
    setHistory(null);
    setPro(false);
  }, [resources?.thread?.id]);
  useEffect(() => {
    if (panel === "max") dialog.current?.showModal();
    else if (panel !== "closed") previous.current = panel;
    return () => dialog.current?.close();
  }, [panel]);
  const data = history ?? resources;
  const content = (
    <>
      <header className="resource-header">
        <div>
          <span className="eyebrow">随时查阅</span>
          <h2>{reference ? "原文引用" : history ? "历史资料" : "问题概览"}</h2>
        </div>
        <div className="resource-controls">
          <button
            aria-label={panel === "wide" ? "普通宽度" : "加宽资料栏"}
            onClick={() => onPanel(panel === "wide" ? "normal" : "wide")}
          >
            ↔
          </button>
          <button
            aria-label={panel === "max" ? "退出阅读层" : "最大化资料"}
            onClick={() => onPanel(panel === "max" ? previous.current : "max")}
          >
            ⛶
          </button>
          <button aria-label="收起资料" onClick={() => onPanel("closed")}>
            ×
          </button>
        </div>
      </header>
      <div className="resource-scroll">
        {reference ? (
          <>
            <button className="back-link" onClick={onClear}>
              ← 返回概览
            </button>
            <h3>{reference.detail.note.title}</h3>
            <p className="hint">
              {dateLabel(
                reference.detail.revisions.find(
                  (r) => r.revision === reference.revision,
                )?.createdAt ?? reference.detail.note.createdAt,
              )}{" "}
              · 引用版本 {reference.revision}
            </p>
            <p className="original reference-raw">
              {reference.detail.revisions.find(
                (r) => r.revision === reference.revision,
              )?.raw ?? "引用版本不存在"}
            </p>
            {reference.revision !== (reference.detail.note.revision ?? 0) && (
              <p className="hint">
                正文后来已更正。此处保留建议当时引用的文字。
              </p>
            )}
          </>
        ) : (
          <>
            {history && (
              <button className="back-link" onClick={() => setHistory(null)}>
                ← 返回当前问题
              </button>
            )}
            {data?.thread ? (
              <>
                <h3>{data.thread.title}</h3>
                <p>
                  {data.thread.description ||
                    "为这个问题补充范围说明，让整理更有依据。"}
                </p>
                <p className="hint">
                  {data.count} 条记录 ·{" "}
                  {data.thread.archived ? "历史资料" : "活动问题"}
                </p>
                <button onClick={() => onManage(data.thread!)}>管理问题</button>
                <section className="resource-section">
                  <span className="section-label">
                    已确认认知 · v{data.cognition.version}
                  </span>
                  <CognitionContent value={data.cognition} />
                </section>
                {!data.thread.archived && (
                  <div className="analysis-controls">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={pro}
                        onChange={(e) => setPro(e.target.checked)}
                      />
                      本次主动分析使用 Pro
                    </label>
                    <button
                      onClick={() => {
                        const model = pro
                          ? "deepseek-v4-pro"
                          : "deepseek-flash";
                        setPro(false);
                        onAction(() =>
                          window.uki.propose(data.thread!.id, model),
                        );
                      }}
                    >
                      回看历史，提出认知差异
                    </button>
                    <button
                      onClick={() => {
                        const model = pro
                          ? "deepseek-v4-pro"
                          : "deepseek-flash";
                        setPro(false);
                        onAction(() =>
                          window.uki.recap(data.thread!.id, model),
                        );
                      }}
                    >
                      {data.recapDue ? "有新内容 · 生成回顾" : "生成引用回顾"}
                    </button>
                    <p className="hint">分析后在工作区审批。点击才调用 AI。</p>
                  </div>
                )}
                {data.recaps.map((r) => (
                  <details key={r.id}>
                    <summary>回顾 · {dateLabel(r.createdAt)}</summary>
                    <RecapContent value={r} onEvidence={onEvidence} />
                  </details>
                ))}
                {data.cognitionHistory.length > 0 && (
                  <details>
                    <summary>历史认知版本</summary>
                    {data.cognitionHistory
                      .slice()
                      .reverse()
                      .map((c) => (
                        <section key={c.version}>
                          <span className="section-label">
                            版本 {c.version}
                          </span>
                          <CognitionContent value={c} />
                        </section>
                      ))}
                  </details>
                )}
              </>
            ) : (
              <div className="resource-empty">
                <h3>给思考留出空间</h3>
                <p>进入一个问题，查看已确认认知、未解决问题和带引用的回顾。</p>
              </div>
            )}
            <details className="legacy">
              <summary>
                历史线程资料 · {resources?.legacyThreads.length ?? 0}
              </summary>
              {resources?.legacyThreads.map((t) => (
                <button
                  className="history-link"
                  key={t.id}
                  onClick={() => {
                    setHistoryError("");
                    void window.uki
                      .resources(t.id)
                      .then(setHistory)
                      .catch((e) => setHistoryError(e.message));
                  }}
                >
                  {t.title}
                </button>
              ))}
              {historyError && <p className="error">{historyError}</p>}
            </details>
          </>
        )}
      </div>
    </>
  );
  if (panel === "max")
    return (
      <dialog
        className="reading-layer"
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          onPanel(previous.current);
        }}
      >
        {content}
      </dialog>
    );
  return (
    <aside
      className={`resources-panel ${panel === "wide" ? "wide" : ""}`}
      aria-label="备查资料"
    >
      {content}
    </aside>
  );
}
