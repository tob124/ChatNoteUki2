import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
test("research: confirmed public query, stage feedback, evidence reading, reflection and restart", async () => {
  const folder = resolve(".local", `research-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const launch = () =>
    electron.launch({
      executablePath: process.env.UKI_TEST_EXE,
      args: process.env.UKI_TEST_EXE ? [] : ["."],
      cwd: process.cwd(),
      env: { ...process.env, UKI_DATA_DIR: folder },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1200, height: 860 }),
    );
    page.on("pageerror", (error) =>
      console.log("Research renderer error:", error.message),
    );
    await page.getByRole("heading", { name: "想法，从这里开始" }).waitFor();
    await app.evaluate(() => {
      const runtime = globalThis as any;
      runtime.publicQueries = [];
      runtime.researchPending = [];
      runtime.discussionContexts = [];
      const events = process.getBuiltinModule("node:events");
      const dns = process.getBuiltinModule("node:dns/promises");
      const https = process.getBuiltinModule("node:https");
      dns.lookup = (async () => [{ address: "1.1.1.1", family: 4 }]) as any;
      https.request = ((
        _url: unknown,
        _options: unknown,
        callback: (res: any) => void,
      ) => {
        const req = new events.EventEmitter() as any;
        req.setTimeout = () => req;
        req.destroy = (error: Error) => {
          req.emit("error", error);
          return req;
        };
        req.end = () =>
          setImmediate(() => {
            const response = new events.EventEmitter() as any;
            response.statusCode = runtime.rejectPages ? 403 : 200;
            response.headers = { "content-type": "text/html; charset=utf-8" };
            response.resume = () => {};
            callback(response);
            response.emit(
              "data",
              Buffer.from(
                "<html><title>公开通勤研究</title><article><p>观察研究发现，通勤时间与满意度存在相关关系。研究对象和方法限制了结论，这不是因果证明。</p></article></html>",
              ),
            );
            response.emit("end");
          });
        return req;
      }) as any;
      globalThis.fetch = async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(url).includes("/anthropic/")) {
          runtime.publicQueries.push(body.messages[0].content);
          if (runtime.rejectPages)
            return new Response(
              JSON.stringify({
                content: [
                  {
                    type: "web_search_tool_result",
                    content: [
                      {
                        type: "web_search_result",
                        url: "https://example.com/unread",
                        title: "暂时无法读取的资料",
                      },
                    ],
                  },
                ],
                usage: {
                  input_tokens: 20,
                  output_tokens: 10,
                  server_tool_use: { web_search_requests: 1 },
                },
              }),
            );
          return await new Promise<Response>((resolve) =>
            runtime.researchPending.push(resolve),
          );
        }
        const context = JSON.parse(body.messages[1].content);
        if (context.externalResearch) runtime.discussionContexts.push(context);
        const content = context.sources
          ? {
              findings: [
                {
                  sourceId: context.sources[0].id,
                  quote: "通勤时间与满意度存在相关关系",
                  claim: "研究观察到相关关系",
                  relation: "context",
                },
              ],
              analysis: "这为你的想法提供了比较视角，但研究不足以确认因果。",
              limitations: ["观察研究不能确认因果"],
              questions: ["哪些通勤条件值得比较？"],
            }
          : {
              threadId: null,
              newThreadTitle: null,
              title: "通勤与幸福感",
              synopsis: "",
              reply: "可以先比较不同条件。",
            };
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(content) } }],
            usage: { prompt_tokens: 40, completion_tokens: 30 },
          }),
        );
      };
    });
    await page.evaluate(async () => {
      const view = await window.uki.bootstrap();
      await window.uki.saveSettings(view.settings, "test-key");
      await window.uki.capture({
        raw: "我想知道通勤时间是否影响幸福感。PRIVATE_MARKER",
      });
    });
    const card = page.locator(".record").first();
    await expect(
      card.getByRole("heading", { name: "通勤与幸福感" }),
    ).toBeVisible();
    await card.locator(".record-open").click();
    await card.getByRole("button", { name: "查找资料", exact: true }).click();
    await card.getByLabel("资料分析问题").fill("通勤和满意度有什么关系");
    await card.getByLabel("公开搜索词").fill("通勤 满意度 观察研究");
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).publicQueries.length))
      .toBe(0);
    await card.getByRole("button", { name: "确认搜索并分析" }).click();
    await expect(card.getByText("正在检索公开资料…")).toBeVisible();
    const queries = await app.evaluate(() => (globalThis as any).publicQueries);
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain("PRIVATE_MARKER");
    await app.evaluate(() => {
      const send = (globalThis as any).researchPending.shift();
      send(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "web_search_tool_result",
                content: [
                  {
                    type: "web_search_result",
                    url: "https://example.com/study",
                    title: "公开通勤研究",
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 20,
              output_tokens: 10,
              server_tool_use: { web_search_requests: 1 },
            },
          }),
        ),
      );
    });
    await expect(card.getByText("资料分析完成")).toBeVisible();
    await card.getByRole("button", { name: "查看资料分析" }).click();
    await expect(
      page
        .locator(".research-card")
        .getByRole("heading", { name: "通勤和满意度有什么关系" }),
    ).toBeVisible();
    await expect(page.locator(".research-card blockquote")).toHaveText(
      "通勤时间与满意度存在相关关系",
    );
    try {
      await page
        .getByRole("button", { name: "核对来源：公开通勤研究" })
        .click({ timeout: 5000 });
    } catch (error) {
      console.log(
        "Research failure screen:",
        await page.locator("body").innerText(),
      );
      await page.screenshot({ path: resolve(folder, "research-failure.png") });
      throw error;
    }
    await expect(page.getByRole("heading", { name: "来源核对" })).toBeVisible();
    await expect(page.locator(".reference-raw")).toContainText(
      "这不是因果证明",
    );
    await page.getByRole("button", { name: "最大化资料" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "返回概览", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "来源核对" }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "记录我的判断" }).click();
    await page
      .getByLabel("资料后的我的判断")
      .fill("我认可需要区分相关与因果，继续观察自己的通勤体验。");
    await page.getByRole("button", { name: "保存新笔记", exact: true }).click();
    await expect(page.getByText("你的判断已保存为新笔记。")).toBeVisible();
    await page.getByRole("button", { name: "参考资料继续讨论" }).click();
    await page
      .getByLabel("回复这条笔记中的 AI")
      .fill("这份资料对我的通勤体验有哪些适用限制？");
    await expect(
      page.getByRole("complementary", { name: "备查资料" }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "发送回复", exact: true }).click();
    await expect(
      page.locator(".research-card .discussion .ai-reply"),
    ).toBeVisible();
    const discussionContexts = await app.evaluate(
      () => (globalThis as any).discussionContexts,
    );
    expect(discussionContexts).toHaveLength(1);
    expect(JSON.stringify(discussionContexts[0].externalResearch)).toContain(
      "通勤时间与满意度存在相关关系",
    );
    await page.getByRole("button", { name: "记录我的判断" }).click();
    await page
      .getByLabel("资料后的我的判断")
      .fill("还没有发出的资料判断草稿。");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const snapshot = await window.uki.bootstrap();
          const task = snapshot.tasks.find((t) => t.kind === "research");
          return (
            await window.uki.workspaceState(
              `research-reflection:${task?.resultId}`,
            )
          ).draft;
        }),
      )
      .toBe("还没有发出的资料判断草稿。");
    await page.screenshot({ path: resolve(folder, "research-workspace.png") });
    await app.evaluate(() => {
      (globalThis as any).rejectPages = true;
    });
    await page.getByRole("button", { name: /^全部记录/ }).click();
    const origin = page
      .locator(".record")
      .filter({ hasText: "PRIVATE_MARKER" });
    if (
      (await origin.locator(".record-open").getAttribute("aria-expanded")) !==
      "true"
    )
      await origin.locator(".record-open").click();
    await origin.getByRole("button", { name: "查找资料", exact: true }).click();
    await origin.getByLabel("资料分析问题").fill("资料无法打开时该怎么办");
    await origin.getByLabel("公开搜索词").fill("另一个公开查询");
    await origin.getByRole("button", { name: "确认搜索并分析" }).click();
    await expect(origin.getByText("资料分析未完成")).toBeVisible();
    await origin.getByText("查看已找到的来源", { exact: true }).click();
    await origin
      .getByRole("button", { name: "暂时无法读取的资料", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "来源核对" })).toBeVisible();
    await expect(page.locator(".resource-scroll .error-text")).toContainText(
      "HTTP 403",
    );
    await expect(
      page.getByRole("button", { name: "打开原网页", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: resolve(folder, "unread-source.png") });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "外部资料", exact: true }).click();
    await expect(page.locator(".research-card")).toHaveCount(1);
    await expect(page.getByLabel("资料后的我的判断")).toHaveValue(
      "还没有发出的资料判断草稿。",
    );
    await page.getByRole("button", { name: "参考资料继续讨论" }).click();
    await expect(page.locator(".research-card .discussion")).toHaveCount(1);
    const snapshot = await page.evaluate(() => window.uki.view());
    expect(
      snapshot.notes.find((n) => n.raw.includes("PRIVATE_MARKER"))?.raw,
    ).toContain("PRIVATE_MARKER");
    expect(
      snapshot.notes.find((n) => n.raw.startsWith("我认可需要区分")),
    ).toBeTruthy();
    expect(snapshot.cognitions).toHaveLength(0);
    expect(snapshot.tasks.find((t) => t.kind === "research")?.status).toBe(
      "done",
    );
  } finally {
    await app.close();
  }
});
