import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
test("analysis feedback: running, failure, retry, result navigation, budgets and readable titles", async () => {
  const folder = resolve(".local", `feedback-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const app = await electron.launch({
    executablePath: process.env.UKI_TEST_EXE,
    args: process.env.UKI_TEST_EXE ? [] : ["."],
    cwd: process.cwd(),
    env: { ...process.env, UKI_DATA_DIR: folder },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("heading", { name: "想法，从这里开始" }).waitFor();
    const thread = await page.evaluate(() =>
      window.uki.thread({
        title: "王者匹配机制是否公平",
        description: "限定当前问题",
        parentId: null,
      }),
    );
    await app.evaluate((_electron, thread) => {
      const runtime = globalThis as any;
      runtime.analysisPending = [];
      runtime.analysisInputs = [];
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)),
          context = JSON.parse(body.input[0].content),
          instructions = body.instructions;
        if (
          instructions.includes('"expressed"') ||
          instructions.includes("输出 after")
        ) {
          runtime.analysisInputs.push(context);
          return await new Promise<Response>((resolve) =>
            runtime.analysisPending.push({ context, instructions, resolve }),
          );
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    threadId: thread,
                    newThreadTitle: null,
                    title: "我的匹配想法",
                    synopsis: "",
                    reply: `你在讨论 ${thread.slice(0, 8)}（王者匹配机制是否公平）吗？`,
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 30 },
          }),
          { status: 200 },
        );
      };
    }, thread);
    await page.evaluate(async (thread) => {
      for (let i = 0; i < 35; i++)
        await window.uki.capture({
          raw: `匹配机制的想法 ${i}`,
          threadId: thread,
        });
    }, thread);
    await page
      .getByRole("button", { name: "王者匹配机制是否公平", exact: true })
      .click();
    let panel = page.locator(".thread-workbench");
    await expect(
      panel.getByRole("button", { name: "生成线程回顾", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByText("配置 DeepSeek 后才能生成分析。", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "继续讨论", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(async () => {
      const { settings } = await window.uki.bootstrap();
      await window.uki.saveSettings(
        { ...settings, autoSync: false },
        "test-only-feedback",
      );
    });
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.uki.view()).notes.every((n) => n.status === "done"),
        ),
      )
      .toBe(true);
    await page.locator(".record-open").last().click();
    await expect(page.locator(".ai-reply > p").last()).toHaveText(
      "你在讨论 「王者匹配机制是否公平」吗？",
    );
    await page.getByRole("button", { name: "更早记录", exact: true }).click();
    await expect(page.locator(".record")).toHaveCount(5);
    await panel
      .getByRole("button", { name: "生成线程回顾", exact: true })
      .click();
    await expect(
      panel.getByText("AI 正在生成，请稍候…", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "生成线程回顾", exact: true }),
    ).toBeDisabled();
    expect(
      await app.evaluate(() => (globalThis as any).analysisPending.length),
    ).toBe(1);
    await app.evaluate(() => {
      const job = (globalThis as any).analysisPending.shift();
      job.resolve(new Response("", { status: 400 }));
    });
    await expect(panel.getByText("生成失败", { exact: true })).toBeVisible();
    await expect(
      panel.getByText("DeepSeek 请求失败（HTTP 400）", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "手动重试", exact: true }).click();
    await expect(
      panel.getByText("AI 正在生成，请稍候…", { exact: true }),
    ).toBeVisible();
    const succeed = async () =>
      app.evaluate(() => {
        const job = (globalThis as any).analysisPending.shift();
        const evidenceIds = job.context.history.map((n: any) => n.id);
        const result = job.instructions.includes("输出 after")
          ? {
              after: {
                viewpoint: "我开始区分体验与统计",
                reasons: [],
                uncertainties: [],
                questions: [],
                decisions: [],
              },
              reason: "用户原话",
              evidenceIds,
            }
          : {
              expressed: [
                `${job.context.selectedThread.id}（王者匹配机制是否公平）值得观察`,
              ],
              possible: ["尚无结论"],
              questions: ["还需哪些证据？"],
              evidenceIds,
            };
        job.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(result) } }],
              usage: { prompt_tokens: 100, completion_tokens: 80 },
            }),
            { status: 200 },
          ),
        );
      });
    await succeed();
    await expect(
      panel.getByText("生成完成，结果已保存", { exact: true }),
    ).toBeVisible();
    // Finished work collapses; reading an older page is not moved automatically.
    await expect(panel.locator(".analysis-progress[open]")).toHaveCount(0);
    await panel.getByText("生成完成，结果已保存", { exact: true }).click();
    await page.getByLabel("搜索历史").fill("不会命中结果");
    await panel.getByRole("button", { name: "查看回顾", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "备查资料" }),
    ).toBeHidden();
    await expect(page.locator(".main-pane .recap")).toBeVisible();
    await expect(page.locator(".main-pane .recap")).toContainText(
      "「王者匹配机制是否公平」值得观察",
    );
    await page.getByRole("button", { name: "概览", exact: true }).click();
    panel = page.locator(".thread-workbench");
    await panel
      .getByRole("button", { name: "检查认知变化", exact: true })
      .click();
    await expect(
      panel.getByText("AI 正在生成，请稍候…", { exact: true }),
    ).toBeVisible();
    await succeed();
    await panel
      .locator(".analysis-task")
      .filter({
        has: page.getByRole("button", { name: "检查认知变化", exact: true }),
      })
      .getByText("生成完成，结果已保存", { exact: true })
      .click();
    await panel
      .getByRole("button", { name: "查看认知建议", exact: true })
      .click();
    await expect(
      page.getByRole("complementary", { name: "备查资料" }),
    ).toBeHidden();
    await expect(page.locator(".main-pane .proposal")).toBeVisible();
    await page.getByRole("button", { name: "概览", exact: true }).click();
    panel = page.locator(".thread-workbench");
    await page.evaluate(async () => {
      const { settings } = await window.uki.bootstrap();
      await window.uki.saveSettings({
        ...settings,
        hardBudget: true,
        dailyInputLimit: 8000,
        dailyOutputLimit: 3000,
      });
    });
    await expect(
      panel.getByRole("button", { name: "生成线程回顾", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "生成线程回顾", exact: true })
      .click();
    await expect(
      panel.getByText("今日预算不足，明日自动继续", { exact: true }),
    ).toBeVisible();
    expect(
      await app.evaluate(() => (globalThis as any).analysisInputs.length),
    ).toBe(3);
    await page.getByRole("button", { name: "收起资料", exact: true }).click();
    await page.getByRole("button", { name: /^回顾/ }).click();
    await expect(page.locator(".main-pane .recap h2")).toHaveText(
      "王者匹配机制是否公平 · 回顾",
    );
    await expect(
      page.getByText("这里汇集线程回顾和所选笔记分析", { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel("写下想法")).toHaveCount(0);
    await page.getByRole("button", { name: "进入问题", exact: true }).click();
    await expect(page.locator(".main-header h1")).toHaveText(
      "王者匹配机制是否公平",
    );
    await page.screenshot({ path: join(folder, "feedback.png") });
  } finally {
    await app.close();
  }
});
