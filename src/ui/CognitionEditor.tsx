import { useEffect, useState } from "react";
import {
  stateContentSchema,
  type Cognition,
  type StateContent,
} from "../shared";
import type { Action } from "./RecordCard";
const groups = [
  ["reasons", "主要理由"],
  ["uncertainties", "仍不确定"],
  ["questions", "未解决问题"],
  ["decisions", "已做决定"],
] as const;
export function CognitionEditor({
  value,
  onAction,
  onClose,
}: {
  value: Cognition;
  onAction: Action;
  onClose(): void;
}) {
  const [draft, setDraft] = useState<StateContent>(value),
    [base, setBase] = useState(value.version),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = "cognition:" + value.threadId;
  useEffect(() => {
    let active = true;
    void window.uki
      .workspaceState(key)
      .then((saved) => {
        if (!active) return;
        if (saved.draft) {
          try {
            setDraft(stateContentSchema.parse(JSON.parse(saved.draft)));
            setBase(saved.parentRevision ?? value.version);
            if (saved.parentRevision !== value.version)
              setError("草稿基于旧认知版本，请核对并重新编辑后保存。");
          } catch {
            setError("草稿无法读取，请核对后重新编辑。");
          }
        }
        setReady(true);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [key]);
  const update = (next: StateContent) => {
    setDraft(next);
    void window.uki
      .workspaceState(key, {
        draft: JSON.stringify(next),
        mode: "note",
        parentNoteId: null,
        parentRevision: base,
        openIds: [],
      })
      .catch((e) => setError(e.message));
  };
  return (
    <form
      className="cognition-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !ready) return;
        setBusy(true);
        setError("");
        onAction(async () => {
          try {
            await window.uki.editCognition(value.threadId, base, draft);
            await window.uki.workspaceState(key, {
              draft: "",
              mode: "note",
              parentNoteId: null,
              openIds: [],
            });
            onClose();
          } catch (e) {
            setError(String(e instanceof Error ? e.message : e));
          } finally {
            setBusy(false);
          }
        });
      }}
    >
      <p className="hint">
        手动编辑 · 基于 v{base} · 草稿仅本机保存，无须调用 AI
      </p>
      <label>
        当前看法
        <textarea
          aria-label="当前看法"
          disabled={!ready || busy}
          value={draft.viewpoint}
          onChange={(e) => update({ ...draft, viewpoint: e.target.value })}
        />
      </label>
      {groups.map(([field, label]) => (
        <label key={field}>
          {label}（每行一项）
          <textarea
            aria-label={label + "（每行一项）"}
            disabled={!ready || busy}
            value={draft[field].join("\n")}
            onChange={(e) =>
              update({
                ...draft,
                [field]: e.target.value.split("\n").filter(Boolean),
              })
            }
          />
        </label>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {base !== value.version && (
        <button
          type="button"
          onClick={() => {
            setBase(value.version);
            setError("已采用当前基础版本，请核对编辑内容后保存。");
          }}
        >
          核对后采用当前版本
        </button>
      )}
      <button
        className="primary"
        disabled={busy || !ready || base !== value.version}
      >
        保存为新认知版本
      </button>
      <button type="button" onClick={onClose}>
        收起编辑（保留草稿）
      </button>
    </form>
  );
}
