import { useEffect, useRef, useState } from "react";
import { CognitionEditor } from "./CognitionEditor";
import type {
  Evidence,
  Cognition,
  AiTask,
  Thread,
  ThreadResources,
  UkiApi,
  WorkspaceState,
} from "../shared";
import { CognitionContent, RecapContent } from "./WorkUnits";
import { dateLabel, type Action } from "./RecordCard";
import { AnalysisControls } from "./AnalysisControls";
import { ResearchControls } from "./ResearchControls";
import type { ResearchSource } from "../research";
export type ExternalReference = { source: ResearchSource };
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
  tasks,
  hasApiKey,
  onSettings,
  onResult,
  externalReference,
  onSource,
  onLocate,
}: {
  resources: ThreadResources | null;
  reference: Reference | null;
  panel: NonNullable<WorkspaceState["panel"]>;
  onPanel(p: NonNullable<WorkspaceState["panel"]>): void;
  onClear(): void;
  onEvidence(r: Evidence): void;
  onAction: Action;
  onManage(thread: Thread): void;
  tasks: AiTask[];
  hasApiKey: boolean;
  onSettings(): void;
  onResult(task: AiTask): void;
  externalReference?: ExternalReference | null;
  onSource(ownerId: string, sourceId: string): void;
  onLocate?(id: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    previous = useRef<"normal" | "wide">("normal");
  useEffect(() => {
    if (panel === "max") dialog.current?.showModal();
    else if (panel !== "closed") previous.current = panel;
    return () => dialog.current?.close();
  }, [panel]);
  const data = resources;
  const [editingCognition, setEditingCognition] = useState(false);
  const recapTask = tasks
    .filter((t) => t.threadId === data?.thread?.id && t.kind === "recap")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const content = (
    <>
      <header className="resource-header">
        <div>
          <span className="eyebrow">
            {reference || externalReference ? "核对依据" : "随时查阅"}
          </span>
          <h2>
            {externalReference
              ? "来源核对"
              : reference
                ? "原文引用"
                : "问题概览"}
          </h2>
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
        {externalReference ? (
          (() => {
            const source = externalReference.source;
            return (
              <>
                <button className="back-link" onClick={onClear}>
                  返回概览
                </button>
                {source ? (
                  <>
                    <h3>{source.title}</h3>
                    <p className="hint">{new URL(source.url).hostname}</p>
                    <button
                      onClick={() =>
                        onAction(() => window.uki.openSource(source.url))
                      }
                    >
                      打开原网页
                    </button>
                    <p className="hint">
                      {source.fetchedAt
                        ? `读取于 ${dateLabel(source.fetchedAt)}`
                        : `发现于 ${dateLabel(source.discoveredAt)}`}
                    </p>
                    <p className="hint">{source.coverage}</p>
                    {source.error && (
                      <p className="error-text">{source.error}</p>
                    )}
                    {source.status === "read" ? (
                      <p className="original reference-raw">{source.text}</p>
                    ) : (
                      <>
                        <p className="hint">未取得正文，不能作为已核实依据。</p>
                        {source.snippet && (
                          <p className="original">搜索摘要：{source.snippet}</p>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <p className="hint">该来源不存在。</p>
                )}
              </>
            );
          })()
        ) : reference ? (
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
              {reference.detail.note.deletedAt
                ? "笔记已删除"
                : (reference.detail.revisions.find(
                    (r) => r.revision === reference.revision,
                  )?.raw ?? "引用版本不存在")}
            </p>
            {!reference.detail.note.deletedAt && (
              <div className="record-actions">
                <button
                  onClick={() =>
                    onEvidence({
                      noteId: reference.detail.note.id,
                      revision: reference.detail.note.revision ?? 0,
                    })
                  }
                >
                  查看最新正文
                </button>
                <button onClick={() => onLocate?.(reference.detail.note.id)}>
                  定位原记录
                </button>
              </div>
            )}
            {reference.revision !== (reference.detail.note.revision ?? 0) && (
              <p className="hint">
                正文后来已更正。此处保留建议当时引用的文字。
              </p>
            )}
          </>
        ) : (
          <>
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
                <details
                  className="question-actions"
                  data-popover
                  data-close-on-action
                  onClick={(e) => {
                    if (
                      e.target instanceof HTMLElement &&
                      e.target.closest("button")
                    )
                      e.currentTarget.open = false;
                  }}
                >
                  <summary>问题操作</summary>
                  <div className="menu-items">
                    <button onClick={() => onManage(data.thread!)}>
                      管理问题
                    </button>
                    <button
                      onClick={() =>
                        onAction(() =>
                          window.uki.pin(data.thread!.id, !data.thread!.pinned),
                        )
                      }
                    >
                      {data.thread.pinned ? "取消置顶" : "置顶问题"}
                    </button>
                    <button
                      onClick={() =>
                        onAction(() =>
                          window.uki.exportNotes([], data.thread!.id),
                        )
                      }
                    >
                      导出此问题…
                    </button>
                  </div>
                </details>
                <section className="resource-section">
                  <span className="section-label">
                    已确认认知 · v{data.cognition.version}
                  </span>
                  <CognitionContent value={data.cognition} />
                  {!data.thread.archived && (
                    <button onClick={() => setEditingCognition((v) => !v)}>
                      手动编辑认知
                    </button>
                  )}
                  {editingCognition && (
                    <CognitionEditor
                      key={data.thread.id}
                      value={data.cognition}
                      onAction={onAction}
                      onClose={() => setEditingCognition(false)}
                    />
                  )}
                </section>
                {!data.thread.archived && (
                  <AnalysisControls
                    key={data.thread.id}
                    threadId={data.thread.id}
                    count={data.count}
                    tasks={tasks}
                    hasApiKey={hasApiKey}
                    onAction={onAction}
                    onSettings={onSettings}
                    onResult={onResult}
                  />
                )}
                {!data.thread.archived && (
                  <section className="resource-section resource-research">
                    <h3>参考资料</h3>
                    <ResearchControls
                      key={`research:${data.thread.id}`}
                      threadId={data.thread.id}
                      title={data.thread.title}
                      tasks={tasks}
                      hasApiKey={hasApiKey}
                      onAction={onAction}
                      onResult={onResult}
                      onSource={onSource}
                    />
                  </section>
                )}
                {data.recaps.map((r) => (
                  <details
                    key={r.id}
                    open={
                      recapTask?.status === "done" &&
                      recapTask.resultId === r.id
                        ? true
                        : undefined
                    }
                  >
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
                        <CognitionHistory
                          key={c.threadId + ":" + c.version}
                          value={c}
                          base={data.cognition.version}
                          archived={!!data.thread!.archived}
                          onAction={onAction}
                        />
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
          </>
        )}
      </div>
    </>
  );
  if (panel === "max")
    return (
      <dialog
        className="reading-layer"
        id="workspace-resources"
        aria-label={
          reference ? "原文引用" : externalReference ? "来源核对" : "问题概览"
        }
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
      id="workspace-resources"
      aria-label="备查资料"
    >
      {content}
    </aside>
  );
}
function CognitionHistory({
  value,
  base,
  archived,
  onAction,
}: {
  value: Cognition;
  base: number;
  archived: boolean;
  onAction: Action;
}) {
  const [full, setFull] = useState<Cognition | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !full)
          void window.uki
            .cognitionVersion(value.threadId, value.version)
            .then(setFull)
            .catch((e) => setError(e.message));
      }}
    >
      <summary>
        版本 {value.version} · {value.viewpoint || "暂无概述"}
      </summary>
      {error && <p className="error">{error}</p>}
      {full ? (
        <CognitionContent value={full} />
      ) : (
        <p className="hint">读取版本…</p>
      )}
      {full && value.version !== base && !archived && (
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onAction(async () => {
              try {
                await window.uki.restoreCognition(
                  value.threadId,
                  value.version,
                  base,
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            });
          }}
        >
          将此版本恢复为新版本
        </button>
      )}
    </details>
  );
}
