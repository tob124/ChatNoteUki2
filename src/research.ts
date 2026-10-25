import { z } from "zod";

export const researchInputSchema = z
  .object({
    noteId: z.string().uuid().nullable().default(null),
    threadId: z.string().uuid().nullable().default(null),
    question: z.string().trim().min(3).max(300),
    queries: z
      .array(
        z
          .string()
          .trim()
          .min(2)
          .refine(
            (value) => [...value].length <= 128,
            "每条搜索词最多128个字符",
          ),
      )
      .min(1)
      .max(2),
  })
  .refine(
    (v) => !!v.noteId || !!v.threadId,
    "请选择笔记或问题作为资料分析对象",
  );
export type ResearchInput = z.infer<typeof researchInputSchema>;
export const sourceSchema = z.object({
  id: z.string().length(24),
  url: z.string().url().max(2000),
  title: z.string().max(500),
  discoveredAt: z.string().datetime(),
  publishedAt: z.string().max(100).optional(),
  snippet: z.string().max(1500).default(""),
  text: z.string().max(12000).default(""),
  status: z.enum(["discovered", "read", "failed", "unsupported"]),
  error: z.string().max(500).nullable().default(null),
  fetchedAt: z.string().datetime().optional(),
  finalUrl: z.string().url().max(2000).optional(),
  coverage: z.string().max(300).default("仅搜索结果，未读取正文"),
});
export type ResearchSource = z.infer<typeof sourceSchema>;
export const researchReportSchema = z.object({
  findings: z
    .array(
      z.object({
        claim: z.string().trim().min(1).max(100000),
        sourceId: z.string().length(24),
        quote: z.string().trim().min(10).max(12000),
        relation: z.enum(["support", "challenge", "context"]),
      }),
    )
    .max(128),
  analysis: z.string().trim().min(1).max(100000),
  limitations: z.array(z.string().max(100000)).min(1).max(128),
  questions: z.array(z.string().max(100000)).max(128),
  warnings: z.array(z.string().max(500)).max(128).default([]),
});
export type ResearchReport = z.infer<typeof researchReportSchema>;
export const researchCheckpointSchema = z.object({
  completedQueries: z.array(z.string().max(180)).max(2),
  sources: z.array(sourceSchema).max(16),
  searches: z.number().int().nonnegative(),
  readAttempts: z.number().int().min(0).max(4),
  stage: z.enum(["queued", "search", "read", "analyze", "done"]),
});
export type ResearchCheckpoint = z.infer<typeof researchCheckpointSchema>;
export const researchSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  noteId: z.string().uuid().nullable(),
  threadId: z.string().uuid().nullable(),
  question: z.string().max(300),
  queries: z.array(z.string().max(180)).max(2),
  createdAt: z.string().datetime(),
  evidence: z
    .array(
      z.object({
        noteId: z.string().uuid(),
        revision: z.number().int().nonnegative(),
      }),
    )
    .max(30),
  baseVersion: z.number().int().nonnegative(),
  sources: z.array(sourceSchema).max(16),
  report: researchReportSchema,
  searches: z.number().int().nonnegative(),
});
export type Research = z.infer<typeof researchSchema>;
export function validateResearchReport(
  value: unknown,
  sources: ResearchSource[],
  allowPartial = false,
) {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const list = (item: unknown) =>
    typeof item === "string" ? (item.trim() ? [item] : []) : item;
  const warnings: string[] = Array.isArray(input.warnings)
    ? input.warnings
        .filter((v): v is string => typeof v === "string" && v.length <= 500)
        .slice(0, 128)
    : [];
  const findings =
    allowPartial && Array.isArray(input.findings)
      ? input.findings.flatMap((value, index) => {
          const item =
            researchReportSchema.shape.findings.element.safeParse(value);
          if (!item.success) {
            warnings.push(`第 ${index + 1} 项资料依据格式不完整，未采用。`);
            return [];
          }
          const source = sources.find((s) => s.id === item.data.sourceId);
          if (
            !source ||
            source.status !== "read" ||
            !source.text.includes(item.data.quote)
          ) {
            warnings.push(
              `第 ${index + 1} 项引用未读来源或不存在的原文片段，未采用。`,
            );
            return [];
          }
          return [item.data];
        })
      : input.findings;
  const parsed = researchReportSchema.safeParse({
    ...input,
    findings,
    warnings: [...new Set(warnings)].slice(0, 128),
    analysis:
      Array.isArray(input.analysis) &&
      input.analysis.every((v) => typeof v === "string")
        ? input.analysis.join("\n")
        : input.analysis,
    limitations: list(input.limitations),
    questions: list(input.questions ?? []),
  });
  if (!parsed.success) {
    const names: Record<string, string> = {
      findings: "资料依据",
      analysis: "AI 联系",
      limitations: "局限",
      questions: "继续追问",
    };
    const fields = [
      ...new Set(
        parsed.error.issues.map(
          (issue) => names[String(issue.path[0])] ?? "返回字段",
        ),
      ),
    ];
    throw new Error(
      `资料分析的${fields.join("、")}格式不完整，已读来源已保留，请手动重试。`,
    );
  }
  const report = parsed.data;
  for (const finding of report.findings) {
    const source = sources.find((s) => s.id === finding.sourceId);
    if (
      !source ||
      source.status !== "read" ||
      !source.text.includes(finding.quote)
    )
      throw new Error(
        "资料分析引用未读来源或不存在的原文片段，未采用结果。请手动重试。",
      );
  }
  return report;
}
