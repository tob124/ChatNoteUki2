import { aiNoteSchema, isShortNote, type Note } from "../src/shared";
const text = (v: unknown) =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? v.join("\n") : v;
function shorten(value: unknown, limit: number) {
  if (typeof value !== "string" || value.length <= limit) return value;
  let prefix = "";
  for (const ch of value.trim()) {
    if (prefix.length + ch.length > limit - 1) break;
    prefix += ch;
  }
  return prefix.trimEnd() + "…";
}
export function parseNoteResult(input: unknown, note: Note) {
  const object =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const value = {
    ...object,
    threadId:
      object.threadId === undefined || object.threadId === ""
        ? null
        : object.threadId,
    newThreadTitle:
      object.newThreadTitle === undefined || object.newThreadTitle === ""
        ? null
        : object.newThreadTitle,
    newParentId: object.newParentId === "" ? null : object.newParentId,
    threadDescription:
      object.threadDescription === null ? "" : object.threadDescription,
    title: shorten(object.title, 24),
    synopsis:
      isShortNote(note.currentRaw ?? note.raw) && object.synopsis == null
        ? ""
        : text(object.synopsis),
    reply:
      note.mode === "note"
        ? shorten(text(object.reply), 150)
        : text(object.reply),
  };
  const parsed = aiNoteSchema.safeParse(value);
  if (!parsed.success) {
    const labels: Record<string, string> = {
      title: "标题",
      synopsis: "摘要",
      reply: "回应",
      threadId: "线程引用",
      newParentId: "上级问题引用",
      newThreadTitle: "新问题标题",
      threadDescription: "问题说明",
    };
    const fields = [
      ...new Set(
        parsed.error.issues.map((i) => labels[String(i.path[0])] ?? "笔记内容"),
      ),
    ];
    throw new Error(
      `笔记整理格式校验失败：${fields.join("、")}缺失、类型错误或超过长度限制。原文已保存，可手动重试。`,
    );
  }
  return parsed.data;
}
