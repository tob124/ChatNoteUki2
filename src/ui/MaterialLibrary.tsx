import { useEffect, useRef, useState } from "react";
import type { Material, MaterialSummary } from "../materials";
import type { Action } from "./RecordCard";
import type { QuoteLocator } from "../workspace-tools";
import { ExcerptComposer } from "./ExcerptComposer";
const labels: Record<string, string> = {
  extracting: "提取文字",
  pending: "摘要排队",
  running: "生成摘要",
  done: "已完成",
  partial: "部分完成",
  failed: "处理失败",
  cancelled: "已取消",
};
export function MaterialLibrary({
  trash = false,
  noteId,
  onAction,
  revisionToken,
  openId,
  onOpened,
}: {
  trash?: boolean;
  noteId?: string;
  onAction: Action;
  revisionToken: number;
  openId?: string;
  onOpened?(): void;
}) {
  const [page, setPage] = useState<{
      items: MaterialSummary[];
      before: number | null;
    }>({ items: [], before: null }),
    [query, setQuery] = useState(""),
    [before, setBefore] = useState<number>(),
    [error, setError] = useState("");
  const [detail, setDetail] = useState<Material | null>(null),
    [readPage, setReadPage] = useState(0),
    [busy, setBusy] = useState(false),
    [purge, setPurge] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [quote, setQuote] = useState<QuoteLocator | null>(null),
    [editingQuote, setEditingQuote] = useState(false),
    [recorded, setRecorded] = useState(false);
  useEffect(() => {
    let active = true;
    if (openId)
      void window.uki
        .materialDetail(openId)
        .then((value) => {
          if (active) {
            setDetail(value);
            setReadPage(0);
            onOpened?.();
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [openId]);
  useEffect(() => {
    let active = true;
    void window.uki
      .materialPage(query, before, trash, noteId)
      .then((value) => {
        if (active) setPage(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [query, before, trash, noteId, revisionToken]);
  const listedSource = page.items.find((m) => m.id === detail?.id);
  const readerVersion = listedSource
    ? JSON.stringify([
        listedSource.revision,
        listedSource.status,
        listedSource.summary,
        listedSource.coverage,
        listedSource.deletedAt,
      ])
    : revisionToken;
  useEffect(() => {
    if (!detail) return;
    let active = true;
    void window.uki
      .materialDetail(detail.id)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [detail?.id, readerVersion]);
  useEffect(() => {
    if (detail) {
      dialog.current?.showModal();
    }
    return () => {
      dialog.current?.close();
    };
  }, [detail?.id]);
  const act = (fn: () => Promise<unknown>) => {
    if (busy) return;
    if (!detail) opener.current = document.activeElement as HTMLElement;
    setBusy(true);
    setError("");
    onAction(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    });
  };
  const close = () => {
    setQuote(null);
    setEditingQuote(false);
    setRecorded(false);
    setDetail(null);
    setPurge(false);
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus();
    });
  };
  return (
    <section
      className="material-library"
      aria-label={trash ? "资料回收站" : "附件资料"}
    >
      <header className="material-heading">
        <div>
          <h2>
            {trash ? "已删除的资料" : noteId ? "关联参考资料" : "附件资料"}
          </h2>
          <p className="hint">
            资料与用户表达分开保存。摘要失败仍可查阅原文件和已提取文字。
          </p>
        </div>
        {!trash && (
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                await window.uki.importFiles(noteId);
              })
            }
          >
            导入资料…
          </button>
        )}
      </header>
      <div className="search-row">
        <input
          type="search"
          aria-label="搜索资料"
          placeholder="搜索文件名、提取文字或摘要"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setBefore(undefined);
          }}
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setBefore(undefined);
            }}
          >
            清除关键词
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {page.items.map((m) => (
        <article className="material-card" key={m.id}>
          <div className="record-meta">
            <span className="section-label">
              参考资料 · {m.format.toUpperCase()}
            </span>
            <span>
              {labels[m.status]} · {(m.bytes / 1024).toFixed(0)} KiB
            </span>
          </div>
          <button
            className="record-title"
            onClick={() =>
              act(async () => {
                setDetail(await window.uki.materialDetail(m.id));
                setReadPage(0);
              })
            }
          >
            {m.name}
          </button>
          <p className="hint">{m.coverage}</p>
          {m.summary && (
            <p className="synopsis">
              <span>AI 资料摘要</span> {m.summary}
            </p>
          )}
          {m.error && <p className="error">{m.error}</p>}
          <div className="record-actions">
            <button
              onClick={() =>
                act(async () => {
                  setDetail(await window.uki.materialDetail(m.id));
                  setReadPage(0);
                })
              }
            >
              查看资料
            </button>
            {!trash && (
              <button
                disabled={
                  busy ||
                  ["extracting", "running", "pending"].includes(m.status)
                }
                title={
                  ["extracting", "running", "pending"].includes(m.status)
                    ? "当前任务正在处理，可在 AI 任务面板查看或取消"
                    : ""
                }
                onClick={() =>
                  act(() => window.uki.materialAction(m.id, "retry"))
                }
              >
                重新处理
              </button>
            )}
            {trash && (
              <button
                disabled={busy}
                onClick={() =>
                  act(() => window.uki.materialAction(m.id, "restore"))
                }
              >
                恢复资料
              </button>
            )}
          </div>
        </article>
      ))}
      {!page.items.length && (
        <p className="hint">
          {query
            ? "未找到资料，可清除关键词。"
            : trash
              ? "资料回收站为空。"
              : "可导入或拖放 PDF、DOCX、TXT、Markdown，每个文件最多 25 MiB。"}
        </p>
      )}
      <div className="record-actions">
        {page.before && (
          <button onClick={() => setBefore(page.before!)}>更早资料</button>
        )}
        {before && (
          <button onClick={() => setBefore(undefined)}>最新资料</button>
        )}
      </div>
      {detail && (
        <dialog ref={dialog} className="material-reader" onCancel={close}>
          <header>
            <div>
              <span className="section-label">参考资料</span>
              <h2>{detail.name}</h2>
            </div>
            <button onClick={close}>关闭资料</button>
          </header>
          <p className="hint">
            {detail.coverage} · {labels[detail.status]}
          </p>
          <div className="record-actions">
            <button
              disabled={busy}
              onClick={() => act(() => window.uki.materialOriginal(detail.id))}
            >
              打开原文件
            </button>
            <button
              disabled={busy}
              onClick={() =>
                act(() => window.uki.materialOriginal(detail.id, true))
              }
            >
              保存原文件…
            </button>
            {detail.deletedAt ? (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await window.uki.materialAction(detail.id, "restore");
                      close();
                    })
                  }
                >
                  恢复资料
                </button>
                <button onClick={() => setPurge(true)}>彻底删除…</button>
              </>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await window.uki.materialAction(detail.id, "trash");
                    close();
                  })
                }
              >
                移入回收站
              </button>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {purge && (
            <div className="inline-confirm">
              <p>
                删除原文件、提取文字及摘要。其他分析保留；仅清理没有其他资料引用的文件块。
              </p>
              <button
                className="danger-text"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await window.uki.materialAction(detail.id, "purge");
                    close();
                  })
                }
              >
                确认彻底删除
              </button>
              <button onClick={() => setPurge(false)}>继续保留</button>
            </div>
          )}
          {detail.summary && (
            <section className="material-summary">
              <h3>AI 资料摘要</h3>
              <p>{detail.summary}</p>
              <div className="record-actions">
                {[
                  ...new Set(
                    detail.synthesis.at(-1)?.evidenceSegmentIds ??
                      detail.summaries.flatMap((s) => s.evidenceSegmentIds),
                  ),
                ].map((id) => (
                  <button
                    key={id}
                    onClick={() => {
                      setReadPage(Math.floor((id - 1) / 30));
                      requestAnimationFrame(() =>
                        dialog.current
                          ?.querySelector(`[data-segment="${id}"]`)
                          ?.scrollIntoView({ block: "center" }),
                      );
                    }}
                  >
                    查看
                    {detail.segments.find((s) => s.id === id)?.page
                      ? `第 ${detail.segments.find((s) => s.id === id)!.page} 页 · `
                      : ""}
                    段落 {id}
                  </button>
                ))}
              </div>
            </section>
          )}
          <h3>提取文字 · 第 {readPage + 1} 页</h3>
          <p className="hint">
            每页最多显示 30 段。选中文字可摘录；键盘聚焦段落后按 Enter
            可记录整段想法。
          </p>
          {recorded && (
            <p className="hint" role="status">
              想法已保存到本机，可在全部记录查阅；资料阅读位置保留。
            </p>
          )}
          {quote && !editingQuote && !detail.deletedAt && (
            <button
              className="primary excerpt-trigger"
              onClick={() => setEditingQuote(true)}
            >
              摘录并记录想法
            </button>
          )}
          {quote && editingQuote && !detail.deletedAt && (
            <ExcerptComposer
              quote={quote}
              name={detail.name}
              noteId={noteId}
              onClose={() => setEditingQuote(false)}
              onSaved={() => {
                setRecorded(true);
                setEditingQuote(false);
                setQuote(null);
                onAction(async () => {});
              }}
            />
          )}
          {detail.segments
            .slice(readPage * 30, (readPage + 1) * 30)
            .map((s) => (
              <section
                className="material-segment"
                data-segment={s.id}
                key={s.id}
              >
                <span className="section-label">
                  {s.page ? `PDF 第 ${s.page} 页 · ` : ""}段落 {s.id}
                </span>
                <p
                  tabIndex={0}
                  data-source-text
                  onMouseUp={(e) => {
                    if (editingQuote || detail.deletedAt) return;
                    const selected = window.getSelection();
                    if (
                      !selected ||
                      selected.isCollapsed ||
                      !selected.rangeCount
                    ) {
                      setQuote(null);
                      return;
                    }
                    const range = selected.getRangeAt(0),
                      el = e.currentTarget;
                    if (
                      !el.contains(range.startContainer) ||
                      !el.contains(range.endContainer)
                    ) {
                      setQuote(null);
                      return;
                    }
                    const prefix = range.cloneRange();
                    prefix.selectNodeContents(el);
                    prefix.setEnd(range.startContainer, range.startOffset);
                    const start = prefix.toString().length,
                      text = range.toString();
                    if (text.length > 12000 || !text.trim()) {
                      setError("摘录请选择 1–12000 个字符的原文");
                      return;
                    }
                    setQuote({
                      materialId: detail.id,
                      sha256: detail.sha256,
                      segmentId: s.id,
                      start,
                      end: start + text.length,
                      text,
                    });
                    setRecorded(false);
                  }}
                  onKeyUp={(e) => {
                    if (
                      e.key === "Enter" &&
                      !detail.deletedAt &&
                      !editingQuote
                    ) {
                      setQuote({
                        materialId: detail.id,
                        sha256: detail.sha256,
                        segmentId: s.id,
                        start: 0,
                        end: s.text.length,
                        text: s.text,
                      });
                      setEditingQuote(true);
                    }
                  }}
                >
                  {s.text}
                </p>
              </section>
            ))}
          <div className="record-actions">
            <button
              disabled={!readPage}
              onClick={() => setReadPage((p) => p - 1)}
            >
              上一页文字
            </button>
            <button
              disabled={(readPage + 1) * 30 >= detail.segments.length}
              onClick={() => setReadPage((p) => p + 1)}
            >
              下一页文字
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
