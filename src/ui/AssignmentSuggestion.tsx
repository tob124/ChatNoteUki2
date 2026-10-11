import { useState } from "react";
import type { StructureProposal, Thread } from "../shared";
import type { Action } from "./RecordCard";

export function AssignmentSuggestion({
  value,
  threads,
  onAction,
}: {
  value: StructureProposal;
  threads: Thread[];
  onAction: Action;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const target =
    value.targetId ??
    threads.find(
      (t) =>
        !t.archived && t.title === value.title && t.parentId === value.parentId,
    )?.id;
  const title =
    value.kind === "assign"
      ? (threads.find((t) => t.id === target)?.title ?? value.title)
      : value.title;
  const decide = (decision: "accept" | "reject") => {
    if (busy) return;
    setBusy(true);
    setError("");
    onAction(async () => {
      try {
        await window.uki.structure([value.id], decision, target ?? undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    });
  };
  return (
    <section className="assignment-suggestion" aria-label="这条笔记的归属建议">
      <div className="assignment-line">
        <span>
          归属待确认 · <strong>{title}</strong>
        </span>
        <button disabled={busy} onClick={() => decide("accept")}>
          接受归属
        </button>
        <button disabled={busy} onClick={() => decide("reject")}>
          拒绝
        </button>
        <details>
          <summary aria-label="归属建议理由">理由</summary>
          <p>{value.reason}</p>
          <p className="hint">
            确认后影响 {value.noteIds.length}{" "}
            条笔记；原文保留。结构与正文版本会再次核对。
          </p>
        </details>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
