import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { loadBuffer } from "cheerio";

const denied = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(ip, bits, "ipv4");
export const isPublicAddress = (ip: string) =>
  isIP(ip) === 4 && !denied.check(ip, "ipv4");
export function publicUrl(input: string): URL {
  const url = new URL(input);
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    !host.includes(".") ||
    /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
    host === "localhost" ||
    host.includes(":") ||
    (isIP(host) && !isPublicAddress(host))
  )
    throw new Error("只能读取公开网页，不能访问本机、私网或需要认证的地址");
  url.hash = "";
  return url;
}
type Resolver = (host: string) => Promise<string[]>;
export async function resolvePublic(
  host: string,
  signal: AbortSignal,
  resolver: Resolver = async (h) =>
    (await lookup(h, { all: true, family: 4 })).map((a) => a.address),
  doh: typeof fetch = fetch,
) {
  signal.throwIfAborted();
  let cancel: (() => void) | undefined;
  const addresses = await Promise.race([
    resolver(host),
    new Promise<never>((_, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
    }),
  ]).finally(() => {
    if (cancel) signal.removeEventListener("abort", cancel);
  });
  let checked = addresses;
  if (
    addresses.length &&
    addresses.every((ip) => /^198\.(18|19)\./.test(ip)) &&
    !isIP(host)
  ) {
    const response = await doh(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
      {
        headers: { Accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      },
    );
    if (!response.ok) throw new Error("代理 DNS 核对失败，请检查网络后重试");
    const data = (await response.json()) as {
      Answer?: { type: number; data: string }[];
    };
    checked = (data.Answer ?? [])
      .filter((a) => a.type === 1)
      .map((a) => a.data);
  }
  if (!checked.length || checked.some((ip) => !isPublicAddress(ip)))
    throw new Error("来源解析到非公网地址，已停止读取");
  return checked;
}
export function extractPage(data: Buffer, xml = false, charset?: string) {
  const $ = loadBuffer(data, {
    xmlMode: xml,
    encoding: {
      defaultEncoding: "utf-8",
      transportLayerEncodingLabel: charset,
    },
  });
  const title = $("title").first().text().trim().slice(0, 500);
  $(
    "script,style,nav,footer,header,aside,form,noscript,svg,iframe,button",
  ).remove();
  const main = $("article,main,[role=main]").first();
  const root = main.length
    ? main
    : $("body").length
      ? $("body")
      : $("*").first();
  root.find("p,div,li,h1,h2,h3,h4,br,section").prepend("\n");
  const complete = root
    .text()
    .replace(/[\t \u00a0]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  if (complete.length < 40)
    throw new Error("网页未提供足够的静态正文，请打开原网页核对");
  return {
    title,
    text: complete.slice(0, 12000),
    truncated: complete.length > 12000,
  };
}
export interface PageRead {
  title: string;
  text: string;
  finalUrl: string;
  coverage: string;
}
export async function readPublicPage(
  input: string,
  parent = AbortSignal.timeout(25_000),
): Promise<PageRead> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(25_000)]);
  const visit = async (input: string, redirects: number): Promise<PageRead> => {
    if (redirects > 3) throw new Error("网页重定向过多");
    const url = publicUrl(input);
    const addresses = await resolvePublic(url.hostname, signal);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          signal,
          headers: {
            "User-Agent": "ChatNoteUki/0.3 source reader",
            Accept: "text/html,text/plain,application/xml",
            "Accept-Encoding": "identity",
          },
          lookup: (_host, options, callback) => {
            if (options.all)
              callback(null, [{ address: addresses[0], family: 4 }]);
            else callback(null, addresses[0], 4);
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            visit(
              new URL(response.headers.location, url).href,
              redirects + 1,
            ).then(resolve, reject);
            return;
          }
          const type = String(
            response.headers["content-type"] ?? "",
          ).toLowerCase();
          if (
            status !== 200 ||
            !/text\/(html|plain|xml)|application\/(xhtml\+xml|xml)/i.test(type)
          ) {
            response.resume();
            reject(
              new Error(
                `来源未提供公开网页正文（HTTP ${status}）。可打开原网页阅读。`,
              ),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1_500_000)
              req.destroy(new Error("网页超过本次读取大小限制"));
            else chunks.push(Buffer.from(chunk));
          });
          response.on("error", reject);
          response.on("aborted", () =>
            reject(new Error("网页传输中断，请手动重试")),
          );
          response.on("end", () => {
            try {
              let buffer = Buffer.concat(chunks);
              const encoding = response.headers["content-encoding"];
              const options = { maxOutputLength: 1_500_000 };
              if (encoding === "gzip") buffer = gunzipSync(buffer, options);
              else if (encoding === "deflate")
                buffer = inflateSync(buffer, options);
              else if (encoding === "br")
                buffer = brotliDecompressSync(buffer, options);
              const page = type.includes("text/plain")
                ? {
                    title: "",
                    text: buffer.toString("utf8").slice(0, 12000),
                    truncated: buffer.length > 12000,
                  }
                : extractPage(
                    buffer,
                    /xml/.test(type),
                    /charset\s*=\s*["']?([^\s;"']+)/i.exec(type)?.[1],
                  );
              if (page.text.trim().length < 40)
                throw new Error("来源未提供足够正文");
              resolve({
                title: page.title,
                text: page.text,
                finalUrl: url.href,
                coverage: `${url.hostname === "pubmed.ncbi.nlm.nih.gov" || (url.hostname.endsWith("arxiv.org") && url.pathname.startsWith("/abs/")) ? "摘要与页面信息，未读取论文全文；" : ""}静态${type.includes("xml") ? " XML" : "网页"}提取${page.truncated ? "，仅前 12,000 字符" : ""}；未执行脚本，不代表全文逐字核查`,
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.setTimeout(15_000, () => req.destroy(new Error("读取网页超时")));
      req.on("error", reject);
      req.end();
    });
  };
  return visit(input, 0);
}
