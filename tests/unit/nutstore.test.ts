import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Store } from "../../electron/store";
import { settingsSchema } from "../../src/shared";
import { SyncEngine, WebDav } from "../../electron/webdav";

const stores: Store[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.unstubAllGlobals();
});
function nutstore(ignoreMoveProtection = false) {
  const files = new Map<string, string>();
  const calls: {
    method: string;
    path: string;
    ifMatch: string | null;
    overwrite: string | null;
  }[] = [];
  const etag = (path: string) =>
    createHash("md5")
      .update(files.get(path) ?? "")
      .digest("base64url");
  const pathOf = (url: string) =>
    new URL(url).pathname.replace("/dav/ChatNoteUki/", "");
  vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit) => {
    const path = pathOf(String(url));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    calls.push({
      method,
      path,
      ifMatch: headers.get("If-Match"),
      overwrite: headers.get("Overwrite"),
    });
    const response = (status: number, value = "") =>
      new Response(status === 204 ? null : value, {
        status,
        headers: files.has(path) ? { ETag: etag(path) } : {},
      });
    if (method === "MKCOL") return response(201);
    if (method === "GET")
      return response(files.has(path) ? 200 : 404, files.get(path));
    if (method === "DELETE") {
      files.delete(path);
      return response(204);
    }
    if (method === "PUT") {
      // Faithfully reproduce the live service: bare ETag required, If-None-Match:* ignored.
      if (headers.get("If-Match") && headers.get("If-Match") !== etag(path))
        return response(412);
      const existed = files.has(path);
      files.set(
        path,
        typeof init.body === "string"
          ? init.body
          : Buffer.from(init.body as Uint8Array).toString("utf8"),
      );
      return response(existed ? 204 : 201);
    }
    if (method === "MOVE") {
      const destination = pathOf(headers.get("Destination")!);
      if (!files.has(path)) return response(404);
      if (
        files.has(destination) &&
        headers.get("Overwrite") === "F" &&
        !ignoreMoveProtection
      )
        return response(409);
      files.set(destination, files.get(path)!);
      files.delete(path);
      return response(201);
    }
    return response(405);
  });
  return { files, calls, etag };
}
const client = () =>
  new WebDav(settingsSchema.parse({ davUser: "test-only" }), "test-only");
it("adapts Nutstore bare validators and create-only MOVE without overwriting an existing file", async () => {
  const server = nutstore();
  const dav = client();
  server.files.set("inbox.txt", "手机原文");
  const old = await dav.request("GET", "inbox.txt");
  expect(old.etag).toBe(`"${server.etag("inbox.txt")}"`);
  const duplicate = await dav.request("PUT", "inbox.txt", "不能覆盖", {
    "If-None-Match": "*",
  });
  expect(duplicate.status).toBe(412);
  expect(server.files.get("inbox.txt")).toBe("手机原文");
  const update = await dav.request("PUT", "inbox.txt", "已更新", {
    "If-Match": old.etag!,
  });
  expect(update.status).toBe(204);
  const stale = await dav.request("PUT", "inbox.txt", "过期写入", {
    "If-Match": old.etag!,
  });
  expect(stale.status).toBe(412);
  expect(server.files.get("inbox.txt")).toBe("已更新");
  expect(
    server.calls.some((c) => c.method === "MOVE" && c.overwrite === "F"),
  ).toBe(true);
  expect(
    [...server.files.keys()].some((path) => path.includes(".uki-create-")),
  ).toBe(false);
});
it("imports, archives, clears and restores with actual Nutstore HTTP quirks", async () => {
  const server = nutstore();
  server.files.set("inbox.txt", "第一条\r\n仍是第一条\r\n\r\n第二条");
  const a = new Store(":memory:"),
    b = new Store(":memory:");
  stores.push(a, b);
  await new SyncEngine(a, client()).sync();
  expect(a.snapshot().notes.map((n) => n.raw)).toEqual([
    "第一条\r\n仍是第一条",
    "第二条",
  ]);
  expect(server.files.get("inbox.txt")).toBe("");
  await new SyncEngine(b, client()).restore();
  expect(b.snapshot()).toEqual(a.snapshot());
});
it("retains inbox if MOVE Overwrite:F is ignored", async () => {
  const server = nutstore(true);
  server.files.set("inbox.txt", "不能删除的原文");
  const store = new Store(":memory:");
  stores.push(store);
  const engine = new SyncEngine(store, client());
  await engine.sync();
  expect(server.files.get("inbox.txt")).toBe("不能删除的原文");
  expect(engine.status).toContain("不支持可靠条件写入");
});
