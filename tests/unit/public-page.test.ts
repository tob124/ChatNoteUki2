import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
const state = vi.hoisted(() => ({
  addresses: ["1.1.1.1"],
  requests: 0,
  responses: [] as {
    status: number;
    headers: Record<string, string>;
    body?: Buffer;
  }[],
}));
vi.mock("node:dns/promises", () => ({
  lookup: async () =>
    state.addresses.map((address) => ({ address, family: 4 })),
}));
vi.mock("node:https", () => ({
  request: (_url: URL, options: any, callback: (res: any) => void) => {
    state.requests++;
    const req = new EventEmitter() as any;
    req.setTimeout = () => req;
    req.destroy = (error: Error) => {
      req.emit("error", error);
      return req;
    };
    req.end = () =>
      queueMicrotask(() => {
        options.lookup("example.com", {}, (error: unknown, address: string) => {
          expect(error).toBe(null);
          expect(address).toBe("1.1.1.1");
        });
        const next = state.responses.shift()!;
        const res = new EventEmitter() as any;
        res.headers = next.headers;
        res.statusCode = next.status;
        res.resume = () => {};
        callback(res);
        if (next.body) res.emit("data", next.body);
        res.emit("end");
      });
    return req;
  },
}));
import { readPublicPage } from "../../electron/public-source";
beforeEach(() => {
  state.addresses = ["1.1.1.1"];
  state.requests = 0;
  state.responses = [];
});
it("rejects a redirect to the private network before opening a second connection", async () => {
  state.responses.push({
    status: 302,
    headers: { location: "http://169.254.169.254/latest/metadata" },
  });
  await expect(readPublicPage("https://example.com/page")).rejects.toThrow(
    "公开网页",
  );
  expect(state.requests).toBe(1);
});
it("rejects DNS rebinding to a private address without dispatching a request", async () => {
  state.addresses = ["1.1.1.1", "192.168.0.1"];
  await expect(readPublicPage("https://example.com/page")).rejects.toThrow(
    "非公网",
  );
  expect(state.requests).toBe(0);
});
it("bounds decompressed content instead of accepting a compressed oversized page", async () => {
  state.responses.push({
    status: 200,
    headers: { "content-type": "text/plain", "content-encoding": "gzip" },
    body: gzipSync(Buffer.alloc(2_000_000, "x")),
  });
  await expect(readPublicPage("https://example.com/page")).rejects.toThrow();
});
it("does not treat a PDF download or login rejection as read article evidence", async () => {
  state.responses.push({
    status: 200,
    headers: { "content-type": "application/pdf" },
    body: Buffer.from("%PDF-1.7"),
  });
  await expect(readPublicPage("https://example.com/paper")).rejects.toThrow(
    "公开网页正文",
  );
});
