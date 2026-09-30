import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

test("empty-cloud ownership repair and automatic upload/inbox import with persisted controls", async () => {
  const folder = resolve(".local", `sync-desktop-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, UKI_DATA_DIR: folder },
  });
  try {
    const page = await app.firstWindow();
    await page.getByLabel("写下想法").fill("本地记录保留并自动上传");
    await page.getByRole("button", { name: "保存想法" }).click();
    await expect(page.locator(".record")).toHaveCount(1);
    await app.evaluate(() => {
      const files = new Map<string, string>();
      const versions = new Map<string, number>();
      files.set(
        "manifest.json",
        JSON.stringify({
          schemaVersion: 1,
          deviceId: crypto.randomUUID(),
          generation: 1,
          batches: [],
          updatedAt: new Date().toISOString(),
        }),
      );
      files.set("inbox.txt", "");
      // Accelerate only the app's long sync/debounce timers; no real network or AI.
      const originalTimer = globalThis.setTimeout;
      globalThis.setTimeout = ((
        fn: (...args: any[]) => void,
        delay?: number,
        ...args: any[]
      ) =>
        originalTimer(
          fn,
          delay === 60000 ? 200 : delay === 3000 ? 50 : delay,
          ...args,
        )) as typeof setTimeout;
      const state = {
        files,
        uploads: 0,
        setInbox(value: string) {
          files.set("inbox.txt", value);
          versions.set("inbox.txt", (versions.get("inbox.txt") ?? 0) + 1);
        },
      };
      (globalThis as any).davTest = state;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.hostname !== "mock.invalid")
          throw new Error("Unexpected test network request");
        const path = url.pathname
          .replace("/dav/ChatNoteUki/", "")
          .replace(/\/$/, "");
        const method = init?.method ?? "GET";
        const headers = new Headers(init?.headers);
        const tag = () => `"test-${versions.get(path) ?? 0}"`;
        const reply = (status: number, body = files.get(path) ?? "") =>
          new Response(status === 204 ? null : body, {
            status,
            headers: files.has(path) ? { ETag: tag() } : {},
          });
        if (method === "MKCOL") return reply(201);
        if (method === "GET") return reply(files.has(path) ? 200 : 404);
        if (method === "DELETE") {
          files.delete(path);
          return reply(204);
        }
        if (method !== "PUT") return reply(405);
        if (headers.get("If-None-Match") === "*" && files.has(path))
          return reply(412);
        if (headers.get("If-Match") && headers.get("If-Match") !== tag())
          return reply(412);
        files.set(
          path,
          typeof init?.body === "string"
            ? init.body
            : Buffer.from(init?.body as Uint8Array).toString("utf8"),
        );
        versions.set(path, (versions.get(path) ?? 0) + 1);
        if (path.startsWith("events/")) state.uploads++;
        return reply(201, "");
      };
    });
    await page.getByRole("button", { name: "设置与数据" }).click();
    await expect(page.getByLabel("自动同步", { exact: true })).toBeChecked();
    await page.getByLabel("服务器地址").fill("https://mock.invalid/dav/");
    await page.getByLabel("坚果云账户").fill("test-only");
    await page.getByLabel("第三方应用密码").fill("test-only-password");
    await page.getByRole("button", { name: "保存设置" }).click();
    await expect
      .poll(
        async () => (await page.evaluate(() => window.uki.view())).pendingSync,
      )
      .toBe(0);
    expect(
      await app.evaluate(() => (globalThis as any).davTest.uploads),
    ).toBeGreaterThan(0);
    await app.evaluate(() =>
      (globalThis as any).davTest.setInbox("手机自动导入\n\n手机第二条"),
    );
    await expect(page.locator(".record")).toHaveCount(3);
    await expect
      .poll(
        async () =>
          await app.evaluate(() =>
            (globalThis as any).davTest.files.get("inbox.txt"),
          ),
      )
      .toBe("");
    expect(
      (await page.evaluate(() => window.uki.view())).notes.map((n) => n.raw),
    ).toEqual(["本地记录保留并自动上传", "手机自动导入", "手机第二条"]);
    await page.getByRole("button", { name: "设置与数据" }).click();
    await page.getByLabel("自动同步", { exact: true }).uncheck();
    await page.getByRole("button", { name: "保存设置" }).click();
    expect(
      JSON.parse(readFileSync(join(folder, "credentials.json"), "utf8"))
        .settings.autoSync,
    ).toBe(false);
    await app.evaluate(() =>
      (globalThis as any).davTest.setInbox("手动同步记录"),
    );
    await page.waitForTimeout(400);
    await expect(page.locator(".record")).toHaveCount(3);
    await page.getByRole("button", { name: "同步", exact: true }).click();
    await expect(page.locator(".record")).toHaveCount(4);
  } finally {
    await app.close();
  }
});
