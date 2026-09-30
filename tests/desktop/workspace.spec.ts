import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

test("workspace: local drafts, hierarchy, lazy pages, anchored reading, corrections and reference layer", async () => {
  const folder = resolve(".local", `workspace-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, UKI_DATA_DIR: folder },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "想法，从这里开始" }),
    ).toBeVisible();
    const root = await page.evaluate(() =>
      window.uki.thread({
        title: "长期问题",
        description: "问题的范围",
        parentId: null,
      }),
    );
    await page.evaluate(async (id) => {
      const child = await window.uki.thread({
        title: "一个子问题",
        description: "",
        parentId: id,
      });
      await window.uki.capture({ raw: "子问题中的原文", threadId: child });
      for (let i = 0; i < 64; i++)
        await window.uki.capture({ raw: `分页笔记 ${i}`, threadId: id });
    }, root);
    await page.getByRole("button", { name: "长期问题", exact: true }).click();
    await expect(page.locator(".record")).toHaveCount(30);
    await expect(
      page.getByRole("complementary", { name: "备查资料" }),
    ).toBeVisible();
    await page.getByLabel("写下想法").fill("线程草稿，请留住。");
    await page.getByRole("button", { name: "全部记录", exact: false }).click();
    await page.getByLabel("写下想法").fill("全局草稿");
    await page.getByRole("button", { name: "长期问题", exact: true }).click();
    await expect(page.getByLabel("写下想法")).toHaveValue("线程草稿，请留住。");
    await page.getByRole("button", { name: "更早记录", exact: true }).click();
    await expect(page.locator(".record h2").last()).toHaveText("分页笔记 33");
    const older = await page.locator(".record h2").allTextContents();
    await page.locator(".records").evaluate((el) => (el.scrollTop = 90));
    await page.waitForTimeout(350);
    const position = await page
      .locator(".records")
      .evaluate((el) => el.scrollTop);
    await page.evaluate(
      (id) =>
        window.uki.capture({ raw: "后台新内容不应打断旧页", threadId: id }),
      root,
    );
    await expect(page.getByText("有新内容，当前阅读位置已保留")).toBeVisible();
    expect(await page.locator(".record h2").allTextContents()).toEqual(older);
    expect(await page.locator(".records").evaluate((el) => el.scrollTop)).toBe(
      position,
    );
    await page.getByRole("button", { name: "最大化资料", exact: true }).click();
    await expect(page.locator(".reading-layer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".reading-layer")).toHaveCount(0);
    expect(await page.locator(".records").evaluate((el) => el.scrollTop)).toBe(
      position,
    );
    await page.getByRole("button", { name: "较新记录", exact: true }).click();
    await expect(page.locator(".record h2").last()).toContainText(
      "分页笔记 63",
    );
    await page.getByRole("button", { name: "查看最新", exact: true }).click();
    await page.locator(".record-open").last().click();
    await expect(page.locator(".original").last()).toContainText("后台新内容");
    await page.getByRole("button", { name: "更正正文", exact: true }).click();
    await page
      .getByLabel("更正正文", { exact: true })
      .fill("更正后的原文保留旧版本。");
    await page.getByRole("button", { name: "保存更正", exact: true }).click();
    await expect(page.locator(".original").last()).toHaveText(
      "更正后的原文保留旧版本。",
    );
    const detail = await page.evaluate(async (id) => {
      const p = await window.uki.workspace({ workspace: id });
      const n = p.items.filter((i) => i.kind === "note").at(-1)!;
      return window.uki.detail(n.value.id);
    }, root);
    expect(detail.revisions.map((r) => r.raw)).toEqual([
      "后台新内容不应打断旧页",
      "更正后的原文保留旧版本。",
    ]);
    await page.screenshot({ path: join(folder, "workspace.png") });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "长期问题", exact: true }).click();
    await expect(page.getByLabel("写下想法")).toHaveValue("线程草稿，请留住。");
    await expect(page.locator(".record")).toHaveCount(30);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 760),
    );
    await expect(page.locator(".main-pane")).toBeVisible();
    expect(
      await page
        .locator(".main-pane")
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(480);
    await page.screenshot({ path: join(folder, "narrow.png") });
  } finally {
    await app.close();
  }
});
