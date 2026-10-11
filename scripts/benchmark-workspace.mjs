import { _electron as electron } from "@playwright/test";
import { build } from "esbuild";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { cpus, platform, release, totalmem } from "node:os";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const folder = resolve(".local", `glass-benchmark-${Date.now()}`);
mkdirSync(folder, { recursive: true });
const bundle = join(folder, "store.cjs");
await build({
  entryPoints: ["electron/store.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
const { Store } = createRequire(import.meta.url)(bundle);
const db = join(folder, "thoughts.db");
// Reuse only a prior synthetic benchmark, in a fresh copied profile.
if (process.argv[2]) {
  const fixture = resolve(process.argv[2]);
  if (
    !fixture.startsWith(resolve(".local") + sep) ||
    JSON.parse(readFileSync(join(fixture, "results.json"), "utf8")).notes !==
      10000
  )
    throw new Error(
      "Only an existing .local synthetic benchmark may be reused",
    );
  for (const name of ["thoughts.db", "thoughts.db-wal", "thoughts.db-shm"])
    if (existsSync(join(fixture, name)))
      copyFileSync(join(fixture, name), join(folder, name));
}
const seed = new Store(db);
const text =
  "这是一条合成笔记。记录自己的观察，并保留原文作为后续回顾的依据。".repeat(8);
if (!process.argv[2])
  for (let i = 0; i < 10000; i++)
    seed.capture({ raw: `合成记录 ${i}：${text}` });
if (seed.snapshot().notes.length !== 10000)
  throw new Error("Unexpected synthetic fixture size");
seed.close();
const reports = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
for (const mode of ["plain", "glass", "glass", "plain"]) {
  const store = new Store(db);
  store.preferences({ appearance: mode });
  store.close();
  const start = performance.now();
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, UKI_DATA_DIR: folder },
  });
  try {
    const page = await app.firstWindow();
    await page.locator(".record").first().waitFor();
    if (mode === "glass")
      await page.locator(".composer feImage").waitFor({ state: "attached" });
    const firstPageMs = performance.now() - start;
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 900 }),
    );
    const records = await page.locator(".record").count();
    await delay(1500);
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await delay(500);
      samples.push(
        await app.evaluate(({ app }) =>
          app.getAppMetrics().map((m) => ({
            type: m.type,
            cpu: m.cpu.percentCPUUsage,
            workingSetMB: m.memory.workingSetSize / 1024,
          })),
        ),
      );
    }
    const frames = await page.evaluate(async () => {
      const el = document.querySelector(".records");
      const intervals = [];
      let previous;
      for (let i = 0; i < 180; i++) {
        const now = await new Promise(requestAnimationFrame);
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        el.scrollTop += 14;
      }
      intervals.sort((a, b) => a - b);
      return {
        medianMs: intervals[Math.floor(intervals.length / 2)],
        p95Ms: intervals[Math.floor(intervals.length * 0.95)],
        longFrames: intervals.filter((n) => n > 50).length,
      };
    });
    const geometry = await page.evaluate(() => ({
      readingWidth: document
        .querySelector(".record-open")
        .getBoundingClientRect().width,
      readingHeight: document.querySelector(".records").getBoundingClientRect()
        .height,
      composerHeight: document
        .querySelector(".composer")
        .getBoundingClientRect().height,
      backdropSurfaces: [...document.querySelectorAll("*")].filter(
        (e) => getComputedStyle(e).backdropFilter !== "none",
      ).length,
    }));
    const totals = samples.map((sample) => ({
      cpu: sample.reduce((n, m) => n + m.cpu, 0),
      memory: sample.reduce((n, m) => n + m.workingSetMB, 0),
    }));
    reports.push({
      mode,
      firstPageMs,
      records,
      frames,
      geometry,
      idleAverageCpu: totals.reduce((n, t) => n + t.cpu, 0) / totals.length,
      idlePeakCpu: Math.max(...totals.map((t) => t.cpu)),
      workingSetMB: totals.at(-1).memory,
      samples,
    });
    await page.screenshot({
      path: join(folder, `${mode}-${reports.length}.png`),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
}
const result = {
  notes: 10000,
  version: JSON.parse(readFileSync("package.json", "utf8")).version,
  runtime: process.version,
  machine: {
    platform: platform(),
    osRelease: release(),
    cpu: cpus()[0].model,
    logicalCpus: cpus().length,
    ramGiB: totalmem() / 1024 ** 3,
  },
  caveat:
    "Local development executable; app process CPU and working set, not GPU power or system fan measurements. Four warm-cache runs; not a cold boot benchmark.",
  reports,
};
writeFileSync(join(folder, "results.json"), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    { folder, ...result, reports: reports.map(({ samples, ...r }) => r) },
    null,
    2,
  ),
);
