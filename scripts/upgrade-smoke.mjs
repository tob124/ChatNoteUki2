// Explicit Windows installation acceptance. Artificial data is isolated from the daily profile; no AI key is used.
import { _electron as electron } from "@playwright/test";
import { spawnSync, spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
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
const folder = resolve(".local", `upgrade-${Date.now()}`);
mkdirSync(folder, { recursive: true });
const seedFile = join(folder, "seed.mjs");
await build({
  entryPoints: ["scripts/seed-upgrade.ts"],
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
if (seed.status !== 0) throw new Error("合成旧库创建失败");
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
  await window.uki.capture({ raw: "旧版未完成记录，升级不得自动重复调用。" });
});
const before = await page.evaluate(() => window.uki.view());
assert.equal(before.settings.hasApiKey, false);
const credentials = readFileSync(join(folder, "credentials.json"));
await app.close();
const installer = resolve("release/ChatNoteUki-0.2.0-Setup-x64.exe");
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
  await page.getByRole("heading", { name: "想法，从这里开始" }).waitFor();
  const after = await page.evaluate(() => window.uki.view());
  const version = await app.evaluate(({ app }) => app.getVersion());
  assert.equal(version, "0.2.0");
  assert.equal(after.notes.length, before.notes.length);
  assert.equal(after.notes[0].raw, before.notes[0].raw);
  assert.equal(after.notes[0].title, before.notes[0].title);
  assert.equal(after.notes[0].synopsis, before.notes[0].synopsis);
  assert.equal(after.notes[0].reply, before.notes[0].reply);
  assert.equal(after.notes[0].threadId, null);
  assert.equal(after.notes[0].originalThreadId, before.notes[0].threadId);
  assert.equal(after.cognitions[0].viewpoint, before.cognitions[0].viewpoint);
  assert.equal(after.threads[0].archived, true);
  assert.equal(after.notes[1].status, "failed");
  assert.deepEqual(readFileSync(join(folder, "credentials.json")), credentials);
  assert.ok(
    readdirSync(join(folder, "backups")).some((f) =>
      f.startsWith("before-0.2.0-"),
    ),
  );
  await page.screenshot({ path: join(folder, "upgraded.png") });
  const seq = after.notes.length;
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  assert.equal(
    (await page.evaluate(() => window.uki.view())).notes.length,
    seq,
  );
  const report = {
    oldVersion,
    version,
    installation: true,
    legacyMigration: true,
    sourceAndMetadataPreserved: true,
    cognitionPreserved: true,
    credentialsUnchanged: true,
    backupCreated: true,
    restartStable: true,
    paidAiCalls: 0,
  };
  writeFileSync(join(folder, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + "\n");
} finally {
  await app.close();
}
