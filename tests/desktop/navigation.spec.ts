import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
test("search old version, verify reference, locate and reply, return; paged dialogue and cognition draft restart", async () => {
  const folder = resolve(".local", `navigation-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, UKI_DATA_DIR: folder },
      timeout: 30000,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByLabel("写下想法").waitFor();
    const ids = await page.evaluate(async () => {
      const thread = await window.uki.thread({
        title: "验收问题",
        description: "",
        parentId: null,
      });
      const note = await window.uki.capture({
        raw: "旧版本独特令牌",
        threadId: thread,
      });
      await window.uki.correct(note, "更正后的当前正文", 0);
      await window.uki.title(note, "长期想法", "旧版本独特令牌");
      await window.uki.cancelAi(note, "note");
      for (let i = 0; i < 65; i++) {
        const id = await window.uki.capture({
          raw: `旧对话 ${i}`,
          mode: "discussion",
          parentNoteId: note,
          threadId: thread,
        });
        await window.uki.cancelAi(id, "note");
      }
      return { thread, note };
    });
    await page.getByRole("button", { name: "全部记录", exact: false }).click();
    await page.getByLabel("搜索历史").fill("旧版本独特令牌");
    await expect(page.locator(".record")).toHaveCount(0);
    await page.getByText("筛选与查询", { exact: true }).click();
    await page.getByLabel("包含更正历史").check();
    await page.getByLabel("包含更正历史").press("Escape");
    await expect(page.locator(".record")).toHaveCount(1);
    await page.getByRole("button", { name: "核对旧正文", exact: true }).click();
    await expect(page.locator(".reference-raw")).toHaveText("旧版本独特令牌");
    await page.getByRole("button", { name: "定位原记录", exact: true }).click();
    await expect(page.locator(".record .original").first()).toHaveText(
      "更正后的当前正文",
    );
    await page.getByRole("button", { name: "回复 AI", exact: true }).click();
    await expect(page.locator(".discussion")).toHaveCount(30);
    await page.getByRole("button", { name: "更早对话", exact: true }).click();
    await expect(page.locator(".discussion")).toHaveCount(60);
    await page.getByRole("button", { name: "更早对话", exact: true }).click();
    await expect(page.locator(".discussion")).toHaveCount(65);
    await app.evaluate(() => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "针对这条笔记的回答" }],
              },
            ],
            usage: { input_tokens: 80, output_tokens: 30 },
          }),
          { headers: { "content-type": "application/json" } },
        );
    });
    await page.evaluate(async () => {
      const { settings } = await window.uki.bootstrap();
      await window.uki.saveSettings(settings, "test-only-not-real");
    });
    await page
      .getByLabel("回复这条笔记中的 AI", { exact: true })
      .fill("核对我的最新补充");
    await page.getByRole("button", { name: "发送回复", exact: true }).click();
    await expect(page.locator(".discussion .ai-reply").last()).toContainText(
      "针对这条笔记",
    );
    await expect(page.locator(".discussion")).toHaveCount(66);
    await page
      .getByRole("button", { name: "返回查找位置", exact: true })
      .click();
    await expect(page.getByLabel("搜索历史")).toHaveValue("旧版本独特令牌");
    await expect(page.getByLabel("包含更正历史")).toBeChecked();
    await page.getByRole("button", { name: "验收问题", exact: true }).click();
    await expect(page.locator(".resource-header h2")).toHaveText("问题概览");
    await page
      .getByRole("button", { name: "手动编辑认知", exact: true })
      .click();
    await page
      .getByLabel("当前看法", { exact: true })
      .fill("尚未提交的认知草稿");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "验收问题", exact: true }).click();
    await expect(page.locator(".resource-header h2")).toHaveText("问题概览");
    await page
      .getByRole("button", { name: "手动编辑认知", exact: true })
      .click();
    await page.screenshot({ path: resolve(folder, "cognition-restart.png") });
    await expect(page.getByLabel("当前看法", { exact: true })).toHaveValue(
      "尚未提交的认知草稿",
    );
    await page
      .getByRole("button", { name: "保存为新认知版本", exact: true })
      .click();
    expect(
      (await page.evaluate((id) => window.uki.resources(id), ids.thread))
        .cognition.viewpoint,
    ).toBe("尚未提交的认知草稿");
    const composer = page.getByLabel("写下想法");
    await composer.fill("输入法尚未确认的草稿");
    await composer.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      ),
    );
    expect(
      (await page.evaluate(() => window.uki.view())).notes.filter(
        (n) => n.mode === "note",
      ),
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});
