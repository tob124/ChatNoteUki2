import { readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Draft first: a failed upload must never advertise an incomplete installer.
export async function publishRelease({ env, version, installer, request }) {
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = env;
  if (
    env.GITHUB_REF !== "refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME) ||
    !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") ||
    !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    !/^\d+\.\d+\.\d+$/.test(version)
  ) {
    throw new Error(
      "Release requires a main build with valid repository, commit and version.",
    );
  }
  const tag = `v${version}-main.${sha.slice(0, 12)}`;
  const name = `ChatNoteUki-${version}-Setup-x64.exe`;
  const digest = createHash("sha256").update(installer).digest("hex");
  const files = [
    { name, data: installer, type: "application/octet-stream" },
    {
      name: "SHA256SUMS.txt",
      data: Buffer.from(`${digest}  ${name}\n`),
      type: "text/plain",
    },
  ];
  const base = `/repos/${repo}`;
  let release = await request(
    "GET",
    `${base}/releases/tags/${tag}`,
    undefined,
    true,
  );
  if (release && release.target_commitish !== sha) {
    throw new Error("Existing release belongs to a different source commit.");
  }
  if (release && !release.draft) {
    if (
      !files.every((file) =>
        release.assets.some(
          (asset) =>
            asset.name === file.name &&
            asset.state === "uploaded" &&
            asset.size > 0,
        ),
      )
    ) {
      throw new Error(
        "Published release is incomplete; refusing to replace published assets.",
      );
    }
    return { url: release.html_url, alreadyPublished: true };
  }
  if (!release) {
    release = await request("POST", `${base}/releases`, {
      tag_name: tag,
      target_commitish: sha,
      draft: true,
      name: `ChatNoteUki ${version} · main ${sha.slice(0, 7)}`,
      body: `Windows 10/11 x64 主线构建。单元测试、桌面测试、类型检查与安装包构建全部通过。\n\n源码：[${sha.slice(0, 7)}](https://github.com/${repo}/commit/${sha})\n构建：[GitHub Actions](https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID})\n使用及升级说明：[README](https://github.com/${repo}/blob/${sha}/README.md)\n\n安装保留本机资料与凭据。安装包未签名；版本号相同的主线构建用提交区分，不替换已有版本。\n\nSHA-256：\`${digest}\`。`,
      make_latest: "false",
    });
  }
  for (const file of files) {
    const expected = `sha256:${createHash("sha256").update(file.data).digest("hex")}`;
    const existing = release.assets.find((asset) => asset.name === file.name);
    if (existing?.state === "uploaded" && existing.digest === expected)
      continue;
    if (existing)
      await request("DELETE", `${base}/releases/assets/${existing.id}`);
    const asset = await request(
      "UPLOAD",
      `${base}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`,
      file,
    );
    if (
      asset.state !== "uploaded" ||
      asset.size !== file.data.length ||
      asset.digest !== expected
    ) {
      throw new Error(`Upload verification failed: ${file.name}`);
    }
  }
  // A slower, older build may finish after a newer push. It must not become Latest.
  const head = await request("GET", `${base}/git/ref/heads/main`);
  const published = await request("PATCH", `${base}/releases/${release.id}`, {
    draft: false,
    make_latest: head.object.sha === sha ? "true" : "false",
  });
  return { url: published.html_url, alreadyPublished: false };
}

async function request(method, path, data, allowMissing = false) {
  const upload = method === "UPLOAD";
  const response = await fetch(
    `https://${upload ? "uploads" : "api"}.github.com${path}`,
    {
      method: upload ? "POST" : method,
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": upload ? data.type : "application/json",
        "User-Agent": "ChatNoteUki-release",
      },
      body: upload ? data.data : data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(upload ? 180_000 : 30_000),
    },
  );
  if (allowMissing && response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.env.GH_TOKEN) throw new Error("Missing Actions release token.");
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const result = await publishRelease({
    env: process.env,
    version,
    request,
    installer: readFileSync(`release/ChatNoteUki-${version}-Setup-x64.exe`),
  });
  console.log(result.url);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Installer release: [Download](${result.url})\n`,
    );
  }
}
