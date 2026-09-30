import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../../electron/store";
import { decodeInbox, observeInbox, splitInbox } from "../../electron/inbox";
import { SyncEngine } from "../../electron/webdav";
import { FakeDav } from "./fake-dav";
const stores: Store[] = [];
function open() {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));
describe("inbox parsing and receipts", () => {
  it("handles BOM, CRLF, LF, CR, mixed whitespace, repeated blank lines and an unterminated last note", () => {
    const raw =
      "\uFEFF第一条\r\n仍是第一条\r\n \t\r\n第二条\n\n\n第三条\r\r第四条\r\n\n第五条";
    expect(splitInbox(raw)).toEqual([
      "第一条\r\n仍是第一条",
      "第二条",
      "第三条",
      "第四条",
      "第五条",
    ]);
    expect(decodeInbox(Buffer.from(raw))).toBe(raw);
    expect(() => decodeInbox(new Uint8Array([0xff]))).toThrow();
    expect(splitInbox(" \r\n\n\t")).toEqual([]);
  });
  it("deduplicates retries by cycle and position, preserving deliberate repeated notes", () => {
    const s = open();
    const b = observeInbox(s, "同文\n\n同文", '"a"')!;
    observeInbox(s, b.snapshot, '"b"');
    expect(s.snapshot().notes).toHaveLength(2);
    s.append("inbox.cleared", { id: b.id });
    observeInbox(s, b.snapshot, '"a"');
    expect(s.snapshot().notes).toHaveLength(4);
  });
  it("imports only an appended suffix and refuses ambiguous edits", () => {
    const s = open();
    observeInbox(s, "第一条\n", '"a"');
    observeInbox(s, "第一条\n\n第二条", '"b"');
    expect(s.snapshot().notes.map((n) => n.raw)).toEqual([
      "第一条\n",
      "第二条",
    ]);
    expect(() => observeInbox(s, "被修改\n\n第二条", '"c"')).toThrow("改写");
    expect(s.snapshot().notes).toHaveLength(2);
    expect(s.snapshot().batches.at(-1)?.snapshot).toBe("被修改\n\n第二条");
    expect(s.snapshot().batches.at(-1)?.status).toBe("conflict");
  });
});
describe("conditional clearing and cloud restore", () => {
  it("refuses empty-cloud binding when conditional writes cannot be verified", async () => {
    const setup = open(),
      local = open(),
      dav = new FakeDav();
    await new SyncEngine(setup, dav).backup();
    const originalManifest = dav.files.get("manifest.json");
    dav.conditional = false;
    await expect(new SyncEngine(local, dav).backup()).rejects.toThrow(
      "无法安全初始化",
    );
    expect(dav.files.get("manifest.json")).toBe(originalManifest);
  });
  it("safely binds a setup-only empty cloud to a new profile with unsynced local notes", async () => {
    const setup = open(),
      local = open(),
      dav = new FakeDav();
    await new SyncEngine(setup, dav).backup();
    local.capture({ raw: "首次记录必须保留" });
    const engine = new SyncEngine(local, dav);
    await engine.sync();
    expect(engine.lastSucceeded).toBe(true);
    expect(JSON.parse(dav.files.get("manifest.json")!).deviceId).toBe(
      local.getMeta("deviceId"),
    );
    expect(local.snapshot().notes.map((n) => n.raw)).toEqual([
      "首次记录必须保留",
    ]);
    const restored = open();
    await new SyncEngine(restored, dav).restore();
    expect(restored.snapshot()).toEqual(local.snapshot());
  });
  it("does not automatically take over another profile's nonempty cloud", async () => {
    const owner = open(),
      local = open(),
      dav = new FakeDav();
    owner.capture({ raw: "云端原文" });
    await new SyncEngine(owner, dav).backup();
    const originalManifest = dav.files.get("manifest.json");
    local.capture({ raw: "本地原文" });
    dav.files.set("inbox.txt", "手机原文");
    await expect(new SyncEngine(local, dav).sync()).rejects.toThrow("另一台");
    expect(dav.files.get("manifest.json")).toBe(originalManifest);
    expect(dav.files.get("inbox.txt")).toBe("手机原文");
    expect(local.snapshot().notes[0].raw).toBe("本地原文");
  });
  it("does not overwrite a concurrently changed empty-cloud manifest", async () => {
    const setup = open(),
      local = open(),
      dav = new FakeDav();
    await new SyncEngine(setup, dav).backup();
    const original = dav.request.bind(dav);
    let conflicting: string | undefined;
    dav.request = async (...args) => {
      if (args[0] === "PUT" && args[1] === "manifest.json") {
        const changed = JSON.parse(dav.files.get("manifest.json")!);
        changed.generation += 1;
        conflicting = JSON.stringify(changed);
        dav.files.set("manifest.json", conflicting!);
      }
      return original(...args);
    };
    local.capture({ raw: "待上传" });
    await expect(new SyncEngine(local, dav).sync()).rejects.toThrow("HTTP 412");
    expect(dav.files.get("manifest.json")).toBe(conflicting);
    expect(local.getMeta("syncedSeq")).toBeNull();
    expect(local.snapshot().notes).toHaveLength(1);
  });
  it("archives and publishes before clearing, then restores every event on a new machine", async () => {
    const s = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "第一条\n\n第二条");
    dav.beforeClear = () => {
      expect([...dav.files.keys()].some((k) => k.startsWith("imports/"))).toBe(
        true,
      );
      expect(dav.files.has("manifest.json")).toBe(true);
    };
    const sync = new SyncEngine(s, dav);
    await sync.sync();
    expect(dav.files.get("inbox.txt")).toBe("");
    expect(s.snapshot().notes.map((n) => n.raw)).toEqual(["第一条", "第二条"]);
    const newMachine = open();
    await new SyncEngine(newMachine, dav).restore();
    expect(newMachine.snapshot()).toEqual(s.snapshot());
    await expect(sync.sync()).rejects.toThrow("另一台");
  });
  it("keeps inbox when archive upload fails, and retries without duplicating notes", async () => {
    const s = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "原文");
    const original = dav.request.bind(dav);
    let fail = true;
    dav.request = async (...args) => {
      if (fail && args[0] === "PUT" && args[1].startsWith("imports/"))
        throw new Error("归档断网");
      return original(...args);
    };
    const sync = new SyncEngine(s, dav);
    await expect(sync.sync()).rejects.toThrow("断网");
    expect(dav.files.get("inbox.txt")).toBe("原文");
    expect(s.snapshot().notes).toHaveLength(1);
    fail = false;
    await new SyncEngine(s, dav).sync();
    expect(s.snapshot().notes).toHaveLength(1);
    expect(dav.files.get("inbox.txt")).toBe("");
  });
  it("resumes after clear succeeded but its response was lost", async () => {
    const s = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "原文");
    dav.loseClearResponse = true;
    await expect(new SyncEngine(s, dav).sync()).rejects.toThrow("丢失");
    expect(dav.files.get("inbox.txt")).toBe("");
    await new SyncEngine(s, dav).sync();
    expect(s.snapshot().notes).toHaveLength(1);
    expect(s.snapshot().batches[0].status).toBe("cleared");
  });
  it("resumes after manifest was published but its response was lost", async () => {
    const s = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "原文");
    dav.loseManifestResponse = true;
    await expect(new SyncEngine(s, dav).sync()).rejects.toThrow("丢失");
    expect(dav.files.get("inbox.txt")).toBe("原文");
    await new SyncEngine(s, dav).sync();
    expect(s.snapshot().notes).toHaveLength(1);
    const b = open();
    await new SyncEngine(b, dav).restore();
    expect(b.snapshot()).toEqual(s.snapshot());
  });
  it("handles a phone append between read and clear without deleting new input", async () => {
    const s = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "第一条");
    dav.appendOnClear = "\n\n第二条";
    await new SyncEngine(s, dav).sync();
    expect(s.snapshot().notes.map((n) => n.raw)).toEqual(["第一条", "第二条"]);
    expect(dav.files.get("inbox.txt")).toBe("");
  });
  it("never clears a weak ETag or a provider that ignores conditional writes", async () => {
    const a = open(),
      dav = new FakeDav();
    dav.files.set("inbox.txt", "原文");
    dav.weakInbox = true;
    const weak = new SyncEngine(a, dav);
    await weak.sync();
    expect(dav.files.get("inbox.txt")).toBe("原文");
    expect(weak.status).toContain("强 ETag");
    const b = open(),
      broken = new FakeDav();
    broken.files.set("inbox.txt", "另一个原文");
    broken.conditional = false;
    await new SyncEngine(b, broken).sync();
    expect(broken.files.get("inbox.txt")).toBe("另一个原文");
    expect(b.snapshot().notes).toHaveLength(1);
    expect(
      broken.calls.some((c) => c.path === "inbox.txt" && c.method === "PUT"),
    ).toBe(false);
  });
  it("refuses restore onto nonempty local data and rejects damaged cloud event files", async () => {
    const s = open(),
      dav = new FakeDav();
    s.capture({ raw: "本地" });
    await new SyncEngine(s, dav).backup();
    await expect(new SyncEngine(s, dav).restore()).rejects.toThrow("空白");
    const file = [...dav.files.keys()].find((k) => k.startsWith("events/"))!;
    dav.files.set(file, "{}");
    const b = open();
    await expect(new SyncEngine(b, dav).restore()).rejects.toThrow("校验");
    expect(b.latestSeq()).toBe(0);
  });
});
