import {
  aiNoteSchema,
  isShortNote,
  type Note,
  type AiNoteResult,
} from "../src/shared";
export function normalizeText(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v) && v.every((s) => typeof s === "string"))
    return v.join("\n").trim();
}
// Validate independently: a bad classification must not discard a valid reply.
export function parseNoteParts(
  input: unknown,
  note: Note,
): { result: AiNoteResult; errors: Record<string, string> } {
  const object =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const errors: Record<string, string> = {};
  const raw = note.currentRaw ?? note.raw;
  const fallback: AiNoteResult = {
    title: note.title,
    synopsis: isShortNote(raw) ? "" : note.synopsis,
    reply: note.reply ?? "",
    threadId: null,
    newThreadTitle: null,
    newParentId: null,
    threadDescription: "",
  };
  const result = { ...fallback };
  for (const field of [
    "title",
    "synopsis",
    "reply",
    "threadId",
    "newThreadTitle",
    "newParentId",
    "threadDescription",
  ] as const) {
    let value = object[field];
    if (["title", "synopsis", "reply", "threadDescription"].includes(field))
      value = normalizeText(value);
    if (
      ["threadId", "newThreadTitle", "newParentId"].includes(field) &&
      (value === "" || value === undefined)
    )
      value = null;
    if (field === "threadDescription" && value == null) value = "";
    if (field === "synopsis" && isShortNote(raw) && value == null) value = "";
    const parsed = aiNoteSchema.shape[field].safeParse(value);
    if (parsed.success) (result as any)[field] = parsed.data;
    else
      errors[field] =
        `${{ title: "标题", synopsis: "摘要", reply: "回应", threadId: "分类", newThreadTitle: "新问题", newParentId: "上级问题", threadDescription: "问题说明" }[field]}尚未完成`;
  }
  if (!isShortNote(raw) && !result.synopsis?.trim())
    errors.synopsis = "摘要尚未完成";
  if (!result.reply?.trim()) errors.reply = "回应尚未完成";
  return { result, errors };
}
export function parseNoteResult(input: unknown, note: Note) {
  const { result, errors } = parseNoteParts(input, note);
  if (Object.keys(errors).length)
    throw new Error(Object.values(errors).join("；"));
  return result;
}
