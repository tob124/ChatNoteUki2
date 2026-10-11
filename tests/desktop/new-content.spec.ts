import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
test("new content is scoped, latest-page refresh preserves its workspace and review explains empty results", async () => {
  const folder = resolve(".local", `new-content-${Date.now()}`);
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
    await page.evaluate(() =>
      window.uki.workspaceState("review", {
        draft: "已有回顾页草稿",
        mode: "note",
        parentNoteId: null,
        openIds: [],
        panel: "closed",
      }),
    );
    await page.getByRole("button", { name: /^回顾/ }).click();
    await expect(page.getByLabel("写下想法")).toHaveValue("已有回顾页草稿");
    await page.getByLabel("写下想法").fill("");
    await expect(
      page.getByRole("heading", { name: "还没有生成的回顾" }),
    ).toBeVisible();
    await expect(
      page.getByText("结果保存在这里，任务进度可在底部查看", { exact: false }),
    ).toBeVisible();
    const ids = await page.evaluate(async () => {
      const thread = await window.uki.thread({
        title: "正在阅读的问题",
        description: "",
        parentId: null,
      });
      const other = await window.uki.thread({
        title: "其他问题",
        description: "",
        parentId: null,
      });
      const notes = [];
      for (let i = 0; i < 35; i++)
        notes.push(
          await window.uki.capture({ raw: `原有记录 ${i}`, threadId: thread }),
        );
      return { thread, other, note: notes[0] };
    });
    await page
      .getByRole("button", { name: "正在阅读的问题", exact: true })
      .click();
    await expect(page.locator(".record")).toHaveCount(30);
    await expect(page.getByRole("complementary", { name: "备查资料" })).toHaveCount(0);
    await page.locator(".records").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.evaluate(async ({ note, thread, other }) => {
      await window.uki.move(note, thread);
      await window.uki.capture({ raw: "其他问题中的新笔记", threadId: other });
    }, ids);
    await expect(page.getByRole("button", { name: /^全部记录/ })).toContainText(
      "36",
    );
    await expect(page.getByText("有新内容，当前阅读位置已保留")).toHaveCount(0);
    await page.evaluate(
      (thread) => window.uki.capture({ raw: "本页最新笔记", threadId: thread }),
      ids.thread,
    );
    await expect(page.getByText("有新内容，当前阅读位置已保留")).toBeVisible();
    await page.getByRole("button", { name: "查看最新", exact: true }).click();
    await expect(page.locator(".record")).toHaveCount(30);
    await expect(page.locator(".main-header h1")).toHaveText("正在阅读的问题");
    await expect(page.locator(".record h2").last()).toHaveText("本页最新笔记");
    await page.locator(".records").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.evaluate(
      (thread) =>
        window.uki.capture({ raw: "第二条新增笔记", threadId: thread }),
      ids.thread,
    );
    await expect(page.getByText("有新内容，当前阅读位置已保留")).toBeVisible();
    await page.getByLabel("搜索历史").fill("原有记录");
    await expect(page.getByText("有新内容，当前阅读位置已保留")).toHaveCount(0);
    await expect(page.locator(".record h2").last()).toHaveText("原有记录 34");
    await page.evaluate(
      (thread) =>
        window.uki.capture({ raw: "无法命中查询的新记录", threadId: thread }),
      ids.thread,
    );
    await expect(page.getByRole("button", { name: /^全部记录/ })).toContainText(
      "39",
    );
    await expect(page.getByText("有新内容，当前阅读位置已保留")).toHaveCount(0);
    await page.locator(".records").focus();
    await page.keyboard.press("Alt+End");
    await expect(page.locator(".record")).toHaveCount(30);
    await expect(page.locator(".record h2").last()).toHaveText("原有记录 34");
  } finally {
    await app.close();
  }
});
