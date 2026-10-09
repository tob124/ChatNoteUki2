import { useEffect, useRef, useState } from "react";
import type { UkiApi } from "../shared";
export function QuoteReference({ noteId }: { noteId: string }) {
  const [source, setSource] = useState<Awaited<
      ReturnType<UkiApi["quoteSource"]>
    > | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (source) dialog.current?.showModal();
  }, [source]);
  const close = () => {
    setSource(null);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        className="back-link"
        ref={trigger}
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            setSource(await window.uki.quoteSource(noteId));
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        核对参考摘录
      </button>
      {error && <p className="error">{error}</p>}
      {source && (
        <dialog className="material-reader" ref={dialog} onCancel={close}>
          <header>
            <h2>{source.quote.name}</h2>
            <button onClick={close}>关闭摘录</button>
          </header>
          <p className="hint">
            {source.quote.page ? `PDF 第 ${source.quote.page} 页 · ` : ""}段落{" "}
            {source.quote.segmentId} · 参考资料，非用户原话
          </p>
          {!source.material ? (
            <p>资料已删除，笔记自己的正文保留。</p>
          ) : (
            <>
              <blockquote>{source.quote.text}</blockquote>
              {!source.current && (
                <p className="error">
                  提取内容已变化。这是记录当时的摘录，请对照原文件重新核对。
                </p>
              )}
              <details open>
                <summary>所在段落</summary>
                <p>
                  {source.material.segments.find(
                    (s) => s.id === source.quote.segmentId,
                  )?.text ?? "原段落已不可用"}
                </p>
              </details>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await window.uki.materialOriginal(source.quote.materialId);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                打开原文件
              </button>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </dialog>
      )}
    </>
  );
}
