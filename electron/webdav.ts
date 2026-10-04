import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Settings, ThoughtEvent } from "../src/shared";
import { decodeInbox, observeInbox } from "./inbox";
import { Store, validateEvent } from "./store";
import { redactEvent } from "./redaction";

export interface DavResponse {
  status: number;
  etag: string | null;
  body: Uint8Array;
}
export interface Dav {
  request(
    method: string,
    path: string,
    body?: string | Uint8Array,
    headers?: Record<string, string>,
  ): Promise<DavResponse>;
}
export class WebDav implements Dav {
  constructor(
    private settings: Settings,
    private password: string,
    private observe?: (request: import("../src/shared").SyncDiagnostic) => void,
  ) {}
  async request(
    method: string,
    path: string,
    body?: string | Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<DavResponse> {
    const base = new URL(
      this.settings.davUrl.endsWith("/")
        ? this.settings.davUrl
        : this.settings.davUrl + "/",
    );
    if (base.protocol !== "https:" || base.username || base.password)
      throw new Error("仅支持 HTTPS WebDAV");
    const pieces = [
      ...this.settings.directory.split("/"),
      ...path.split("/"),
    ].filter(Boolean);
    if (pieces.some((p) => p === "." || p === ".."))
      throw new Error("目录路径无效");
    const url = new URL(
      pieces.map(encodeURIComponent).join("/") +
        (method === "MKCOL" ? "/" : ""),
      base,
    );
    const nutstore = base.hostname === "dav.jianguoyun.com";
    // Nutstore ignores If-None-Match: *. A unique staged upload followed by
    // MOVE Overwrite:F provides verified create-only semantics instead.
    if (nutstore && method === "PUT" && headers["If-None-Match"] === "*") {
      const prefix = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/") + 1)
        : "";
      const staging = `${prefix}.uki-create-${randomUUID()}.tmp`;
      const { "If-None-Match": _condition, ...uploadHeaders } = headers;
      let owned = false;
      try {
        const uploaded = await this.request(
          "PUT",
          staging,
          body,
          uploadHeaders,
        );
        if (uploaded.status < 200 || uploaded.status >= 300) return uploaded;
        owned = true;
        const moved = await this.request("MOVE", staging, undefined, {
          Destination: url.href,
          Overwrite: "F",
        });
        // Nutstore reports destination-exists as 409 rather than 412.
        if (moved.status === 409) {
          const existing = await this.request("GET", path);
          if (existing.status === 200)
            return { status: 412, etag: existing.etag, body: new Uint8Array() };
        }
        return moved;
      } finally {
        if (owned) await this.request("DELETE", staging).catch(() => {});
      }
    }
    const wireHeaders = { ...headers };
    // Nutstore sends an unquoted strong content validator and requires that exact
    // wire value in If-Match. Keep a canonical quoted validator inside the app.
    if (
      nutstore &&
      /^"[A-Za-z0-9_-]{16,128}"$/.test(wireHeaders["If-Match"] ?? "")
    ) {
      wireHeaders["If-Match"] = wireHeaders["If-Match"].slice(1, -1);
    }
    const started = Date.now();
    let observedStatus = 0;
    try {
      const response = await fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.settings.davUser}:${this.password}`).toString("base64")}`,
          ...(body !== undefined
            ? { "Content-Type": "application/octet-stream" }
            : {}),
          ...wireHeaders,
        },
        body:
          body === undefined
            ? undefined
            : typeof body === "string"
              ? body
              : Buffer.from(body),
      });
      observedStatus = response.status;
      if (response.status === 401 || response.status === 403)
        throw new Error("坚果云授权失败，请检查账户和第三方应用密码");
      if (response.status === 429)
        throw new Error("坚果云请求受限，请稍后同步");
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.length;
          if (size > 16 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("云端文件超过 16 MB 安全读取上限");
          }
          chunks.push(result.value);
        }
      }
      const tag = response.headers.get("etag");
      const etag =
        nutstore && tag && /^[A-Za-z0-9_-]{16,128}$/.test(tag)
          ? `"${tag}"`
          : tag;
      return {
        status: response.status,
        etag,
        body: Buffer.concat(chunks),
      };
    } finally {
      this.observe?.({
        method,
        path,
        status: observedStatus,
        duration: Date.now() - started,
        at: new Date().toISOString(),
      });
    }
  }
}
const descriptor = z.object({
  file: z.string().regex(/^events\/[a-f0-9-]+_[a-f0-9-]+\.json$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestSchema = z.object({
  schemaVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  deviceId: z.string().uuid(),
  generation: z.number().int().nonnegative(),
  batches: z.array(descriptor).max(100000),
  updatedAt: z.string().datetime(),
});
type Manifest = z.infer<typeof manifestSchema>;
const eventFileSchema = z.object({
  schemaVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  events: z.array(z.unknown()).max(100),
});
const text = (r: DavResponse) =>
  new TextDecoder("utf-8", { fatal: true }).decode(r.body);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const strongEtag = (etag: string | null): etag is string =>
  !!etag && /^"[^"\r\n]*"$/.test(etag);
const ok = (r: DavResponse, action: string) => {
  if (r.status < 200 || r.status >= 300)
    throw new Error(`${action}失败（HTTP ${r.status}），未清空 inbox`);
};

export class SyncEngine {
  status = "尚未配置坚果云";
  lastSucceeded = false;
  private busy = false;
  private capability: boolean | null = null;
  private prepared = false;
  private checkedAt = 0;
  private cacheId: string;
  constructor(
    private store: Store,
    private dav: Dav,
    private changed: () => void = () => {},
    cacheKey = "default-adapter-v2",
  ) {
    this.cacheId = "davCapability:" + hash(cacheKey);
    try {
      const cached = JSON.parse(store.getMeta(this.cacheId) ?? "null");
      if (cached && Date.now() - cached.checkedAt < 30 * 86400000) {
        this.prepared = cached.prepared;
        this.capability = cached.capability;
        this.checkedAt = cached.checkedAt;
      }
    } catch {
      /* invalid cache is disposable */
    }
  }
  private cache() {
    this.store.setMeta(
      this.cacheId,
      JSON.stringify({
        prepared: this.prepared,
        capability: this.capability,
        checkedAt: this.checkedAt,
      }),
    );
  }
  private invalidate() {
    this.capability = null;
    this.prepared = false;
    this.checkedAt = 0;
    this.cache();
  }
  async prepare() {
    if (this.prepared) return;
    for (const path of ["", "events", "imports"]) {
      const r = await this.dav.request("MKCOL", path);
      if (![201, 405].includes(r.status))
        throw new Error(`创建云端目录失败（HTTP ${r.status}）`);
    }
    this.prepared = true;
  }
  private async manifest(): Promise<{
    value: Manifest | null;
    etag: string | null;
  }> {
    const r = await this.dav.request("GET", "manifest.json");
    if (r.status === 404) return { value: null, etag: null };
    ok(r, "读取恢复清单");
    const decoded = JSON.parse(text(r));
    if (![1, 2, 3, 4, 5].includes(decoded.schemaVersion))
      throw new Error("云端资料格式不受此版本支持，请升级软件后再同步");
    return { value: manifestSchema.parse(decoded), etag: r.etag };
  }
  private async probe(): Promise<boolean> {
    if (this.checkedAt && Date.now() - this.checkedAt >= 30 * 86400000)
      this.capability = null;
    if (this.capability !== null) return this.capability;
    await this.prepare();
    const path = `.condition-probe-${randomUUID()}.txt`;
    let latestEtag: string | null = null;
    try {
      const created = await this.dav.request("PUT", path, "original", {
        "If-None-Match": "*",
      });
      ok(created, "验证条件写入");
      const first = await this.dav.request("GET", path);
      ok(first, "读取条件测试");
      latestEtag = first.etag;
      if (!strongEtag(first.etag)) return (this.capability = false);
      const invalid = await this.dav.request(
        "PUT",
        path,
        "must-not-be-written",
        { "If-Match": `"invalid-${randomUUID()}"` },
      );
      const unchanged = await this.dav.request("GET", path);
      if (invalid.status !== 412 || text(unchanged) !== "original")
        return (this.capability = false);
      const duplicate = await this.dav.request(
        "PUT",
        path,
        "must-not-be-created",
        { "If-None-Match": "*" },
      );
      if (duplicate.status !== 412) return (this.capability = false);
      const updated = await this.dav.request("PUT", path, "updated", {
        "If-Match": first.etag,
      });
      ok(updated, "验证条件更新");
      const verify = await this.dav.request("GET", path);
      latestEtag = verify.etag;
      return (this.capability =
        verify.status === 200 &&
        text(verify) === "updated" &&
        strongEtag(verify.etag));
    } finally {
      this.checkedAt = Date.now();
      this.cache();
      // Probe path is unique to this invocation; cleanup never targets user data.
      await this.dav
        .request(
          "DELETE",
          path,
          undefined,
          strongEtag(latestEtag) ? { "If-Match": latestEtag } : {},
        )
        .catch(() => {});
    }
  }
  private assertOwner(manifest: Manifest | null) {
    if (manifest && manifest.deviceId !== this.store.getMeta("deviceId"))
      throw new Error(
        "云端思想库由另一台 Windows 维护。请在空白本地库执行「从云端恢复并接管」。",
      );
    if (!manifest && Number(this.store.getMeta("syncedSeq") ?? 0) > 0)
      throw new Error("云端恢复清单缺失，暂停同步以保护已有数据");
  }
  private async ensureOwner(remote: {
    value: Manifest | null;
    etag: string | null;
  }) {
    if (
      remote.value &&
      remote.value.deviceId !== this.store.getMeta("deviceId") &&
      remote.value.batches.length === 0 &&
      Number(this.store.getMeta("syncedSeq") ?? 0) === 0
    ) {
      // A setup-only empty manifest contains no thoughts to recover. Claim it
      // with CAS so reinstalling or first using another local profile is safe.
      if (!strongEtag(remote.etag) || !(await this.probe()))
        throw new Error("空云端库缺少可靠条件写入，无法安全初始化同步");
      const next: Manifest = {
        ...remote.value,
        deviceId: this.store.getMeta("deviceId")!,
        generation: remote.value.generation + 1,
        updatedAt: new Date().toISOString(),
      };
      const result = await this.dav.request(
        "PUT",
        "manifest.json",
        JSON.stringify(next),
        {
          "If-Match": remote.etag,
        },
      );
      ok(result, "绑定空云端库");
      const confirmed = await this.manifest();
      if (JSON.stringify(confirmed.value) !== JSON.stringify(next))
        throw new Error("空云端库绑定结果无法确认，保留本地数据");
      remote = confirmed;
      this.store.setMeta("manifestHash", hash(JSON.stringify(next)));
    }
    this.assertOwner(remote.value);
    return remote;
  }
  private async publish(remote: {
    value: Manifest | null;
    etag: string | null;
  }): Promise<{ value: Manifest; etag: string }> {
    const localSeq = Number(this.store.getMeta("syncedSeq") ?? 0);
    const rows = this.store.eventsAfter(localSeq);
    const batches = [...(remote.value?.batches ?? [])];
    if (
      remote.value &&
      this.store.getMeta("manifestHash") &&
      this.store.getMeta("manifestHash") !== hash(JSON.stringify(remote.value))
    ) {
      // A lost manifest response may have already published exactly these local events.
      const known = new Map(
        this.store
          .eventsAfter()
          .map((r) => [r.event.id, JSON.stringify(r.event)]),
      );
      const remoteEvents = await this.readEvents(remote.value);
      if (
        remoteEvents.some(
          (e) =>
            known.get(e.id) !==
            JSON.stringify(
              validateEvent(redactEvent(e, this.store.purgedIds())),
            ),
        )
      )
        throw new Error("云端出现本机没有的事件，请先核对，未覆盖恢复清单");
    }
    for (let i = 0; i < rows.length;) {
      const chunk: typeof rows = [];
      let bytes = 0;
      while (i < rows.length && chunk.length < 100) {
        const size = Buffer.byteLength(JSON.stringify(rows[i].event));
        if (size > 15 * 1024 * 1024)
          throw new Error("单条云端事件超过安全大小上限，备份暂停");
        if (chunk.length && bytes + size > 8 * 1024 * 1024) break;
        chunk.push(rows[i++]);
        bytes += size;
      }
      const file = `events/${chunk[0].event.id}_${chunk.at(-1)!.event.id}.json`;
      const content = JSON.stringify({
        schemaVersion: 5,
        events: chunk.map((r) => r.event),
      });
      const digest = hash(content);
      if (!batches.some((b) => b.file === file)) {
        const put = await this.dav.request("PUT", file, content, {
          "If-None-Match": "*",
        });
        if (put.status === 412) {
          const existing = await this.dav.request("GET", file);
          ok(existing, "验证事件文件");
          if (hash(text(existing)) !== digest)
            throw new Error("云端不可变事件文件内容冲突");
        } else ok(put, "上传思想事件");
        batches.push({ file, sha256: digest });
      }
    }
    if (!rows.length && remote.value && strongEtag(remote.etag))
      return this.maintainPurges({ value: remote.value, etag: remote.etag });
    const next: Manifest = {
      schemaVersion: 5,
      deviceId: this.store.getMeta("deviceId")!,
      generation: (remote.value?.generation ?? 0) + 1,
      batches,
      updatedAt: new Date().toISOString(),
    };
    if (remote.value && !strongEtag(remote.etag))
      throw new Error("恢复清单缺少强 ETag，暂停更新");
    const updated = await this.dav.request(
      "PUT",
      "manifest.json",
      JSON.stringify(next),
      remote.value ? { "If-Match": remote.etag! } : { "If-None-Match": "*" },
    );
    ok(updated, "发布恢复清单");
    const verify = await this.manifest();
    if (
      !verify.value ||
      JSON.stringify(verify.value) !== JSON.stringify(next) ||
      !strongEtag(verify.etag)
    ) {
      this.invalidate();
      throw new Error("恢复清单发布结果无法确认，保留待同步任务");
    }
    this.store.setMeta("syncedSeq", String(rows.at(-1)?.seq ?? localSeq));
    this.store.setMeta("manifestHash", hash(JSON.stringify(next)));
    return this.maintainPurges({ value: next, etag: verify.etag });
  }
  private archivePath(batch: import("../src/shared").InboxBatch) {
    return `imports/${batch.id}${batch.redacted ? "-redacted-" + hash(batch.snapshot).slice(0, 16) : ""}.txt`;
  }
  private async maintainPurges(remote: {
    value: Manifest;
    etag: string;
  }): Promise<{ value: Manifest; etag: string }> {
    if (!this.store.getMeta("purgePending")) return remote;
    this.assertOwner(remote.value);
    const ids = this.store.purgedIds();
    const garbage = new Set<string>(
      JSON.parse(this.store.getMeta("purgeGarbage") ?? "[]"),
    );
    const remember = () =>
      this.store.setMeta("purgeGarbage", JSON.stringify([...garbage]));
    const batches = [] as Manifest["batches"];
    let changed = false;
    for (const batch of remote.value.batches) {
      const source = await this.dav.request("GET", batch.file);
      ok(source, "读取待维护事件");
      if (hash(text(source)) !== batch.sha256)
        throw new Error("待维护云端批次校验失败，未清理原文件");
      const parsed = eventFileSchema.parse(JSON.parse(text(source)));
      const events = parsed.events.map((e) =>
        redactEvent(validateEvent(e), ids),
      );
      const before = JSON.stringify(parsed.events),
        after = JSON.stringify(events);
      if (before === after) {
        batches.push(batch);
        continue;
      }
      const content = JSON.stringify({ schemaVersion: 5, events }),
        digest = hash(content);
      const stable =
        digest.slice(0, 8) +
        "-" +
        digest.slice(8, 12) +
        "-" +
        digest.slice(12, 16) +
        "-" +
        digest.slice(16, 20) +
        "-" +
        digest.slice(20, 32);
      const file = `events/${(events[0] as ThoughtEvent).id}_${stable}.json`;
      const put = await this.dav.request("PUT", file, content, {
        "If-None-Match": "*",
      });
      if (put.status !== 412) ok(put, "保存替代事件批次");
      const check = await this.dav.request("GET", file);
      ok(check, "核对替代事件批次");
      if (hash(text(check)) !== digest)
        throw new Error("替代批次校验失败，未发布清理");
      batches.push({ file, sha256: digest });
      garbage.add(batch.file);
      remember();
      changed = true;
    }
    for (const batch of this.store
      .all<import("../src/shared").InboxBatch>("batches")
      .filter((b) => b.redacted)) {
      const path = this.archivePath(batch);
      const put = await this.dav.request("PUT", path, batch.snapshot, {
        "If-None-Match": "*",
      });
      if (put.status !== 412) ok(put, "保存脱敏导入归档");
      const check = await this.dav.request("GET", path);
      ok(check, "核对导入替代归档");
      if (text(check) !== batch.snapshot)
        throw new Error("导入替代归档校验失败");
      garbage.add(`imports/${batch.id}.txt`);
      remember();
    }
    if (changed) {
      const next = {
        ...remote.value,
        schemaVersion: 5 as const,
        generation: remote.value.generation + 1,
        batches,
        updatedAt: new Date().toISOString(),
      };
      const put = await this.dav.request(
        "PUT",
        "manifest.json",
        JSON.stringify(next),
        { "If-Match": remote.etag },
      );
      ok(put, "条件发布删除维护清单");
      const confirmed = await this.manifest();
      if (
        JSON.stringify(confirmed.value) !== JSON.stringify(next) ||
        !strongEtag(confirmed.etag)
      )
        throw new Error("删除维护发布结果待核对，原文件尚未清理");
      remote = { value: next, etag: confirmed.etag };
      this.store.setMeta("manifestHash", hash(JSON.stringify(next)));
    }
    // Never delete anything still referenced by the confirmed manifest.
    for (const file of garbage) {
      if (remote.value.batches.some((b) => b.file === file)) continue;
      const old = await this.dav.request("GET", file);
      if (old.status !== 404) {
        ok(old, "读取旧批次待清理");
        if (!strongEtag(old.etag))
          throw new Error("旧批次缺少强 ETag，保留待维护任务");
        const removed = await this.dav.request("DELETE", file, undefined, {
          "If-Match": old.etag,
        });
        if (removed.status !== 404) ok(removed, "清理已替代旧批次");
      }
      garbage.delete(file);
      remember();
    }
    if (!garbage.size) this.store.setMeta("purgePending", "");
    return remote;
  }
  private clearObserved() {
    this.store.appendMany(
      this.store
        .activeBatches()
        .map((b) => this.store.event("inbox.cleared", { id: b.id })),
    );
  }
  async backup() {
    if (this.busy) return;
    this.busy = true;
    this.lastSucceeded = false;
    try {
      if (
        this.store.latestSeq() ===
          Number(this.store.getMeta("syncedSeq") ?? 0) &&
        this.store.getMeta("manifestHash") &&
        !this.store.getMeta("purgePending")
      ) {
        this.status = "没有待上传变化";
        this.lastSucceeded = true;
        return;
      }
      await this.prepare();
      const remote = await this.ensureOwner(await this.manifest());
      if (!(await this.probe())) {
        this.status = "WebDAV 条件写入验证未通过，备份暂停";
        return;
      }
      await this.publish(remote);
      this.status = "思想数据已备份";
      this.lastSucceeded = true;
    } catch (e) {
      if (e instanceof Error && /HTTP (404|405)|条件.*异常/.test(e.message))
        this.invalidate();
      this.status = safeSyncError(e);
      throw new Error(this.status);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async sync() {
    if (this.busy) throw new Error("同步正在进行");
    this.busy = true;
    this.lastSucceeded = false;
    this.status = "正在读取手机输入";
    this.changed();
    try {
      let remote = await this.ensureOwner(await this.manifest());
      let inbox = await this.dav.request("GET", "inbox.txt");
      if (inbox.status === 404) {
        await this.prepare();
        const create = await this.dav.request("PUT", "inbox.txt", "", {
          "If-None-Match": "*",
        });
        if (create.status !== 412) ok(create, "创建 inbox");
        inbox = await this.dav.request("GET", "inbox.txt");
      }
      ok(inbox, "读取 inbox");
      let raw = decodeInbox(inbox.body);
      let batch = observeInbox(this.store, raw, inbox.etag);
      this.changed();
      if (!batch && this.store.activeBatches().length > 0) this.clearObserved();
      if (batch) {
        await this.prepare();
        const archived = await this.dav.request(
          "PUT",
          this.archivePath(batch),
          batch.snapshot,
          { "If-None-Match": "*" },
        );
        if (archived.status === 412) {
          const existing = await this.dav.request(
            "GET",
            this.archivePath(batch),
          );
          ok(existing, "读取原文归档");
          if (text(existing) !== batch.snapshot)
            throw new Error("原文归档内容冲突");
        } else ok(archived, "归档原文");
      }
      if (
        !this.store.getMeta("purgePending") &&
        !batch &&
        remote.value &&
        this.store.getMeta("manifestHash") ===
          hash(JSON.stringify(remote.value)) &&
        this.store.latestSeq() === Number(this.store.getMeta("syncedSeq") ?? 0)
      ) {
        this.status = "已检查，没有新内容，无文件写入";
        this.lastSucceeded = true;
        return;
      }
      if (!(await this.probe())) {
        this.status =
          "原文已保存；WebDAV 不支持可靠条件写入，自动清空及恢复清单更新暂停";
        return;
      }
      remote = await this.publish(remote);
      // Re-read on conflict, importing only an unambiguous appended suffix.
      for (let attempt = 0; batch && attempt < 3; attempt++) {
        if (!strongEtag(inbox.etag)) {
          this.status = "已导入并备份；inbox 缺少强 ETag，未清空";
          return;
        }
        const clear = await this.dav.request("PUT", "inbox.txt", "", {
          "If-Match": inbox.etag,
        });
        if (clear.status >= 200 && clear.status < 300) {
          const confirmation = await this.dav.request("GET", "inbox.txt");
          ok(confirmation, "核对条件清空");
          if (text(confirmation) === raw) {
            this.invalidate();
            throw new Error("条件清空结果异常，已暂停并重新验证；原文归档保留");
          }
          this.clearObserved();
          await this.publish(remote);
          this.status = "已同步，手机输入已归档并清空";
          this.lastSucceeded = true;
          return;
        }
        if (clear.status !== 412) ok(clear, "条件清空 inbox");
        inbox = await this.dav.request("GET", "inbox.txt");
        ok(inbox, "重新读取 inbox");
        raw = decodeInbox(inbox.body);
        batch = observeInbox(this.store, raw, inbox.etag);
        this.changed();
        if (!batch) {
          this.clearObserved();
          await this.publish(remote);
          this.status = "已同步，inbox 已为空";
          this.lastSucceeded = true;
          return;
        }
        const archive = await this.dav.request(
          "PUT",
          this.archivePath(batch),
          batch.snapshot,
          { "If-None-Match": "*" },
        );
        if (archive.status !== 412) ok(archive, "归档追加原文");
        remote = await this.publish(remote);
      }
      this.status = batch
        ? "手机仍在更新 inbox，已保留内容；请稍后再次同步"
        : "思想数据已同步";
      this.lastSucceeded = !batch;
    } catch (e) {
      if (e instanceof Error && /HTTP (404|405)|条件.*异常/.test(e.message))
        this.invalidate();
      this.status = safeSyncError(e);
      throw new Error(this.status);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  private async readEvents(manifest: Manifest): Promise<ThoughtEvent[]> {
    const events: ThoughtEvent[] = [];
    const ids = new Set<string>();
    for (const batch of manifest.batches) {
      const r = await this.dav.request("GET", batch.file);
      ok(r, "读取思想事件");
      const content = text(r);
      if (hash(content) !== batch.sha256)
        throw new Error("云端事件校验失败，未恢复");
      for (const input of eventFileSchema.parse(JSON.parse(content)).events) {
        const event = validateEvent(input);
        if (!ids.has(event.id)) {
          ids.add(event.id);
          events.push(event);
        }
      }
    }
    return events;
  }
  async restore() {
    if (this.busy) throw new Error("同步正在进行");
    if (this.store.latestSeq() !== 0)
      throw new Error("换机恢复只允许在空白本地库进行，以免覆盖当前思想");
    this.busy = true;
    this.lastSucceeded = false;
    this.status = "正在恢复云端思想库并接管";
    this.changed();
    try {
      const remote = await this.manifest();
      if (!remote.value || !strongEtag(remote.etag))
        throw new Error("没有可恢复的云端清单，或清单缺少强 ETag");
      if (!(await this.probe()))
        throw new Error("WebDAV 不支持可靠条件写入，无法安全接管");
      const events = await this.readEvents(remote.value);
      // Validate the entire replay before claiming ownership. appendMany is atomic.
      const temporary = new Store(":memory:");
      try {
        temporary.appendMany(events);
      } finally {
        temporary.close();
      }
      const next: Manifest = {
        ...remote.value,
        deviceId: this.store.getMeta("deviceId")!,
        generation: remote.value.generation + 1,
        updatedAt: new Date().toISOString(),
      };
      const put = await this.dav.request(
        "PUT",
        "manifest.json",
        JSON.stringify(next),
        { "If-Match": remote.etag },
      );
      ok(put, "接管云端思想库");
      const verify = await this.manifest();
      if (JSON.stringify(verify.value) !== JSON.stringify(next))
        throw new Error("无法确认云端接管结果，未恢复本地库");
      this.store.appendMany(events);
      this.store.setMeta("syncedSeq", String(this.store.latestSeq()));
      this.store.setMeta("manifestHash", hash(JSON.stringify(next)));
      this.store.recoverInterrupted();
      this.store.reimportRawNotes();
      this.status = "已从云端恢复并接管；请停止旧电脑同步";
      this.lastSucceeded = true;
    } catch (e) {
      if (e instanceof Error && /HTTP (404|405)|条件.*异常/.test(e.message))
        this.invalidate();
      this.status = safeSyncError(e);
      throw new Error(this.status);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}
export function safeSyncError(e: unknown): string {
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return "云端数据格式不兼容或损坏，未覆盖本地数据";
  if (e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name))
    return "坚果云请求超时；状态已保留，请再次同步";
  if (e instanceof Error && e.message === "fetch failed")
    return "无法连接坚果云；本地数据已保留";
  return e instanceof Error
    ? e.message.slice(0, 1000).replace(/sk-[A-Za-z0-9_-]+/g, "[已隐藏]")
    : "同步失败；本地数据已保留";
}
