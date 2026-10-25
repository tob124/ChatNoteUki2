import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  extractPage,
  isPublicAddress,
  publicUrl,
  resolvePublic,
} from "../../electron/public-source";
import {
  DeepSeekSearch,
  readDeepSeekPage,
  parseSearchResponse,
} from "../../electron/research-search";
import {
  validateResearchReport,
  researchInputSchema,
} from "../../src/research";

const result = () => ({
  content: [
    {
      type: "text",
      text: "模型自行提及的链接不能作为来源 https://invented.example.com",
      citations: [
        {
          url: "https://www.example.com/paper",
          cited_text: "发现摘要，不是已读正文",
        },
      ],
    },
    {
      type: "web_search_tool_result",
      content: [
        {
          type: "web_search_result",
          url: "https://www.example.com/paper",
          title: "公开研究",
          page_age: "2025-01-01",
        },
        {
          type: "web_search_result",
          url: "https://www.example.com/paper#section",
          title: "公开研究",
        },
        {
          type: "web_search_result",
          url: "http://127.0.0.1/admin",
          title: "危险地址",
        },
      ],
    },
  ],
  usage: {
    input_tokens: 20,
    output_tokens: 30,
    server_tool_use: { web_search_requests: 3 },
  },
});
describe("public-source address and extraction boundaries", () => {
  it.each([
    "file:///C:/data",
    "http://localhost",
    "http://127.1/a",
    "https://user:secret@example.com",
    "https://example.com:8080",
    "http://169.254.169.254/",
    "http://10.0.0.1",
    "http://[::1]",
    "http://internal.lan",
  ])("rejects %s", (value) => {
    expect(() => publicUrl(value)).toThrow();
  });
  it("normalizes safe URLs and rejects reserved addresses", () => {
    expect(publicUrl("https://www.example.com/a#b").href).toBe(
      "https://www.example.com/a",
    );
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    for (const ip of [
      "192.168.1.1",
      "198.18.2.3",
      "192.0.2.1",
      "100.64.0.2",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ])
      expect(isPublicAddress(ip)).toBe(false);
  });
  it("pins only verified DNS results and refuses mixed public/private answers", async () => {
    const doh = vi.fn();
    expect(
      await resolvePublic(
        "example.com",
        new AbortController().signal,
        async () => ["1.1.1.1"],
        doh,
      ),
    ).toEqual(["1.1.1.1"]);
    expect(doh).not.toHaveBeenCalled();
    await expect(
      resolvePublic(
        "example.com",
        new AbortController().signal,
        async () => ["1.1.1.1", "10.0.0.1"],
        doh,
      ),
    ).rejects.toThrow("非公网");
    expect(doh).not.toHaveBeenCalled();
  });
  it("revalidates TUN DNS substitutes and refuses private replacement answers", async () => {
    const doh = vi.fn(
      async (_url: string | URL | Request) =>
        new Response(
          JSON.stringify({ Answer: [{ type: 1, data: "1.1.1.1" }] }),
        ),
    );
    expect(
      await resolvePublic(
        "example.com",
        new AbortController().signal,
        async () => ["198.18.0.1"],
        doh,
      ),
    ).toEqual(["1.1.1.1"]);
    expect(String(doh.mock.calls[0][0])).not.toContain("private note");
    const unsafe = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ Answer: [{ type: 1, data: "127.0.0.1" }] }),
        ),
    );
    await expect(
      resolvePublic(
        "example.com",
        new AbortController().signal,
        async () => ["198.18.0.1"],
        unsafe,
      ),
    ).rejects.toThrow("非公网");
  });
  it("cancels pending DNS without reaching the page", async () => {
    const controller = new AbortController();
    const pending = resolvePublic(
      "example.com",
      controller.signal,
      () => new Promise(() => {}),
    );
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
  });
  it("extracts article text, decodes entities, removes navigation and scripts and marks truncation", () => {
    const page = extractPage(
      Buffer.from(
        `<html><title>研究标题</title><body><nav>导航文字</nav><article><h1>原标题</h1><p>${"有证据的中文内容 &amp; 条件。".repeat(1000)}</p></article><script>never execute</script></body></html>`,
      ),
    );
    expect(page.title).toBe("研究标题");
    expect(page.text).toContain("& 条件");
    expect(page.text).not.toContain("导航文字");
    expect(page.text).not.toContain("never execute");
    expect(page.text.length).toBe(12000);
    expect(page.truncated).toBe(true);
    expect(() =>
      extractPage(Buffer.from("<html><body>login</body></html>")),
    ).toThrow("正文");
  });
});
describe("structured research search and verifiable excerpts", () => {
  it("accepts only structured discovered URLs, keeps actual search counts and never labels a snippet as read", () => {
    const parsed = parseSearchResponse(result());
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0].status).toBe("discovered");
    expect(parsed.sources[0].text).toBe("");
    expect(parsed.sources[0].id).toBe(
      createHash("sha256")
        .update("https://www.example.com/paper")
        .digest("hex")
        .slice(0, 24),
    );
    expect(parsed.searches).toBe(3);
    expect(() =>
      parseSearchResponse({
        ...result(),
        content: [{ type: "text", text: "https://madeup.com" }],
      }),
    ).toThrow("结构化");
  });
  it("records paid usage even when returned content is unusable", async () => {
    const usage = vi.fn();
    const provider = new DeepSeekSearch(
      vi.fn(
        async () => new Response(JSON.stringify({ ...result(), content: [] })),
      ),
    );
    await expect(
      provider.search("test-key", "公开研究", usage),
    ).rejects.toThrow("结构化");
    expect(usage).toHaveBeenCalledExactlyOnceWith({
      input: 20,
      output: 30,
      searches: 3,
    });
  });
  it("limits the client request and sends only the confirmed query", async () => {
    const send = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify(result())),
    );
    await new DeepSeekSearch(send).search("test-key", "城市通勤研究", () => {});
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(send.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/v1/tools/search",
    );
    expect(body).toEqual({
      query: "城市通勤研究",
      count: 8,
      need_content: false,
    });
  });
  it("fails missing usage and marks explicit authorization refusal as not billed", async () => {
    expect(() => parseSearchResponse({ ...result(), usage: {} })).toThrow(
      "用量",
    );
    const usage = vi.fn();
    const refused = new DeepSeekSearch(
      vi.fn(async () => new Response("", { status: 401 })),
    );
    await expect(
      refused.search("test-key", "研究", usage),
    ).rejects.toMatchObject({ notBilled: true });
    expect(usage).not.toHaveBeenCalled();
  });
  it("validates quotes against read text, rejecting unknown IDs, invented quotes and discovery snippets", () => {
    const source = {
      ...parseSearchResponse(result()).sources[0],
      status: "read" as const,
      text: "研究发现，在特定环境下通勤时间与满意度具有相关性，不代表因果关系。",
    };
    const report = {
      findings: [
        {
          sourceId: source.id,
          quote: "通勤时间与满意度具有相关性",
          claim: "研究发现相关性",
          relation: "context",
        },
      ],
      analysis: "需要留意研究范围",
      limitations: ["相关不代表因果"],
      questions: [],
    };
    expect(validateResearchReport(report, [source]).findings).toHaveLength(1);
    expect(() =>
      validateResearchReport(report, [{ ...source, status: "discovered" }]),
    ).toThrow("未读");
    expect(() =>
      validateResearchReport(
        {
          ...report,
          findings: [
            { ...report.findings[0], quote: "这段内容完全由模型凭空编造" },
          ],
        },
        [source],
      ),
    ).toThrow("不存在");
    expect(() =>
      validateResearchReport(
        {
          ...report,
          findings: [{ ...report.findings[0], sourceId: "b".repeat(24) }],
        },
        [source],
      ),
    ).toThrow("未读");
  });
  it("requires a selected thought and confirmed query bounds", () => {
    expect(() =>
      researchInputSchema.parse({ question: "查找资料", queries: ["query"] }),
    ).toThrow();
    const input = {
      noteId: "12345678-0000-4000-8000-000000000000",
      question: "问题是什么",
      queries: ["公开关键词"],
    };
    expect(researchInputSchema.parse(input).threadId).toBe(null);
    expect(() =>
      researchInputSchema.parse({ ...input, queries: ["a", "b", "c"] }),
    ).toThrow();
  });
  it("normalizes valid report lists without weakening evidence validation", () => {
    expect(
      validateResearchReport(
        {
          findings: [],
          analysis: ["第一项联系", "第二项联系"],
          limitations: "仅部分来源",
        },
        [],
      ),
    ).toMatchObject({
      analysis: "第一项联系\n第二项联系",
      limitations: ["仅部分来源"],
      questions: [],
    });
    expect(() =>
      validateResearchReport(
        { findings: [], analysis: 42, limitations: [] },
        [],
      ),
    ).toThrow("AI 联系、局限格式不完整");
  });
});

