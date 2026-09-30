import { createHash } from "node:crypto";
import type { Dav, DavResponse } from "../../electron/webdav";
export class FakeDav implements Dav {
  files = new Map<string, string>();
  calls: { method: string; path: string; headers: Record<string, string> }[] =
    [];
  conditional = true;
  weakInbox = false;
  failPath: string | null = null;
  appendOnClear: string | null = null;
  loseClearResponse = false;
  loseManifestResponse = false;
  beforeClear: (() => void) | null = null;
  etag(path: string) {
    return `"${createHash("sha256")
      .update(this.files.get(path) ?? "")
      .digest("hex")}"`;
  }
  async request(
    method: string,
    path: string,
    body?: string | Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<DavResponse> {
    this.calls.push({ method, path, headers });
    if (this.failPath === path && method === "PUT") throw new Error("模拟断网");
    const response = (status: number, value = this.files.get(path) ?? "") => ({
      status,
      etag: this.files.has(path)
        ? (path === "inbox.txt" && this.weakInbox ? "W/" : "") + this.etag(path)
        : null,
      body: Buffer.from(value),
    });
    if (method === "MKCOL") return response(201);
    if (method === "GET") return response(this.files.has(path) ? 200 : 404);
    if (method === "DELETE") {
      this.files.delete(path);
      return response(204, "");
    }
    if (method !== "PUT") return response(405);
    if (path === "inbox.txt" && body === "" && headers["If-Match"]) {
      this.beforeClear?.();
      if (this.appendOnClear !== null) {
        this.files.set(path, this.files.get(path)! + this.appendOnClear);
        this.appendOnClear = null;
      }
    }
    if (
      this.conditional &&
      headers["If-None-Match"] === "*" &&
      this.files.has(path)
    )
      return response(412);
    if (
      this.conditional &&
      headers["If-Match"] &&
      headers["If-Match"] !== this.etag(path)
    )
      return response(412);
    this.files.set(
      path,
      typeof body === "string"
        ? body
        : Buffer.from(body ?? []).toString("utf8"),
    );
    if (
      path === "inbox.txt" &&
      body === "" &&
      headers["If-Match"] &&
      this.loseClearResponse
    ) {
      this.loseClearResponse = false;
      throw new Error("模拟清空响应丢失");
    }
    if (path === "manifest.json" && this.loseManifestResponse) {
      this.loseManifestResponse = false;
      throw new Error("模拟清单响应丢失");
    }
    return response(201, "");
  }
}
