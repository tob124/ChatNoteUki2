import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
test("0.5 workflows: compact search views, selected analysis, excerpt provenance, export and restart", async () => {
  const folder = resolve(".local", `tools-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const inputFile = join(folder, "资料.txt"),
    output = join(folder, "笔记.md");
  writeFileSync(inputFile, "来源原文：不要把相关关系当成因果关系。", "utf8");
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
    await app.evaluate(() => {
      globalThis.fetch = async (_input, init) => {
        const request = JSON.parse(String(init?.body)),
          context = JSON.parse(request.input[0].content);
        const result = request.instructions.includes("material-summary")
          ? {
              summary: "资料提醒区分相关与因果。",
              evidenceSegmentIds: context.segments?.map((s: any) => s.id) ?? [
                ...new Set(
                  context.parts.flatMap((p: any) => p.evidenceSegmentIds),
                ),
              ],
            }
          : request.instructions.includes('"suggestions"')
            ? { suggestions: [] }
            : request.instructions.includes('"expressed"')
              ? {
                  expressed: "用户正在核对两条想法",
                  possible: "联系仍需要证据",
                  questions: "还有哪些不同条件？",
                  evidenceIds: context.history.map((n: any) => n.id),
                }
              : {
                  threadId: null,
                  newThreadTitle: null,
                  newParentId: null,
                  threadDescription: "",
                  title: context.raw.slice(0, 18),
                  synopsis: "",
                  reply: "可以继续核对依据。",
                };
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(result) } }],
            usage: { prompt_tokens: 80, completion_tokens: 60 },
          }),
        );
      };
    });
    await page.getByRole("button", { name: "设置与数据" }).click();
    await page.getByPlaceholder("填写 API key").fill("test-only-tools");
    await page.getByRole("button", { name: "保存设置" }).click();
    for (const raw of ["因果判断第一条", "因果判断第二条", "无关的其他想法"]) {
      await page.getByLabel("写下想法").fill(raw);
      await page.getByRole("button", { name: "保存想法", exact: true }).click();
    }
    await expect(page.locator(".record")).toHaveCount(3);
    await page.getByLabel("搜索历史").fill("因果判断");
    await expect(page.locator(".record")).toHaveCount(2);
    expect(await page.getByLabel("AI 状态筛选").isVisible()).toBe(false);
    await page.getByText("筛选与查询", { exact: true }).click();
    await page.getByRole("button", { name: "保存当前查询…" }).click();
    await page.getByLabel("查询名称").fill("核对因果");
    await page.getByRole("button", { name: "保存查询", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "核对因果", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "核对因果", exact: true })
      .press("Escape");
    await page.getByLabel("搜索历史").fill("");
    await expect(page.locator(".record")).toHaveCount(3);
    await page.getByText("筛选与查询", { exact: true }).click();
    await page.getByRole("button", { name: "核对因果", exact: true }).click();
    await expect(page.getByLabel("搜索历史")).toHaveValue("因果判断");
    await expect(page.locator(".record")).toHaveCount(2);
    await page.locator('.record input[type="checkbox"]').nth(0).check();
    await page.locator('.record input[type="checkbox"]').nth(1).check();
    await page.getByRole("button", { name: "分析所选…" }).click();
    const dialog = page.locator(".context-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".selection-sources p")).toHaveCount(2);
    await dialog.getByLabel("分析问题").fill("这两条因果判断有哪些联系？");
    await dialog.getByRole("button", { name: "确认并分析" }).click();
    await expect(dialog).not.toBeVisible();
    await page
      .locator(".task-dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: /^回顾/ }).click();
    await expect(page.locator(".recap h2")).toHaveText(
      "这两条因果判断有哪些联系？",
    );
    await expect(page.locator(".recap")).toContainText("仅所选 2 条最新正文");
    await page.getByRole("button", { name: /^资料$/ }).click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, inputFile);
    await page.getByRole("button", { name: "导入资料…" }).click();
    await expect(page.locator(".material-card")).toHaveCount(1);
    await page.getByRole("button", { name: "查看资料", exact: true }).click();
    let reader = page.locator(".material-reader");
    await expect(reader.locator("[data-source-text]")).toContainText(
      "来源原文",
    );
    await reader.locator("[data-source-text]").focus();
    await reader.locator("[data-source-text]").press("Enter");
    await reader
      .getByLabel("摘录想法", { exact: true })
      .fill("我的理解：还需要核对因果机制。");
    await reader.getByRole("button", { name: "收起草稿" }).click();
    await reader
      .getByRole("button", { name: "摘录并记录想法", exact: true })
      .click();
    await expect(reader.getByLabel("摘录想法", { exact: true })).toHaveValue(
      "我的理解：还需要核对因果机制。",
    );
    const sourceId = await page.evaluate(
      async () => (await window.uki.materialPage()).items[0].id,
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (id) => (await window.uki.materialDetail(id)).status,
          sourceId,
        ),
      )
      .toBe("done");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: /^资料$/ }).click();
    await page.getByRole("button", { name: "查看资料", exact: true }).click();
    reader = page.locator(".material-reader");
    await reader.locator("[data-source-text]").press("Enter");
    await expect(reader.getByLabel("摘录想法", { exact: true })).toHaveValue(
      "我的理解：还需要核对因果机制。",
    );
    await app.evaluate(() => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    threadId: null,
                    newThreadTitle: null,
                    title: "我的理解：还需要核对因果机制。",
                    synopsis: "",
                    reply: "继续核对依据。",
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 30 },
          }),
        );
    });
    await reader.getByRole("button", { name: "保存想法", exact: true }).click();
    await expect(reader).toContainText("想法已保存到本机");
    await reader.getByRole("button", { name: "关闭资料", exact: true }).click();
    await page.getByRole("button", { name: /^全部记录/ }).click();
    await page.getByLabel("搜索历史").fill("我的理解");
    await expect(page.locator(".record")).toHaveCount(1);
    await page.locator(".record-open").click();
    await page.getByRole("button", { name: "核对参考摘录" }).click();
    await expect(page.locator(".material-reader")).toContainText(
      "不要把相关关系当成因果关系",
    );
    await page.getByRole("button", { name: "关闭摘录" }).click();
    await expect(page.getByLabel("搜索历史")).toHaveValue("我的理解");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, output);
    const id = await page.evaluate(
      async () =>
        (await window.uki.workspace({ workspace: "all", query: "我的理解" }))
          .items[0].value.id,
    );
    await page.evaluate((id) => window.uki.exportNotes([id]), id);
    expect(readFileSync(output, "utf8")).toContain("参考摘录（非用户原话）");
    expect(readFileSync(output, "utf8")).toContain(
      "我的理解：还需要核对因果机制。",
    );
    await page.screenshot({ path: join(folder, "workspace-normal.png") });
    await page.setViewportSize({ width: 880, height: 650 });
    await page.getByText("筛选与查询", { exact: true }).click();
    const box = await page.locator(".search-popover").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(880);
    expect(
      (await page.getByLabel("包含更正历史").boundingBox())!.width,
    ).toBeLessThanOrEqual(18);
    await page.screenshot({ path: join(folder, "workspace-narrow.png") });
    await page
      .getByRole("button", { name: "核对因果", exact: true })
      .press("Escape");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByLabel("搜索历史").waitFor();
    await page.getByText("筛选与查询", { exact: true }).click();
    await page.getByRole("button", { name: "核对因果", exact: true }).click();
    await expect(page.getByLabel("搜索历史")).toHaveValue("因果判断");
    await expect(page.locator(".record")).toHaveCount(2);
    const source = await page.evaluate((id) => window.uki.quoteSource(id), id);
    expect(source.current).toBe(true);
  } finally {
    await app.close();
  }
});
