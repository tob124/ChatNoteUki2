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
      "https://api.deepseek.com/anthropic/v1/messages",
      {
        method: "POST",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
          : AbortSignal.timeout(90_000),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          Authorization: `Bearer ${key}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          max_tokens: 1800,
          messages: [
            {
              role: "user",
              content: `Perform one focused web search for this query. Prefer relevant original research, official institutions, authors or publishers. Return structured search results, do not answer the question or search additional topics. Query: ${query.slice(0, 180)}`,
            },
          ],
          tools: [
            { type: "web_search_20250305", name: "web_search", max_uses: 1 },
          ],
        }),
      },
    );
    if (!response.ok) {
      const error = new Error(
        `DeepSeek 联网检索失败（HTTP ${response.status}），请检查配置后手动重试`,
      );
      if ([401, 402, 429].includes(response.status))
        Object.assign(error, { notBilled: true });
      throw error;
    }
    const data = (await response.json()) as any;
    if (
      Number.isInteger(data.usage?.input_tokens) &&
      data.usage.input_tokens >= 0 &&
      Number.isInteger(data.usage?.output_tokens) &&
      data.usage.output_tokens >= 0
    ) {
      onResponse({
        input: data.usage.input_tokens,
        output: data.usage.output_tokens,
        searches: Number.isInteger(
          data.usage?.server_tool_use?.web_search_requests,
        )
          ? Math.max(0, data.usage.server_tool_use.web_search_requests)
          : 0,
      });
    }
    return parseSearchResponse(data);
  }
}
