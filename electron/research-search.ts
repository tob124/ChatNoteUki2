import { createHash } from "node:crypto";
import type { ResearchSource } from "../src/research";
import { publicUrl } from "./public-source";
export interface SearchResult {
  sources: ResearchSource[];
  input: number;
  output: number;
  searches: number;
}
export interface ResearchSearch {
  search(
    key: string,
    query: string,
    onResponse: (usage: Omit<SearchResult, "sources">) => void,
    signal?: AbortSignal,
  ): Promise<SearchResult>;
}
export function parseSearchResponse(data: any): SearchResult {
  if (Array.isArray(data?.results)) {
    const sources = new Map<string, ResearchSource>();
    for (const item of [...data.results].sort(
      (a, b) =>
        (b?.authority ?? -1) - (a?.authority ?? -1) ||
        (b?.rerank_score ?? 0) - (a?.rerank_score ?? 0),
    )) {
      if (!item || typeof item.url !== "string") continue;
      try {
        const url = publicUrl(item.url).href;
        if (url.length > 2000) continue;
        sources.set(url, {
          id: createHash("sha256").update(url).digest("hex").slice(0, 24),
          url,
          title:
            typeof item.title === "string"
              ? item.title.slice(0, 500)
              : "未提供标题",
          discoveredAt: new Date().toISOString(),
          snippet:
            typeof item.snippet === "string" ? item.snippet.slice(0, 1500) : "",
          ...(typeof item.date === "string"
            ? { publishedAt: item.date.slice(0, 100) }
            : {}),
          text: "",
          status: "discovered",
          error: null,
          coverage: "仅搜索结果，未读取正文",
        });
      } catch {
        /* Unsafe destinations cannot become sources. */
      }
    }
    // Standalone Search is billed per request; no model token usage is produced.
    return {
      sources: [...sources.values()].slice(0, 8),
      input: 0,
      output: 0,
      searches: 1,
    };
  }
  // Existing persisted/test responses remain readable after upgrading.

  const input = data.usage?.input_tokens,
    output = data.usage?.output_tokens;
  if (
    !Number.isInteger(input) ||
    input < 0 ||
    !Number.isInteger(output) ||
    output < 0
  )
    throw new Error("检索未返回有效用量，计费待核对");
  const searches = data.usage?.server_tool_use?.web_search_requests;
  const blocks = Array.isArray(data.content) ? data.content : [];
  const citations = new Map<string, string>();
  for (const block of blocks)
    for (const cite of Array.isArray(block.citations) ? block.citations : []) {
      if (typeof cite.url === "string" && typeof cite.cited_text === "string")
        citations.set(cite.url, cite.cited_text.slice(0, 1500));
    }
  const sources = new Map<string, ResearchSource>();
  let structured = false;
  for (const block of blocks) {
    if (block.type !== "web_search_tool_result") continue;
    structured = true;
    if (!Array.isArray(block.content)) continue;
    for (const item of block.content) {
      if (item.type !== "web_search_result" || typeof item.url !== "string")
        continue;
      try {
        const url = publicUrl(item.url).href;
        if (url.length > 2000) continue;
        sources.set(url, {
          id: createHash("sha256").update(url).digest("hex").slice(0, 24),
          url,
          title: String(item.title ?? "未提供标题").slice(0, 500),
          discoveredAt: new Date().toISOString(),
          snippet: citations.get(item.url) ?? "",
          ...(typeof item.page_age === "string"
            ? { publishedAt: item.page_age.slice(0, 100) }
            : {}),
          text: "",
          status: "discovered",
          error: null,
          coverage: "仅搜索结果，未读取正文",
        });
      } catch {
        /* Unsafe destinations cannot become clickable sources. */
      }
    }
  }
  if (!structured)
    throw new Error("未返回结构化搜索来源，未把 AI 编写的链接当作证据");
  return {
    sources: [...sources.values()].slice(0, 8),
    input,
    output,
    searches: Number.isInteger(searches) && searches >= 0 ? searches : 0,
  };
}
export class DeepSeekSearch implements ResearchSearch {
  constructor(
    private send: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  async search(
    key: string,
    query: string,
    onResponse: (usage: Omit<SearchResult, "sources">) => void,
    signal?: AbortSignal,
  ) {
    const response = await this.send(
      "https://api.deepseek.com/v1/tools/search",
      {
        method: "POST",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
          : AbortSignal.timeout(90_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          query: checkedQuery(query),
          count: 8,
          need_content: false,
        }),
      },
    );
    if (!response.ok) {
      const error = new Error(
        `DeepSeek 联网检索失败（HTTP ${response.status}），请检查配置后手动重试`,
      );
      if ([400, 401, 402, 403, 422, 429].includes(response.status))
        Object.assign(error, { notBilled: true });
      throw error;
    }
    const data = (await response.json()) as any;
    if (Array.isArray(data.results))
      onResponse({ input: 0, output: 0, searches: 1 });
    else if (
      Number.isInteger(data.usage?.input_tokens) &&
      Number.isInteger(data.usage?.output_tokens)
    )
      onResponse({
        input: data.usage.input_tokens,
        output: data.usage.output_tokens,
        searches: data.usage?.server_tool_use?.web_search_requests ?? 0,
      });
    return parseSearchResponse(data);
  }
}

function checkedQuery(query: string): string {
  const value = query.trim();
  if (!value || [...value].length > 128)
    throw new Error("搜索词需为 1–128 个字符，请缩短后重试");
  return value;
}
// Official Fetch returns page Markdown; summaries never become read evidence.
export async function readDeepSeekPage(
  key: string,
  input: string,
  signal?: AbortSignal,
): Promise<import("./public-source").PageRead> {
  const url = publicUrl(input).href;
  const response = await fetch("https://api.deepseek.com/v1/tools/fetch", {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000),
    body: JSON.stringify({ url }),
  });
  if (!response.ok)
    throw new Error(
      `DeepSeek 正文读取失败（HTTP ${response.status}），可打开原网页阅读`,
    );
  const data = (await response.json()) as {
    title?: unknown;
    content?: unknown;
  };
  if (typeof data.content !== "string" || data.content.trim().length < 40)
    throw new Error("未取得足够的页面正文");
  return {
    title: typeof data.title === "string" ? data.title : "",
    text: data.content.slice(0, 12000),
    finalUrl: url,
    coverage: `DeepSeek Fetch 公开页面正文${data.content.length > 12000 ? "，选取前 12,000 字符" : ""}；不宣称论文全文，按选读片段核查`,
  };
}
