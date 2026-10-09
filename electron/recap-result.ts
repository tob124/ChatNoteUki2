import { z } from "zod";
import type { Evidence } from "../src/shared";

// Models sometimes express sections as lists. Preserve their text without
// accepting arbitrary objects or inventing missing evidence.
const section = (limit: number) =>
  z
    .union([z.string(), z.array(z.string()).max(30)])
    .transform((value) => (Array.isArray(value) ? value.join("\n") : value))
    .pipe(z.string().max(limit));
const recapSchema = z.object({
  expressed: section(200000).refine((s) => !!s.trim(), "empty section"),
  possible: section(200000).default(""),
  questions: section(200000).default(""),
  evidenceIds: z.array(z.string().min(8).max(36)).min(1).max(30),
});
export function parseRecapResult(input: unknown, refs: Evidence[]) {
  const parsed = recapSchema.safeParse(input);
  if (!parsed.success) {
    const labels: Record<string, string> = {
      expressed: "明确表达",
      possible: "AI 推测",
      questions: "继续追问",
      evidenceIds: "原文引用",
    };
    const fields = [
      ...new Set(
        parsed.error.issues.map((i) => labels[String(i.path[0])] ?? "回顾内容"),
      ),
    ];
    throw new Error(
      `回顾格式校验失败：${fields.join("、")}缺失、类型错误或超过长度限制。结果未保存，可手动重试。`,
    );
  }
  let invalidReferences = 0;
  const evidenceIds = [
    ...new Set(
      parsed.data.evidenceIds.flatMap((id) => {
        const lower = id.toLowerCase();
        const exact = refs.find((r) => r.noteId === lower);
        if (exact) return [exact.noteId];
        const matches = /^[0-9a-f]{8}(?:-[0-9a-f-]+)?$/.test(lower)
          ? refs.filter((r) => r.noteId.startsWith(lower))
          : [];
        if (matches.length !== 1) invalidReferences++;
        return matches.length === 1 ? [matches[0].noteId] : [];
      }),
    ),
  ];
  if (!evidenceIds.length)
    throw new Error(
      "回顾引用不在本次上下文，或缩写不能唯一识别。没有可验证引用，结果未应用，请手动重试",
    );
  const warnings =
    invalidReferences > 0 ? ["部分原文引用无效，已排除；请核对回顾结论"] : [];
  return { ...parsed.data, evidenceIds, warnings };
}

export const recapInstructions =
  '输出一个 JSON 对象，字段必须完整：{"expressed":"用户明确表达的简短文本","possible":"可能变化及不确定性的简短文本，没有则为空字符串","questions":"继续追问的简短文本，没有则为空字符串","evidenceIds":["history 中实际支持结论的完整 id"]}。前三个字段均为字符串，不是数组或对象；expressed 和 possible 各不超过 1200 字，questions 不超过 600 字。evidenceIds 去重且只能引用 history 中的完整 UUID，不得引用线程 id、标题或自行创建编号。history 中 raw 是用户原话，aiReply 是 AI 回答。把对话纳入回顾，但仅将用户明确说过的内容归入 expressed，AI 的说法不等于用户认同。不宣称已覆盖全部历史。';
