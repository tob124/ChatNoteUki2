import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

test("UI polish: contextual empty states, keyboard menus, compact tools and settings protection", async () => {
  const folder = resolve(".local", `uiux-check-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, UKI_DATA_DIR: folder },
  });
  try {
    const page = await app.firstWindow();
    await page.getByLabel("写下想法").waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "回收站是空的" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "配置 DeepSeek" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "还没有收藏的笔记" }),
    ).toBeVisible();
    const ids = await page.evaluate(async () => {
      const thread = await window.uki.thread({
        title: "日常体验",
        description: "围绕记录、查找与回顾",
        parentId: null,
      });
      const note = await window.uki.capture({
        raw: "在长期使用中，清晰的入口与稳定的反馈能减少整理负担。",
        threadId: thread,
      });
      await window.uki.cancelAi(note, "note");
      await window.uki.bookmark(note, true);
      return { thread, note };
    });
    await page.getByRole("button", { name: /^全部记录/ }).click();
    await expect(page.locator("h1")).toHaveText("全部记录");
    await expect(page.locator('.sidebar [aria-current="page"]')).toContainText(
      "全部记录",
    );
    await page.getByLabel("搜索历史").fill("找不到的内容");
    await expect(
      page.getByRole("button", { name: "清除查找条件" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "清除查找条件" }).click();
    await expect(page.locator(".record")).toHaveCount(1);
    const menu = page.locator(".record .action-menu"),
      trigger = menu.locator("summary");
    await trigger.click();
    await expect(menu).toHaveAttribute("open", "");
    await page.getByText("输入工具", { exact: true }).click();
    await expect(menu).not.toHaveAttribute("open", "");
    await page.getByRole("button", { name: "系统听写 · Win+H" }).click();
    await expect(page.getByLabel("写下想法")).toBeFocused();
    await expect(page.locator(".input-tools")).not.toHaveAttribute("open", "");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "更正正文", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(menu).not.toHaveAttribute("open", "");
    await trigger.click();
    await page.getByLabel("搜索历史").click();
    await expect(menu).not.toHaveAttribute("open", "");
    await page.getByRole("button", { name: "日常体验", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "收起 日常体验", exact: true }),
    ).toHaveCount(0);
    await page.getByText("问题操作", { exact: true }).click();
    await page.getByRole("button", { name: "管理问题", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "管理问题" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("问题操作", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "最大化资料", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "问题概览" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "最大化资料", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "收起资料", exact: true }).click();
    await page.getByRole("button", { name: "设置与数据", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置与数据" });
    await expect(settings).toBeVisible();
    await expect(
      settings.getByText("用量提醒与上下文容量", { exact: true }),
    ).toBeVisible();
    await expect(settings.getByLabel("上下文容量（tokens）")).not.toBeVisible();
    await expect(
      settings.getByRole("button", { name: "保存设置", exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder("填写 API key").fill("synthetic-unsaved");
    await page.keyboard.press("Escape");
    await expect(
      settings.getByText("设置有未保存修改。凭据输入不会自动保存。"),
    ).toBeVisible();
    await settings.getByRole("button", { name: "继续编辑" }).click();
    await expect(page.getByPlaceholder("填写 API key")).toHaveValue(
      "synthetic-unsaved",
    );
    await page.getByRole("button", { name: "关闭设置" }).click();
    await settings.getByRole("button", { name: "放弃修改" }).click();
    await expect(
      page.getByRole("button", { name: "设置与数据", exact: true }),
    ).toBeFocused();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 900, height: 640 }),
    );
    await page.getByRole("button", { name: /^全部记录/ }).click();
    await page.getByText("输入工具", { exact: true }).click();
    const toolBox = await page
      .locator(".input-tools .menu-items")
      .boundingBox();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(toolBox!.x).toBeGreaterThanOrEqual(0);
    expect(toolBox!.y).toBeGreaterThanOrEqual(0);
    expect(toolBox!.x + toolBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(viewport.scrollWidth).toBe(viewport.width);
    await page.keyboard.press("Escape");
    await page.getByLabel("写下想法").fill("这次布局检查保留未提交的草稿");
    await page.screenshot({
      path: join(folder, "narrow.png"),
      animations: "disabled",
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 900 }),
    );
    await page.getByRole("button", { name: "日常体验", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("日常体验");
    // The previous choice to close this question's panel is remembered.
    await page.getByRole("button", { name: "概览", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "备查资料" }),
    ).toBeVisible();
    await page.screenshot({
      path: join(folder, "thread.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});
