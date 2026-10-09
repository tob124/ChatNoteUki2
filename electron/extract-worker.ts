import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { MaterialSegment } from "../src/materials";
const MAX_TEXT = 1_000_000;
globalThis.fetch = async () => {
  throw new Error("文档提取不允许加载网络资源");
};
const segments: MaterialSegment[] = [];
let used = 0,
  limited = false;
function add(text: string, page: number | null) {
  let paragraph = 0;
  for (const part of text.split(/\r?\n[\t ]*\r?\n/).filter((p) => p.trim())) {
    paragraph++;
    for (let offset = 0; offset < part.length; offset += 6000) {
      if (used >= MAX_TEXT) {
        limited = true;
        return;
      }
      const body = part.slice(
        offset,
        Math.min(offset + 6000, offset + MAX_TEXT - used),
      );
      segments.push({ id: segments.length + 1, page, paragraph, text: body });
      used += body.length;
    }
  }
}
// Read central-directory sizes before decompressing DOCX. Reject encryption,
// ZIP64 and extreme expansion rather than letting a small zip exhaust memory.
function inspectDocx(buffer: Buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (
      buffer.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + buffer.readUInt16LE(i + 20) === buffer.length
    ) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("DOCX 文件损坏，无法读取文档目录");
  const count = buffer.readUInt16LE(end + 10),
    start = buffer.readUInt32LE(end + 16),
    length = buffer.readUInt32LE(end + 12);
  if (
    buffer.readUInt16LE(end + 4) ||
    buffer.readUInt16LE(end + 6) ||
    count === 65535 ||
    start === 0xffffffff ||
    length === 0xffffffff
  )
    throw new Error("此 DOCX 使用不支持的分卷或 ZIP64 格式");
  if (count > 10000 || start + length > end)
    throw new Error("DOCX 目录异常，未解压；原文件已保存");
  let total = 0,
    entries = 0,
    i = start;
  for (; entries < count; entries++) {
    if (i + 46 > start + length || buffer.readUInt32LE(i) !== 0x02014b50)
      throw new Error("DOCX 目录损坏，未解压；原文件已保存");
    if (buffer.readUInt16LE(i + 8) & 1)
      throw new Error("DOCX 已加密，无法提取；原文件已保存");
    const size = buffer.readUInt32LE(i + 24);
    if (size === 0xffffffff) throw new Error("此 DOCX 使用不支持的 ZIP64 格式");
    total += size;
    if (size > 40 * 1024 * 1024 || total > 80 * 1024 * 1024)
      throw new Error("DOCX 解压体积超过安全范围，未处理；原文件已保存");
    i +=
      46 +
      buffer.readUInt16LE(i + 28) +
      buffer.readUInt16LE(i + 30) +
      buffer.readUInt16LE(i + 32);
  }
  if (!entries || i !== start + length)
    throw new Error("DOCX 文件损坏，无法读取文档结构");
}
async function extract() {
  const buffer = readFileSync(workerData.path);
  if (!buffer.length || buffer.length > 25 * 1024 * 1024)
    throw new Error("文件为空或超过 25 MiB");
  let coverage = "",
    warnings: string[] = [];
  if (workerData.format === "pdf") {
    const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const packageRoot = dirname(
      fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")),
    );
    const loading = pdf.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      useWasm: false,
      disableFontFace: true,
      disableAutoFetch: true,
      stopAtErrors: true,
      cMapUrl: join(packageRoot, "cmaps").replaceAll("\\", "/") + "/",
      cMapPacked: true,
      standardFontDataUrl:
        join(packageRoot, "standard_fonts").replaceAll("\\", "/") + "/",
    });
    try {
      const document = await loading.promise;
      let readPages = 0,
        emptyPages = 0;
      for (let page = 1; page <= document.numPages; page++) {
        if (limited) break;
        let value, content;
        try {
          value = await document.getPage(page);
          content = await value.getTextContent();
        } catch {
          warnings.push(`第 ${page} 页无法完整提取，已保存此前读取内容`);
          break;
        }
        const text = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("");
        if (!text.trim()) emptyPages++;
        add(text, page);
        readPages++;
        value.cleanup();
      }
      coverage = `已读取 ${readPages}/${document.numPages} 页；${emptyPages} 页未提取到文字${limited ? "；文本达到容量限制，后续内容未读取" : ""}`;
      if (emptyPages)
        warnings.push("部分页面没有可提取文字，扫描件 OCR 尚未支持");
    } catch (e) {
      if (e instanceof Error && e.name === "PasswordException")
        throw new Error("PDF 已加密，需要解锁后的文件；原文件已保存");
      throw e;
    } finally {
      await loading.destroy();
    }
  } else if (workerData.format === "docx") {
    inspectDocx(buffer);
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    add(result.value, null);
    coverage = `已提取 ${used.toLocaleString()} 个字符${limited ? "；超过容量的文字未索引" : ""}；DOCX 以段落定位`;
    if (result.messages.length)
      warnings.push("文档提取存在提示，请对照原文件核对");
  } else {
    let text: string,
      encoding = "UTF-8";
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      encoding = "UTF-16 LE";
      text = new TextDecoder("utf-16le", { fatal: true }).decode(
        buffer.subarray(2),
      );
    } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      encoding = "UTF-16 BE";
      text = new TextDecoder("utf-16be", { fatal: true }).decode(
        buffer.subarray(2),
      );
    } else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        encoding = "GB18030（自动识别，请核对）";
        text = new TextDecoder("gb18030", { fatal: true }).decode(buffer);
      }
    }
    add(text.replace(/^\uFEFF/, ""), null);
    coverage = `${encoding}；已提取 ${used.toLocaleString()} 个字符${limited ? "；超过容量的文字未索引" : ""}`;
  }
  if (!segments.length)
    throw new Error(
      "没有可提取的文字。图片及扫描件 OCR 尚未支持；原文件已保存",
    );
  return { segments, coverage, warnings, limited };
}
extract()
  .then((result) => parentPort!.postMessage({ ok: true, ...result }))
  .catch((error) =>
    parentPort!.postMessage({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "文字提取失败，请对照原文件核对",
    }),
  );
