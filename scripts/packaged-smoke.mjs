import { _electron as electron } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const exe = resolve(process.argv[2] ?? "release/win-unpacked/ChatNoteUki.exe");
const folder = resolve(".local", `packaged-${Date.now()}`);
mkdirSync(folder, { recursive: true });
const launch = () =>
  electron.launch({
    executablePath: exe,
    args: [],
    cwd: process.cwd(),
    env: { ...process.env, UKI_DATA_DIR: folder },
    timeout: 30000,
  });
let app = await launch();
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "想法，从这里开始" }).waitFor();
  await page
    .getByLabel("写下想法")
    .fill("安装包验收：离线保存后重启，原文必须保留。");
  await page.getByRole("button", { name: "保存想法" }).click();
  await page.locator(".original").waitFor();
  const before = await page.evaluate(() => window.uki.view());
  const security = await app.evaluate(({ BrowserWindow, app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    sqlite: process.versions.sqlite,
    sandbox:
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
        .sandbox,
    contextIsolation:
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
        .contextIsolation,
  }));
  await page.screenshot({ path: join(folder, "packaged.png") });
  await app.close();
  app = await launch();
  const second = await app.firstWindow();
  await second.locator(".record").waitFor();
  const after = await second.evaluate(() => window.uki.view());
  if (
    JSON.stringify(before.notes) !== JSON.stringify(after.notes) ||
    !security.packaged ||
    !security.sandbox ||
    !security.contextIsolation
  )
    throw new Error("Packaged acceptance failed");
  const report = {
    ...security,
    offlineSave: true,
    restartRecovery: true,
    noteCount: after.notes.length,
  };
  writeFileSync(join(folder, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  await app.close();
}
