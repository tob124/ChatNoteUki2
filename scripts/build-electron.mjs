import { build } from "esbuild";
await build({
  entryPoints: ["electron/extract-worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["pdfjs-dist/*", "mammoth"],
  outfile: "dist-electron/extract-worker.mjs",
});
await build({
  entryPoints: ["electron/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  outfile: "dist-electron/main.cjs",
});
await build({
  entryPoints: ["electron/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  outfile: "dist-electron/preload.cjs",
});
