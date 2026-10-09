import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const segmentSchema = z.object({
  id: z.number().int().positive(),
  page: z.number().int().positive().nullable(),
  paragraph: z.number().int().positive(),
  text: z.string().max(200000),
});
export const materialSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(260),
    format: z.enum(["pdf", "docx", "txt", "md"]),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(25 * 1024 * 1024),
    sha256: hash,
    chunks: z
      .array(
        z.object({
          sha256: hash,
          bytes: z
            .number()
            .int()
            .positive()
            .max(4 * 1024 * 1024),
        }),
      )
      .min(1)
      .max(7),
    noteId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    deletedAt: z.string().datetime().nullable().default(null),
    purged: z.boolean().default(false),
    status: z.enum([
      "extracting",
      "pending",
      "running",
      "done",
      "partial",
      "failed",
      "cancelled",
    ]),
    error: z.string().max(1000).nullable(),
    coverage: z.string().max(2000),
    segments: z.array(segmentSchema).max(10000),
    summary: z.string().max(200000),
    summaries: z
      .array(
        z.object({
          from: z.number().int().positive(),
          to: z.number().int().positive(),
          inputHash: hash,
          text: z.string().max(200000),
          evidenceSegmentIds: z.array(z.number().int().positive()).default([]),
        }),
      )
      .max(10000),
    synthesis: z
      .array(
        z.object({
          from: z.number().int().positive(),
          to: z.number().int().positive(),
          text: z.string().max(200000),
          evidenceSegmentIds: z.array(z.number().int().positive()),
        }),
      )
      .max(10000)
      .default([]),
    synthesisSteps: z.number().int().nonnegative().default(0),
    taskId: z.string().uuid().nullable().default(null),
  })
  .refine(
    (m) => m.chunks.reduce((sum, c) => sum + c.bytes, 0) === m.bytes,
    "文件分块长度不符",
  )
  .refine(
    (m) => m.segments.reduce((sum, s) => sum + s.text.length, 0) <= 1000000,
    "资料提取文本超出保存范围",
  );
export type Material = z.infer<typeof materialSchema>;
export type MaterialSegment = z.infer<typeof segmentSchema>;
export type MaterialSummary = Omit<
  Material,
  "segments" | "summaries" | "synthesis"
> & { segments?: never; summaries?: never; originalAvailable: boolean };
