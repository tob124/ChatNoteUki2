// Explicit opt-in: uses at most 3 Flash requests. Never writes or prints the key.
import { _electron as electron } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const key = process.env.DEEPSEEK_API_KEY;
if (!key) throw new Error("Set DEEPSEEK_API_KEY for this opt-in smoke check");
delete process.env.DEEPSEEK_API_KEY;
const folder = resolve(".local", `live-${Date.now()}`);
mkdirSync(folder, { recursive: true });
const app = await electron.launch({
  args: ["."],
  cwd: process.cwd(),
  env: { ...process.env, UKI_DATA_DIR: folder },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  const waitForNotes = async (count) => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const view = await page.evaluate(() => window.uki.view());
      if (
        view.notes.length === count &&
        ["done", "failed"].includes(view.notes.at(-1).status) &&
        view.aiStatus.startsWith("已处理")
      )
        return view;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Live check timed out; no automatic retry");
  };
  await page.evaluate(async (secret) => {
    const { settings } = await window.uki.view();
    await window.uki.saveSettings(
      {
        davUrl: settings.davUrl,
        davUser: "",
        directory: settings.directory,
        dailyInputLimit: 20000,
        dailyOutputLimit: 4000,
      },
      secret,
    );
  }, key);
  await page.evaluate(() =>
    window.uki.capture({
      raw: "我以前认为城市越密集越容易拥堵。现在想到，如果公共交通足够完善，高密度也许能缩短出行距离。我还没有证据支持这个判断。",
    }),
  );
  const first = await waitForNotes(1);
  if (first.notes[0].status !== "done")
    throw new Error(first.notes[0].error || "First note failed");
  await page.evaluate(() =>
    window.uki.capture({
      raw: "关于城市密度，我想先比较轨道交通容量与居民平均通勤时间，而不是只看人口密度。",
    }),
  );
  const second = await waitForNotes(2);
  if (second.notes[1].status !== "done")
    throw new Error(second.notes[1].error || "Second note failed");
  await page.evaluate(
    (thread) => window.uki.propose(thread, "deepseek-flash"),
    first.notes[0].threadId,
  );
  const result = await page.evaluate(() => window.uki.view());
  const report = {
    model: "deepseek-flash",
    calls: result.usage.length,
    input: result.usage.reduce((s, u) => s + u.input, 0),
    output: result.usage.reduce((s, u) => s + u.output, 0),
    titles: result.notes.map((n) => n.title),
    synopses: result.notes.map((n) => n.synopsis),
    threadReused: result.notes[0].threadId === result.notes[1].threadId,
    proposalCount: result.proposals.length,
    cognitionUnchanged: result.cognitions.length === 0,
  };
  if (
    report.calls > 3 ||
    report.input > 20000 ||
    report.output > 4000 ||
    !report.cognitionUnchanged
  )
    throw new Error("Smoke check exceeded constraints");
  writeFileSync(join(folder, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  await app.close();
}
