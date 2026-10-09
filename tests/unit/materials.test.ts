import { afterEach, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import JSZip from "jszip";
import { Store } from "../../electron/store";
import { Materials } from "../../electron/materials";
import { SyncEngine, type DavResponse } from "../../electron/webdav";
import { FakeDav } from "./fake-dav";
const stores: Store[] = [];
beforeAll(async () => {
  await build({
    entryPoints: ["electron/extract-worker.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["pdfjs-dist/*", "mammoth"],
    outfile: "dist-electron/extract-worker.mjs",
  });
});
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const open = () => {
  const root = mkdtempSync(join(tmpdir(), "uki-material-test-"));
  const store = new Store(join(root, "thoughts.db"));
  stores.push(store);
  return { root, store };
};
const hash = (body: Uint8Array | string) =>
  createHash("sha256").update(body).digest("hex");
async function extract(format: string, body: Uint8Array | string) {
  const root = mkdtempSync(join(tmpdir(), "uki-extract-test-")),
    path = join(root, "input." + format);
  writeFileSync(path, body);
  return new Promise<any>((res, rej) => {
    const w = new Worker(resolve("dist-electron/extract-worker.mjs"), {
      workerData: { path, format },
    });
    const timeout = setTimeout(() => {
      void w.terminate();
      rej(new Error("提取超时"));
    }, 15000);
    w.once("message", (v) => {
      clearTimeout(timeout);
      void w.terminate();
      res(v);
    });
    w.once("error", (e) => {
      clearTimeout(timeout);
      rej(e);
    });
  });
}
function pdf() {
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <41> <4E2D> <42> <6587> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end";
  const stream = "BT /F1 12 Tf 20 60 Td (AB) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 7 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = Buffer.byteLength(body);
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF`;
  return body;
}
it("extracts Chinese multi-page PDF with real page references", async () => {
  const result = await extract("pdf", pdf());
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.segments.map((s: any) => [s.page, s.text.trim()])).toEqual([
    [1, "中文"],
    [2, "中文"],
  ]);
  expect(result.coverage).toContain("2/2");
});
it("extracts DOCX plain text without HTML and rejects corrupt files", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>这是中文资料，不是用户观点。</w:t></w:r></w:p></w:body></w:document>',
  );
  const result = await extract(
    "docx",
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  expect(result.ok).toBe(true);
  expect(result.segments[0].text).toContain("中文资料");
  expect((await extract("docx", "bad document")).ok).toBe(false);
  expect((await extract("pdf", "broken")).ok).toBe(false);
});
it("labels text encodings, preserves paragraph order and detects empty files", async () => {
  const result = await extract(
    "txt",
    Buffer.concat([
      Buffer.from([255, 254]),
      Buffer.from("第一段\n\n第二段", "utf16le"),
    ]),
  );
  expect(result.ok).toBe(true);
  expect(result.coverage).toContain("UTF-16");
  expect(result.segments.map((s: any) => s.text)).toEqual(["第一段", "第二段"]);
  expect((await extract("md", " \n ")).ok).toBe(false);
});
it("checkpoints material summary and yields after each step; deleted references cannot enter context", async () => {
  const { store } = open(),
    id = randomUUID(),
    body = Buffer.from("第一段资料"),
    sha256 = hash(body);
  store.append("material.updated", {
    id,
    value: {
      id,
      name: "资料.txt",
      format: "txt",
      bytes: body.length,
      sha256,
      chunks: [{ sha256, bytes: body.length }],
      noteId: null,
      createdAt: new Date().toISOString(),
      revision: 0,
      status: "pending",
      error: null,
      coverage: "全部文字",
      segments: [{ id: 1, page: null, paragraph: 1, text: "第一段资料" }],
      summary: "",
      summaries: [],
    },
  });
  const service = new Materials(
      store,
      () => 32768,
      () => {},
      () => {},
      async () => body,
    ),
    taskId = service.queue(id);
  await service.step(store.task(taskId), async () => ({
    summary: "外部资料表达第一段的内容。",
    evidenceSegmentIds: [1],
  }));
  expect(store.task(taskId).status).toBe("done");
  expect(store.material(id).summaries[0].evidenceSegmentIds).toEqual([1]);
  await service.action(id, "trash");
  expect(store.materialPage().items).toHaveLength(0);
  expect(() =>
    store.capture({
      raw: "分析资料",
      mode: "discussion",
      parentNoteId: randomUUID(),
      materialIds: [id],
    }),
  ).toThrow("所选资料已删除");
  await service.action(id, "restore");
  expect(store.material(id).summary).toContain("第一段");
});
class BinaryDav extends FakeDav {
  blobs = new Map<string, Uint8Array>();
  override async request(
    method: string,
    path: string,
    body?: string | Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<DavResponse> {
    if (!path.startsWith("blobs/"))
      return super.request(method, path, body, headers);
    this.calls.push({ method, path, headers });
    const stored = this.blobs.get(path),
      etag = stored ? '"' + hash(stored) + '"' : null;
    if (method === "GET")
      return {
        status: stored ? 200 : 404,
        etag,
        body: stored ?? new Uint8Array(),
      };
    if (method === "PUT") {
      if (stored && headers["If-None-Match"] === "*")
        return { status: 412, etag, body: new Uint8Array() };
      this.blobs.set(path, Buffer.from(body ?? []));
      return { status: 201, etag: null, body: new Uint8Array() };
    }
    if (method === "DELETE") {
      if (headers["If-Match"] !== etag)
        return { status: 412, etag, body: new Uint8Array() };
      this.blobs.delete(path);
      return { status: 204, etag: null, body: new Uint8Array() };
    }
    return { status: 201, etag: null, body: new Uint8Array() };
  }
}
it("publishes binary files before metadata, restores on demand and purges shared cloud batches", async () => {
  const { root, store } = open(),
    id = randomUUID(),
    body = Buffer.from([0, 255, 128, 3, 7]),
    sha256 = hash(body);
  const m = {
    id,
    name: "资料.txt",
    format: "txt",
    bytes: body.length,
    sha256,
    chunks: [{ sha256, bytes: body.length }],
    noteId: null,
    createdAt: new Date().toISOString(),
    revision: 0,
    status: "done",
    error: null,
    coverage: "全部文字",
    segments: [{ id: 1, page: null, paragraph: 1, text: "待删除的资料原文" }],
    summary: "待删除的摘要",
    summaries: [],
  };
  store.append("material.updated", { id, value: m });
  const service = new Materials(
    store,
    () => 32768,
    () => {},
    () => {},
    async () => body,
  );
  writeFileSync(service.blobPath(sha256), body);
  const dav = new BinaryDav(),
    sync = new SyncEngine(store, dav);
  await sync.backup();
  expect(sync.lastSucceeded).toBe(true);
  expect(dav.blobs.get(`blobs/${sha256}.bin`)).toEqual(body);
  const restored = open().store;
  const restoredSync = new SyncEngine(restored, dav);
  await restoredSync.restore();
  expect(restored.material(id).segments[0].text).toBe("待删除的资料原文");
  const remoteService = new Materials(
    restored,
    () => 32768,
    () => {},
    () => {},
    (hashValue) => restoredSync.downloadBlob(hashValue),
  );
  expect(
    readFileSync(await remoteService.ensureOriginal(restored.material(id))),
  ).toEqual(body);
  await remoteService.action(id, "trash");
  await remoteService.action(id, "purge");
  await restoredSync.backup();
  expect(restoredSync.lastSucceeded).toBe(true);
  expect(dav.blobs.size).toBe(0);
  expect(JSON.stringify(restored.eventsAfter())).not.toContain(
    "待删除的资料原文",
  );
  const replay = open().store;
  replay.appendMany(restored.eventsAfter().map((r) => r.event));
  expect(replay.material(id).purged).toBe(true);
  expect(replay.materialPage().items).toHaveLength(0);
  expect([...dav.files.values()].join()).not.toContain("待删除的摘要");
});
