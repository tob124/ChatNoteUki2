import { _electron as electron, test, expect } from "@playwright/test";
import { join, resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import type { AppView } from "../../src/shared";

test("Windows desktop: immediate save, metadata, search, cognition, restart and credentials isolation", async () => {
  const folder = resolve(".local", `desktop-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, UKI_DATA_DIR: folder },
      timeout: 30000,
    });
  let app = await launch();
  const page = await app.firstWindow();
  await expect(
    page.getByRole("heading", { name: "想法，从这里开始" }),
  ).toBeVisible();
  await page
    .getByLabel("写下想法")
    .fill("城市密度需要结合公共交通考虑。\n这是我的原话。");
  await page.getByRole("button", { name: "保存想法" }).click();
  await expect(page.locator(".original")).toHaveText(
    "城市密度需要结合公共交通考虑。\n这是我的原话。",
  );
  expect((await page.evaluate(() => window.uki.view())).notes[0].status).toBe(
    "pending",
  );
  // Intercept in Electron's main process. No real API credentials or paid calls.
  await app.evaluate(() => {
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const context = JSON.parse(body.messages[1].content);
      const proposal = body.messages[0].content.includes("输出 after");
      const result = proposal
        ? {
            after: {
              viewpoint: "我认为密度需与交通共同评估",
              reasons: ["交通是承载条件"],
              uncertainties: ["还缺少城市数据"],
              questions: ["怎样测量容量？"],
              decisions: [],
            },
            reason: "原话强调公共交通",
            evidenceIds: context.history.map((h: { id: string }) => h.id),
          }
        : {
            threadId: context.selectedThreadId ?? null,
            newThreadTitle: context.selectedThreadId ? null : "城市规划",
            title: "密度与交通的关系",
            synopsis: "我认为评估城市密度时需要同时考虑公共交通。",
            reply: "交通容量之外，是否也需要考虑服务可达性？",
          };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(result) } }],
          usage: { prompt_tokens: 100, completion_tokens: 80 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
  });
  await page.getByRole("button", { name: "设置与数据" }).click();
  await page.getByPlaceholder("填写 API key").fill("test-only-desktop");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(
    page.getByRole("heading", { name: "密度与交通的关系", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".raw-preview")).toContainText(
    "原文城市密度需要结合公共交通考虑。",
  );
  await page.getByRole("button", { name: "接受整理建议", exact: true }).click();
  await page.getByLabel("搜索历史").fill("公共交通");
  await expect(page.locator(".record")).toHaveCount(1);
  await page.getByLabel("搜索历史").fill("");
  await page.getByRole("button", { name: "城市规划", exact: true }).click();
  await page.getByRole("button", { name: "回看历史，提出认知差异" }).click();
  await expect(page.locator(".proposal")).toBeVisible();
  expect(
    (await page.evaluate(() => window.uki.view())).cognitions,
  ).toHaveLength(0);
  await page.getByRole("button", { name: "修改后接受", exact: true }).click();
  await page.getByLabel("当前看法").fill("我希望先检验交通承载能力");
  await page.getByRole("button", { name: "保存并接受" }).click();
  await expect(page.locator(".resource-section > .viewpoint")).toHaveText(
    "我希望先检验交通承载能力",
  );
  const snapshot = (await page.evaluate(() => window.uki.view())) as AppView;
  expect(snapshot.settings.hasApiKey).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain("test-only-desktop");
  expect(readFileSync(join(folder, "credentials.json"), "utf8")).not.toContain(
    "test-only-desktop",
  );
  await page.screenshot({ path: join(folder, "desktop.png"), fullPage: true });
  await app.close();
  app = await launch();
  const second = await app.firstWindow();
  await expect(second.locator(".record")).toHaveCount(1);
  const restored = await second.evaluate(() => window.uki.view());
  expect(restored.notes).toEqual(snapshot.notes);
  expect(restored.cognitions).toEqual(snapshot.cognitions);
  expect(restored.proposals).toEqual(snapshot.proposals);
  await app.close();
});
