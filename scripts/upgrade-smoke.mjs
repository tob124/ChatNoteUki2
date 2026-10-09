// Actual installed Windows upgrade. Synthetic data and test-only DPAPI password.
import { _electron as electron } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
const installed = join(
  process.env.LOCALAPPDATA,
  "Programs",
  "ChatNoteUki",
  "ChatNoteUki.exe",
);
const folder = resolve(".local", `upgrade-four-${Date.now()}`);
mkdirSync(folder, { recursive: true });
const seedFile = join(folder, "seed.mjs");
await build({
  entryPoints: ["scripts/seed-upgrade-four.ts"],
  outfile: seedFile,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
});
const seed = spawnSync(
  process.execPath,
  [seedFile, join(folder, "thoughts.db")],
  { windowsHide: true, encoding: "utf8" },
);
assert.equal(seed.status, 0, seed.stderr);
const launch = () =>
  electron.launch({
    executablePath: installed,
    args: [],
    cwd: process.cwd(),
    env: { ...process.env, UKI_DATA_DIR: folder },
    timeout: 30000,
  });
let app = await launch();
let page = await app.firstWindow();
await page.getByLabel("写下想法").waitFor();
const oldVersion = await app.evaluate(({ app }) => app.getVersion());
await page.evaluate(async () => {
  const { settings } = await window.uki.view();
  await window.uki.saveSettings(
    {
      ...settings,
      davUser: "",
      directory: "unused-upgrade-test",
      autoSync: false,
    },
    undefined,
    "test-only-preserved-password",
  );
});
const before = await page.evaluate(() => window.uki.view());
const credentials = readFileSync(join(folder, "credentials.json"));
await app.close();
const installer = resolve("release/ChatNoteUki-0.4.0-Setup-x64.exe");
assert.ok(existsSync(installer));
const exit = await new Promise((res, rej) => {
  const child = spawn(installer, ["/S"], {
    windowsHide: true,
    stdio: "ignore",
  });
  child.on("error", rej);
  child.on("exit", res);
});
assert.equal(exit, 0);
app = await launch();
try {
  page = await app.firstWindow();
  await page.getByLabel("写下想法").waitFor();
  const after = await page.evaluate(() => window.uki.view());
  const version = await app.evaluate(({ app }) => app.getVersion());
  assert.equal(version, "0.4.0");
  assert.deepEqual(after.notes, before.notes);
  assert.deepEqual(after.threads, before.threads);
  assert.deepEqual(after.cognitions, before.cognitions);
  assert.deepEqual(readFileSync(join(folder, "credentials.json")), credentials);
  assert.equal(
    (await page.evaluate(() => window.uki.workspaceState("all"))).draft,
    "升级保留草稿",
  );
  const backupCreated =
    existsSync(join(folder, "backups")) &&
    readdirSync(join(folder, "backups")).some((f) =>
      f.startsWith("before-0.4.0-"),
    );
  if (oldVersion !== version) assert.ok(backupCreated);
  await page.getByLabel("写下想法").fill("升级后的离线记录");
  await page.getByRole("button", { name: "保存想法", exact: true }).click();
  await page.getByLabel("写下想法").fill("退出前的未提交草稿");
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByLabel("写下想法").waitFor();
  assert.equal(
    await page.getByLabel("写下想法").inputValue(),
    "退出前的未提交草稿",
  );
  assert.equal(
    (await page.evaluate(() => window.uki.view())).notes.length,
    before.notes.length + 1,
  );
  await page.screenshot({ path: join(folder, "upgraded.png") });
  const report = {
    oldVersion,
    version,
    installation: true,
    manualFieldsPreserved: true,
    cognitionPreserved: true,
    credentialsUnchanged: true,
    backupCreated,
    draftAndOfflineRestart: true,
    paidAiCalls: 0,
  };
  writeFileSync(join(folder, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + "\n");
} finally {
  await app.close();
}
