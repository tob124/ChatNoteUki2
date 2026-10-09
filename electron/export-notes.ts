import type { Note } from "../src/shared";
import { Store } from "./store";
export function* exportNotes(store: Store, notes: Note[]): Generator<string> {
  for (const n of notes) {
    yield `# ${n.title.replace(/[\r\n]+/g, " ")}\n\n${n.createdAt}\n\n## 用户原文 · v${n.revision ?? 0}\n\n${n.currentRaw ?? n.raw}\n\n`;
    if (n.materialQuote && !n.deletedAt) {
      const source = store.quoteSource(n.id);
      yield `## 参考摘录（非用户原话）\n\n${source.quote.text}\n\n来源：${source.quote.name} · ${source.quote.page ? "PDF 第 " + source.quote.page + " 页 · " : ""}段落 ${source.quote.segmentId}${source.material && !source.current ? "（提取内容已变化，请核对旧摘录）" : !source.material ? "（资料已删除）" : ""}\n\n`;
    }
    if (n.synopsis && n.synopsis !== "待生成")
      yield `## AI 摘要\n\n${n.synopsis}\n\n`;
    if (n.reply) yield `## AI 回应\n\n${n.reply}\n\n`;
    for (const d of store.discussions(n.id, 10000)) {
      yield `### 用户追问 · 起始正文 v${d.parentRevision ?? 0}\n\n${d.currentRaw ?? d.raw}\n\n`;
      if (d.reply) yield `### AI 回应\n\n${d.reply}\n\n`;
      for (const id of d.materialIds ?? []) {
        const m = store.material(id);
        yield `参考资料：${m.deletedAt ? "资料已删除" : m.name}（${m.coverage}）\n\n`;
      }
    }
    let before: number | undefined;
    do {
      const page = store.materialPage(undefined, before, false, n.id);
      for (const item of page.items) {
        const m = store.material(item.id);
        yield `## 关联参考资料：${m.name}\n\n${m.coverage}\n\n`;
        if (m.summary) yield `### AI 资料摘要\n\n${m.summary}\n\n`;
        for (const id of new Set(
          m.synthesis.at(-1)?.evidenceSegmentIds ??
            m.summaries.flatMap((s) => s.evidenceSegmentIds),
        )) {
          const segment = m.segments.find((s) => s.id === id);
          if (segment)
            yield `引用：${segment.page ? "PDF 第 " + segment.page + " 页 · " : ""}段落 ${segment.id}\n\n${segment.text}\n\n`;
        }
      }
      before = page.before ?? undefined;
    } while (before);
    for (const research of store.relatedResearches(n.id)) {
      yield `## 外部资料分析（AI）\n\n${research.report.analysis}\n\n`;
      for (const finding of research.report.findings) {
        const source = research.sources.find((s) => s.id === finding.sourceId);
        yield `参考结论：${finding.claim}\n\n引用：${finding.quote}\n\n来源：${source?.title ?? "来源未保存"}\n${source?.url ?? ""}\n\n`;
      }
    }
    yield "---\n\n";
  }
}
