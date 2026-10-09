import { createHash } from "node:crypto";
import type { ThoughtEvent, InboxBatch } from "../src/shared";
import { splitInbox } from "./inbox";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const itemDigest = (s: string) =>
  digest(s.replace(/(?:\r\n|\r|\n)+$/, ""));
export function redactBatch(batch: InboxBatch, ids: Set<string>): InboxBatch {
  if (!batch.items.some((i) => ids.has(i.id))) return batch;
  const parts = splitInbox(batch.snapshot);
  return {
    ...batch,
    snapshotHash: batch.snapshotHash ?? digest(batch.snapshot),
    itemHashes: batch.itemHashes ?? parts.map(itemDigest),
    redacted: true,
    snapshot: parts
      .map((part, i) => (ids.has(batch.items[i]?.id) ? "[笔记已删除]" : part))
      .join("\n\n"),
    items: batch.items.map((i) =>
      ids.has(i.id) ? { ...i, raw: "笔记已删除" } : i,
    ),
  };
}
// Preserve event identities, order, receipts and derived analyses. Only the deleted
// note's text/version payloads and import archive slices are replaced.
export function redactEvent(
  event: ThoughtEvent,
  ids: Set<string>,
): ThoughtEvent {
  const p = event.payload as any;
  if (
    event.type === "note.added" &&
    p.materialQuote &&
    ids.has(p.materialQuote.materialId)
  ) {
    event = {
      ...event,
      payload: {
        ...p,
        materialQuote: {
          ...p.materialQuote,
          text: "资料已删除",
          start: 0,
          end: 5,
        },
      },
    };
  }
  if (event.type === "material.updated" && ids.has(p.id)) {
    const value = { ...p.value };
    if ("segments" in value) value.segments = [];
    if ("summary" in value) value.summary = "";
    if ("summaries" in value) value.summaries = [];
    if ("synthesis" in value) value.synthesis = [];
    return { ...event, payload: { ...p, value } };
  }
  if (event.type === "inbox.observed" || event.type === "inbox.conflict")
    return { ...event, payload: redactBatch(p, ids) };
  if (event.type === "note.added" && ids.has(p.id))
    return {
      ...event,
      payload: {
        ...p,
        raw: "笔记已删除",
        title: "笔记已删除",
        synopsis: "",
        reply: null,
        materialQuote: undefined,
      },
    };
  if (event.type === "note.corrected" && ids.has(p.id))
    return { ...event, payload: { ...p, raw: "笔记已删除" } };
  if (event.type === "note.titled" && ids.has(p.id))
    return { ...event, payload: { ...p, title: "笔记已删除" } };
  if (event.type === "note.completed" && ids.has(p.id))
    return {
      ...event,
      payload: {
        ...p,
        result: { ...p.result, title: "笔记已删除", synopsis: "", reply: "" },
      },
    };
  if (
    (event.type === "note.started" || event.type === "task.updated") &&
    p.input &&
    [...ids].some((id) => p.id === id || p.input.includes(id))
  ) {
    const next = { ...p };
    delete next.input;
    delete next.candidate;
    return { ...event, payload: next };
  }
  if (event.type === "ai.attempt" && ids.has(p.owner))
    return { ...event, payload: { ...p, content: "" } };
  return event;
}
