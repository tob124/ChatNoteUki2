import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test("experimental workspace: inline human classification, one-click thought/research, compact reading and appearance fallback", async () => {
  const folder = resolve(".local", `glass-workspace-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, UKI_DATA_DIR: folder },
  });
  try {
    const page = await app.firstWindow();
    await page.getByLabel("写下想法").waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 900 }),
    );
    await app.evaluate(() => {
      const runtime = globalThis as any;
      runtime.plans = 0;
      runtime.queries = [];
      globalThis.fetch = async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(url).includes("/anthropic/")) {
          runtime.queries.push(body.messages[0].content);
          return new Response(
            JSON.stringify({
              content: [{ type: "web_search_tool_result", content: [] }],
              usage: {
                input_tokens: 10,
                output_tokens: 10,
                server_tool_use: { web_search_requests: 1 },
              },
            }),
          );
        }
        const context = JSON.parse(body.input[0].content);
        let value: unknown;
        if (body.instructions.includes("research-query-plan")) {
          runtime.plans++;
          value = {
            question: "通勤与满意度的关系",
            queries: ["通勤 满意度 研究"],
          };
        } else if (body.instructions.includes('"expressed"')) {
          value = {
            expressed: "用户在观察记录习惯。",
            possible: "可能需要降低整理负担。",
            questions: "怎样保持记录轻松？",
            evidenceIds: context.history.map((n: any) => n.id),
          };
        } else
          value = {
            threadId: null,
            newThreadTitle: "日常观察",
            newParentId: null,
            threadDescription: "记录日常体验和观察",
            title: "记录习惯",
            synopsis: "",
            reply: "可以在回顾时再核对自己的判断。",
          };
        return new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: JSON.stringify(value) }],
              },
            ],
            usage: { input_tokens: 30, output_tokens: 30 },
          }),
        );
      };
    });
    const note = await page.evaluate(async () => {
      const { settings } = await window.uki.bootstrap();
      await window.uki.saveSettings(
        { ...settings, autoSync: false },
        "test-only",
      );
      return window.uki.capture({ raw: "我希望记录想法更轻松 PRIVATE_MARKER" });
    });
    await page.getByRole("button", { name: /^待整理/ }).click();
    const card = page.locator(".record");
    await expect(card.getByRole("button", { name: "接受归属" })).toBeVisible();
    expect(
      (await page.evaluate(() => window.uki.bootstrap())).threads,
    ).toHaveLength(0);
    await card.getByRole("button", { name: "接受归属" }).click();
    await expect(card).toHaveCount(0);
    const view = await page.evaluate(() => window.uki.view());
    expect(view.notes.find((n) => n.id === note)?.raw).toContain(
      "PRIVATE_MARKER",
    );
    expect(view.threads).toHaveLength(1);
    await page.getByRole("button", { name: "日常观察", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "备查资料" }),
    ).toHaveCount(0);
    expect(
      await card
        .locator(".record-open")
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(900);
    await card.locator(".record-open").click();
    await card.getByRole("button", { name: "AI 思考", exact: true }).click();
    await expect(card.getByRole("button", { name: "查看思考" })).toBeVisible();
    await expect(card.locator(".note-thought-result")).toHaveCount(0);
    await card
      .getByRole("button", { name: "外部资料查证", exact: true })
      .click();
    await expect(
      card.getByText("资料分析未完成", { exact: true }),
    ).toBeVisible();
    await expect(card.getByLabel("资料分析问题")).toHaveCount(0);
    const calls = await app.evaluate(() => ({
      plans: (globalThis as any).plans,
      queries: (globalThis as any).queries,
    }));
    expect(calls.plans).toBe(1);
    expect(calls.queries).toHaveLength(1);
    expect(calls.queries.join(" ")).not.toContain("PRIVATE_MARKER");
    await card.getByRole("button", { name: "查看思考" }).click();
    await expect(page.locator(".main-pane .recap")).toBeVisible();
    await page.getByLabel("阅读设置").click();
    await page.getByLabel("工作区外观").selectOption("plain");
    expect(
      await page
        .locator(".composer")
        .evaluate((el) => getComputedStyle(el).backdropFilter),
    ).toBe("none");
    await page.getByRole("button", { name: "日常观察", exact: true }).click();
    await page.getByLabel("阅读设置").click();
    await page.getByLabel("工作区外观").selectOption("glass");
    await page.getByLabel("减少透明效果").check();
    expect(
      await page
        .locator(".composer")
        .evaluate((el) => getComputedStyle(el).backdropFilter),
    ).toBe("none");
    await page.getByLabel("减少透明效果").uncheck();
    await page.getByLabel("写下想法").click();
    await page.screenshot({
      path: resolve(folder, "workspace.png"),
      animations: "disabled",
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 900, height: 650 }),
    );
    await page.getByRole("button", { name: "概览", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(folder, "narrow.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});
