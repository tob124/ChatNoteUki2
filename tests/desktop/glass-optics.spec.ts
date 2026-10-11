import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

// Use the PNG codec already shipped by Playwright, only in this rendering test.
const require = createRequire(import.meta.url);
const { PNG } = require(
  join(
    dirname(require.resolve("playwright-core/package.json")),
    "lib/utilsBundle.js",
  ),
);
const tools =
  ".thread-workbench .analysis-task > button, .thread-workbench .research-controls > button, .thread-workbench .analysis-options > summary, .thread-workbench .question-actions > summary";

test("toolbar stays aligned across popovers and glass refracts the live backdrop only at its rim", async () => {
  const folder = resolve(".local", `glass-optics-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const app = await electron.launch({
    executablePath: process.env.UKI_TEST_EXE,
    args: process.env.UKI_TEST_EXE ? [] : ["."],
    cwd: process.cwd(),
    env: { ...process.env, UKI_DATA_DIR: folder },
  });
  try {
    const page = await app.firstWindow();
    await page.getByLabel("写下想法").waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 900 }),
    );
    await page.evaluate(async () => {
      const threadId = await window.uki.thread({
        title: "记录与观察",
        description: "",
        parentId: null,
      });
      const id = await window.uki.capture({
        raw: "界面应当让人专注于想法，工具在需要时才出现。",
        threadId,
      });
      await window.uki.cancelAi(id, "note");
    });
    await page.getByRole("button", { name: "记录与观察", exact: true }).click();
    const positions = () =>
      page.locator(tools).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { y: r.y, height: r.height, right: r.right };
        }),
      );
    const before = await positions();
    expect(before).toHaveLength(6);
    expect(
      Math.max(...before.map((r) => r.y)) - Math.min(...before.map((r) => r.y)),
    ).toBeLessThan(1);
    expect(before.every((r) => r.height === 32)).toBe(true);
    await page.locator(".analysis-options summary").focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("本次主动分析使用 Pro").check();
    expect(await positions()).toEqual(before);
    await page.keyboard.press("Escape");
    await expect(page.locator(".analysis-options")).not.toHaveAttribute(
      "open",
      "",
    );
    await page
      .locator(".composer[data-lens=ready] feImage")
      .waitFor({ state: "attached" });
    await page.waitForTimeout(180);
    const map = await page.locator(".composer feImage").getAttribute("href");
    expect(map).toMatch(/^data:image\/png;base64,/);
    await page.waitForTimeout(150);
    expect(await page.locator(".composer feImage").getAttribute("href")).toBe(
      map,
    );

    // Known monochrome backdrop isolates true RGB refraction from decorative tints.
    await page.evaluate(() => {
      const box = document.querySelector(".composer")!.getBoundingClientRect();
      const pattern = document.createElement("div");
      pattern.id = "optics-pattern";
      pattern.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;z-index:2;pointer-events:none;background:repeating-linear-gradient(45deg,#111 0px 2px,#fff 2px 9px)`;
      document.body.append(pattern);
      const style = document.createElement("style");
      style.id = "optics-style";
      style.textContent =
        ".composer{background:transparent!important;box-shadow:none!important;border-color:transparent!important}.composer::after{display:none}.composer > :not(svg){visibility:hidden}";
      document.head.append(style);
    });
    const refracted = PNG.sync.read(
      await page
        .locator(".composer")
        .screenshot({ path: join(folder, "refracted.png") }),
    );
    await page
      .locator(".composer feDisplacementMap")
      .evaluateAll((els) => els.forEach((el) => el.setAttribute("scale", "0")));
    const flat = PNG.sync.read(
      await page
        .locator(".composer")
        .screenshot({ path: join(folder, "flat.png") }),
    );
    let edge = 0,
      edgeCount = 0,
      center = 0,
      centerCount = 0,
      dispersion = 0;
    for (let y = 0; y < refracted.height; y++)
      for (let x = 40; x < refracted.width - 40; x++) {
        const i = (y * refracted.width + x) * 4;
        const delta =
          [0, 1, 2].reduce(
            (sum, c) =>
              sum + Math.abs(refracted.data[i + c] - flat.data[i + c]),
            0,
          ) / 3;
        if (y < 16 || y > refracted.height - 16) {
          edge += delta;
          edgeCount++;
          const rgb = [...refracted.data.subarray(i, i + 3)];
          if (Math.max(...rgb) - Math.min(...rgb) > 30) dispersion++;
        } else if (y > 35 && y < refracted.height - 35) {
          center += delta;
          centerCount++;
        }
      }
    expect(edge / edgeCount).toBeGreaterThan(30);
    expect(center / centerCount).toBeLessThan(3);
    expect(dispersion).toBeGreaterThan(500);
    await page.evaluate(() => {
      document.getElementById("optics-pattern")?.remove();
      document.getElementById("optics-style")?.remove();
      document
        .querySelectorAll(".composer feDisplacementMap")
        .forEach((el, i) => el.setAttribute("scale", String(-20 - i * 3)));
    });
    await page.screenshot({
      path: join(folder, "workspace.png"),
      animations: "disabled",
    });
    await page.emulateMedia({ forcedColors: "active" });
    await expect(page.locator(".composer")).not.toHaveAttribute(
      "data-lens",
      "ready",
    );
    expect(
      await page
        .locator(".composer")
        .evaluate((el) => getComputedStyle(el).backdropFilter),
    ).toBe("none");
    await page.emulateMedia({ forcedColors: "none" });
    await expect(page.locator(".composer")).toHaveAttribute(
      "data-lens",
      "ready",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 900, height: 650 }),
    );
    await expect
      .poll(async () => page.locator(".composer feImage").getAttribute("href"))
      .not.toBe(map);
    const narrow = await positions();
    expect(narrow.every((r) => r.height === 32)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(folder, "narrow.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});
