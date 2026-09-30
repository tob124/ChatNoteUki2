import { _electron as electron, test, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
test("raw-only upgrade: backup, latest bodies, no legacy UI, preserved credentials and one-time restart", async () => {
  const folder = resolve(".local", `raw-upgrade-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const seed = join(folder, "seed.mjs");
  await build({
    entryPoints: ["scripts/seed-upgrade.ts"],
    outfile: seed,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  execFileSync(process.execPath, [seed, join(folder, "thoughts.db")], {
    windowsHide: true,
    stdio: "pipe",
  });
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
    await expect(page.locator(".record")).toHaveCount(3);
    const before = await page.evaluate(() => window.uki.view());
    expect(before.notes.map((n) => n.raw)).toEqual([
      "升级验收最新更正。",
      "相同原文",
      "相同原文",
    ]);
    expect(before.threads).toEqual([]);
    expect(before.cognitions).toEqual([]);
    expect(
      before.notes.every(
        (n) => n.status === "pending" && n.reply === null && n.revision === 0,
      ),
    ).toBe(true);
    await expect(page.getByText("历史资料", { exact: true })).toHaveCount(0);
    await expect(page.getByText("历史线程资料", { exact: false })).toHaveCount(
      0,
    );
    await page.locator(".record-open").first().click();
    await expect(page.getByText("升级前所属：", { exact: false })).toHaveCount(
      0,
    );
    expect(
      readdirSync(join(folder, "backups")).filter((p) =>
        p.startsWith("before-raw-reimport-"),
      ),
    ).toHaveLength(1);
    await page.evaluate(async () => {
      const { settings } = await window.uki.bootstrap();
      await window.uki.saveSettings(
        { ...settings, autoSync: false },
        undefined,
        "test-only-kept-secret",
      );
    });
    const credentials = readFileSync(join(folder, "credentials.json"));
    await page.screenshot({ path: join(folder, "raw-upgrade.png") });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".record")).toHaveCount(3);
    const after = await page.evaluate(() => window.uki.view());
    expect(after.notes).toEqual(before.notes);
    expect(readFileSync(join(folder, "credentials.json"))).toEqual(credentials);
    expect(
      readdirSync(join(folder, "backups")).filter((p) =>
        p.startsWith("before-raw-reimport-"),
      ),
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});
