/** Internal references are translated only in derived prose; raw inputs stay intact. */
export function humanizeText(
  text: string,
  label: (id: string) => string | null,
): string {
  return text.replace(
    /\b([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)\b(?:[（(]([^）)\n]{1,120})[）)])?/gi,
    (match, id: string, annotation: string | undefined) => {
      const title = label(id.toLowerCase());
      if (!title) return match;
      return (
        `「${title}」` +
        (annotation && annotation !== title ? `（${annotation}）` : "")
      );
    },
  );
}
const prose = new Set([
  "title",
  "description",
  "newThreadTitle",
  "threadDescription",
  "synopsis",
  "reply",
  "reason",
  "viewpoint",
  "reasons",
  "uncertainties",
  "questions",
  "decisions",
  "expressed",
  "possible",
]);
export function humanizeGenerated<T>(
  value: T,
  display: (text: string) => string,
): T {
  const visit = (v: any, text = false): any => {
    if (typeof v === "string") return text ? display(v) : v;
    if (Array.isArray(v)) return v.map((item) => visit(item, text));
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v).map(([key, item]) => [
        key,
        visit(
          item,
          prose.has(key) &&
            !(
              key === "title" &&
              (v.titleLocked || (v.mode && v.status !== "done"))
            ),
        ),
      ]),
    );
  };
  return visit(value);
}
