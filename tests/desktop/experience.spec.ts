import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
test("0.4 everyday lifecycle: offline material, real extraction, summary, original export, trash, stable drafts and idempotent save", async () => {
  const folder = resolve(".local", `experience-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const text =
      "这是一份外部参考资料。\n\n观察仅来自两座虚构城市，不能据此推出普遍结论。",
    file = join(folder, "中文资料.txt"),
    exported = join(folder, "另存原文件.txt");
  writeFileSync(file, text, "utf8");
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
    const id = await page.evaluate(async () => {
      const clientId = crypto.randomUUID(),
        input = { clientId, raw: "这是我自己的想法，与参考资料分开。" };
      const first = await window.uki.capture(input),
        second = await window.uki.capture(input);
      if (first !== second) throw new Error("重复保存产生了两个条目");
      return first;
    });
    expect((await page.evaluate(() => window.uki.view())).notes).toHaveLength(
      1,
    );
    await app.evaluate(
      ({ dialog }, data) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [data.file],
        });
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: data.exported,
        });
      },
      { file, exported },
    );
    await page.locator(".record .action-menu summary").click();
    await page.getByRole("button", { name: "关联附件…" }).click();
    await page.getByRole("button", { name: "资料", exact: true }).click();
    await expect(page.locator(".material-card")).toHaveCount(1);
    await expect
      .poll(async () => {
        const p = await page.evaluate(() => window.uki.materialPage());
        return p.items[0].status;
      })
      .toBe("pending");
    expect((await page.evaluate(() => window.uki.view())).notes).toHaveLength(
      1,
    );
    await page.getByRole("button", { name: "查看资料", exact: true }).click();
    await expect(page.locator(".material-reader")).toBeVisible();
    await expect(page.locator(".material-segment")).toHaveCount(2);
    await page.getByRole("button", { name: "保存原文件…" }).click();
    await expect
      .poll(() => {
        try {
          return readFileSync(exported, "utf8");
        } catch {
          return "";
        }
      })
      .toBe(text);
    await page.getByRole("button", { name: "关闭资料" }).click();
    await app.evaluate(() => {
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)),
          context = JSON.parse(body.input[0].content);
        const value = body.instructions.includes("material-summary")
          ? {
              summary: "这份参考资料仅描述虚构城市的有限观察，不能推广。",
              evidenceSegmentIds: context.segments.map(
                (s: { id: number }) => s.id,
              ),
            }
          : body.stream
            ? "可以继续核对观察条件，参考资料不代表你的认同。"
            : {
                threadId: null,
                newThreadTitle: null,
                title: "自己的想法",
                synopsis: "",
                reply: "你希望怎样区分观察和观点？",
              };
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text:
                      typeof value === "string" ? value : JSON.stringify(value),
                  },
                ],
              },
            ],
            usage: { input_tokens: 100, output_tokens: 60 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      };
    });
    await page.evaluate(async () => {
      const { settings } = await window.uki.bootstrap();
      await window.uki.saveSettings(settings, "test-only-not-a-real-key");
    });
    await expect
      .poll(async () => {
        const p = await page.evaluate(() => window.uki.materialPage());
        return p.items[0].status;
      })
      .toBe("done");
    await page.getByRole("button", { name: "全部记录", exact: false }).click();
    await page.locator(".record .record-open").first().click();
    await page.getByRole("button", { name: "回复 AI", exact: true }).click();
    await page.getByText("选择本轮使用的参考资料", { exact: true }).click();
    await page.getByLabel("中文资料.txt", { exact: true }).check();
    await page
      .getByLabel("回复这条笔记中的 AI", { exact: true })
      .fill("请用这份材料帮助我核对这个想法。");
    await page.getByRole("button", { name: "发送回复" }).click();
    await expect(page.locator(".discussion .ai-reply")).toContainText(
      "参考资料不代表你的认同",
    );
    await page.getByRole("button", { name: "系统听写 · Win+H" }).click();
    await expect(page.getByText(/按 Win\+H 使用 Windows/)).toBeVisible();
    await page.getByLabel("写下想法").fill("关闭时必须保存的本机草稿");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByLabel("写下想法")).toHaveValue(
      "关闭时必须保存的本机草稿",
    );
    const material = await page.evaluate(async () => {
      const p = await window.uki.materialPage();
      return p.items[0];
    });
    await page.evaluate(
      (id) => window.uki.materialAction(id, "trash"),
      material.id,
    );
    expect(
      (await page.evaluate(() => window.uki.materialPage())).items,
    ).toHaveLength(0);
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await expect(page.locator(".material-card")).toHaveCount(1);
    await page.getByRole("button", { name: "恢复资料", exact: true }).click();
    expect(
      (await page.evaluate(() => window.uki.materialPage())).items,
    ).toHaveLength(1);
    await page.evaluate(async (id) => {
      await window.uki.trash([id], "trash");
    }, id);
    await expect(page.locator(".record")).toHaveCount(1);
    await page.locator(".record .action-menu summary").click();
    await page.getByRole("button", { name: "恢复笔记", exact: true }).click();
    await page.getByRole("button", { name: "全部记录", exact: false }).click();
    await expect(page.locator(".record")).toHaveCount(1);
    await page.screenshot({ path: join(folder, "experience.png") });
  } finally {
    await app.close();
  }
});
