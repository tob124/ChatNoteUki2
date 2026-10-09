const text = { type: "string" },
  nullable = { type: ["string", "null"] };
const strings = { type: "array", items: text };
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const evidence = object({ noteId: text, revision: { type: "integer" } });
export function outputSchema(prompt: string): Record<string, unknown> {
  if (prompt.includes("material-summary"))
    return object({
      summary: text,
      evidenceSegmentIds: { type: "array", items: { type: "integer" } },
    });
  if (prompt.includes('"suggestions"'))
    return object({
      suggestions: {
        type: "array",
        items: object({
          kind: {
            type: "string",
            enum: ["create", "assign", "merge", "reparent"],
          },
          title: text,
          description: text,
          parentId: nullable,
          targetId: nullable,
          sourceIds: strings,
          noteIds: strings,
          reason: text,
          evidence: { type: "array", items: evidence },
        }),
      },
    });
  if (prompt.includes('"expressed"'))
    return object({
      expressed: text,
      possible: text,
      questions: text,
      evidenceIds: strings,
    });
  if (prompt.includes("输出 after"))
    return object({
      after: object({
        viewpoint: text,
        reasons: strings,
        uncertainties: strings,
        questions: strings,
        decisions: strings,
      }),
      reason: text,
      evidenceIds: strings,
    });
  if (prompt.includes('"findings"'))
    return object({
      findings: {
        type: "array",
        items: object({
          claim: text,
          sourceId: text,
          quote: text,
          relation: {
            type: "string",
            enum: ["support", "challenge", "context"],
          },
        }),
      },
      analysis: text,
      limitations: strings,
      questions: strings,
    });
  if (prompt.includes('"body"')) return object({ body: text });
  return object({
    threadId: nullable,
    newThreadTitle: nullable,
    newParentId: nullable,
    threadDescription: text,
    title: text,
    synopsis: text,
    reply: text,
  });
}
