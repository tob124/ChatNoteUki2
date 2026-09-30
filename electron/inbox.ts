import { randomUUID } from "node:crypto";
import type { InboxBatch, InboxItem } from "../src/shared";
import { Store } from "./store";

export function splitInbox(raw: string): string[] {
  // Keep each original slice; normalize line endings only in the separator expression.
  const text = raw.replace(/^\uFEFF/, "");
  const newline = "(?:\\r\\n|\\r(?!\\n)|(?<!\\r)\\n)";
  const separator = new RegExp(
    `${newline}[\\t ]*${newline}(?:[\\t ]*${newline})*`,
    "g",
  );
  return text.split(separator).filter((part) => part.trim().length > 0);
}
export function decodeInbox(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
export function observeInbox(
  store: Store,
  raw: string,
  etag: string | null,
): InboxBatch | null {
  const parsed = splitInbox(raw);
  if (!parsed.length) return null;
  const batches = store.all<InboxBatch>("batches");
  const pending = batches.filter((b) => b.status === "pending").at(-1);
  if (pending?.snapshot === raw) return pending;
  let existing: InboxItem[] = [];
  if (pending) {
    const old = splitInbox(pending.snapshot);
    // A trailing single newline may become the separator for an appended note.
    const comparable = (s: string) => s.replace(/(?:\r\n|\r|\n)+$/, "");
    if (
      parsed.length < old.length ||
      !old.every((s, i) => comparable(s) === comparable(parsed[i]))
    ) {
      if (!batches.some((b) => b.status === "conflict" && b.snapshot === raw))
        store.append("inbox.conflict", {
          id: randomUUID(),
          snapshot: raw,
          etag,
          items: [],
          status: "conflict",
          createdAt: new Date().toISOString(),
        });
      throw new Error(
        "inbox 中已导入的内容被改写。原快照已保存；请核对并恢复原内容，或在手机清空已导入部分后再次同步。",
      );
    }
    existing = pending.items;
  }
  const items: InboxItem[] = parsed.map(
    (s, i) => existing[i] ?? { id: randomUUID(), raw: s },
  );
  const batch: InboxBatch = {
    id: randomUUID(),
    snapshot: raw,
    etag,
    items,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  const events = items
    .slice(existing.length)
    .map((item) =>
      store.event(
        "note.added",
        store.createNote({ raw: item.raw }, "inbox", item.id),
      ),
    );
  events.push(store.event("inbox.observed", batch));
  store.appendMany(events);
  return batch;
}
