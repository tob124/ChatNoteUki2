import { z } from "zod";
const uuid = z.string().uuid();
export const savedQueryInputSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(60),
  workspace: z.union([
    uuid,
    z.enum(["all", "pending", "favorites", "history"]),
  ]),
  query: z.string().max(200),
  searchIn: z.enum(["original", "reply"]).default("original"),
  aiFilter: z.enum(["all", "pending", "failed"]).default("all"),
  includeHistory: z.boolean().default(false),
});
export const savedQuerySchema = savedQueryInputSchema.extend({
  id: uuid,
  createdAt: z.string().datetime(),
});
export type SavedQuery = z.infer<typeof savedQuerySchema>;
export type SavedQueryInput = z.infer<typeof savedQueryInputSchema>;
export const quoteLocatorSchema = z
  .object({
    materialId: uuid,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    segmentId: z.number().int().positive(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    text: z.string().min(1).max(12000),
  })
  .refine(
    (q) => q.end > q.start && q.end - q.start === q.text.length,
    "摘录范围与文字不符",
  );
export type QuoteLocator = z.infer<typeof quoteLocatorSchema>;
export const materialQuoteSchema = quoteLocatorSchema.safeExtend({
  name: z.string().min(1).max(260),
  page: z.number().int().positive().nullable(),
  segmentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type MaterialQuote = z.infer<typeof materialQuoteSchema>;
export const excerptInputSchema = z.object({
  clientId: uuid,
  raw: z.string().trim().min(1).max(50000),
  threadId: uuid.nullable().default(null),
  quote: quoteLocatorSchema,
});
export type ExcerptInput = z.infer<typeof excerptInputSchema>;
export const selectionInputSchema = z
  .object({
    question: z.string().trim().min(3).max(500),
    notes: z
      .array(
        z.object({ noteId: uuid, revision: z.number().int().nonnegative() }),
      )
      .min(1)
      .max(30),
  })
  .refine(
    (v) => new Set(v.notes.map((n) => n.noteId)).size === v.notes.length,
    "请选择不同笔记",
  );
export type SelectionInput = z.infer<typeof selectionInputSchema>;