it("accepts official Search results without model usage and counts one standalone request", () => {
  const parsed = parseSearchResponse({
    results: [
      {
        url: "https://example.com/source",
        title: "官方资料",
        snippet: "搜索摘要",
        summary: "模型摘要",
        content: "这也不应直接变成核查证据",
        authority: 4,
      },
    ],
  });
  expect(parsed).toMatchObject({ input: 0, output: 0, searches: 1 });
  expect(parsed.sources[0]).toMatchObject({
    status: "discovered",
    text: "",
    snippet: "搜索摘要",
  });
  expect(parseSearchResponse({ results: [] }).sources).toEqual([]);
});

it("uses official Fetch content and preserves an explicit coverage bound", async () => {
  const send = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ title: "公开正文", content: "逐字证据".repeat(5000) }),
      ),
  );
  vi.stubGlobal("fetch", send);
  try {
    const page = await readDeepSeekPage(
      "fixture",
      "https://example.org/article",
    );
    expect(send.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/v1/tools/fetch",
    );
    expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toEqual({
      url: "https://example.org/article",
    });
    expect(page.text.length).toBe(12000);
    expect(page.coverage).toContain("12,000");
    await expect(
      readDeepSeekPage("fixture", "http://127.0.0.1/"),
    ).rejects.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("rejects oversized queries before dispatch and prioritizes authority only as a discovery hint", async () => {
  const send = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
  await expect(
    new DeepSeekSearch(send).search("fixture", "字".repeat(129), () => {}),
  ).rejects.toThrow("128");
  expect(send).not.toHaveBeenCalled();
  const parsed = parseSearchResponse({
    results: [
      { url: "https://example.org/a", authority: 1 },
      { url: "https://example.org/b", authority: 4 },
    ],
  });
  expect(parsed.sources[0].url).toContain("/b");
  expect(
    parsed.sources.every((s) => s.status === "discovered" && !s.text),
  ).toBe(true);
});
