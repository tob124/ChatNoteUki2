import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publishRelease } from "./publish-release.mjs";

const sha = "a".repeat(40);
const env = {
  GITHUB_REPOSITORY: "test/app",
  GITHUB_SHA: sha,
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "push",
  GITHUB_RUN_ID: "123",
};
function fixture({
  existing = null,
  head = sha,
  badDigest = false,
  failUpload = false,
} = {}) {
  const calls = [];
  const request = async (method, path, data) => {
    calls.push({ method, path, data });
    if (path.includes("/releases/tags/")) return existing;
    if (path.endsWith("/git/ref/heads/main")) return { object: { sha: head } };
    if (method === "POST") return { id: 123, assets: [] };
    if (method === "UPLOAD") {
      if (failUpload) throw new Error("upload failed");
      return {
        state: "uploaded",
        size: data.data.length,
        digest: badDigest
          ? "wrong"
          : `sha256:${createHash("sha256").update(data.data).digest("hex")}`,
      };
    }
    if (method === "PATCH")
      return { html_url: "https://github.com/test/app/releases/tag/build" };
    if (method === "DELETE") return null;
    throw new Error(`Unexpected request: ${method} ${path}`);
  };
  return {
    calls,
    run: (overrides = {}) =>
      publishRelease({
        env,
        version: "0.2.3",
        installer: Buffer.from("mock installer"),
        request,
        ...overrides,
      }),
  };
}
test("uploads installer and checksum to draft, then publishes the exact commit as Latest", async () => {
  const f = fixture();
  await f.run();
  assert.equal(
    f.calls.find((c) => c.method === "POST").data.target_commitish,
    sha,
  );
  assert.equal(f.calls.find((c) => c.method === "POST").data.draft, true);
  assert.equal(f.calls.filter((c) => c.method === "UPLOAD").length, 2);
  assert.deepEqual(f.calls.at(-1).data, { draft: false, make_latest: "true" });
});
test("old builds cannot displace newer main as Latest", async () => {
  const f = fixture({ head: "b".repeat(40) });
  await f.run();
  assert.equal(f.calls.at(-1).data.make_latest, "false");
});
for (const options of [{ badDigest: true }, { failUpload: true }]) {
  test(`failed upload or checksum leaves only a draft: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert.equal(
      f.calls.some((c) => c.method === "PATCH"),
      false,
    );
  });
}
test("rerunning a published build does not overwrite its assets", async () => {
  const f = fixture({
    existing: {
      target_commitish: sha,
      draft: false,
      html_url: "release",
      assets: ["ChatNoteUki-0.2.3-Setup-x64.exe", "SHA256SUMS.txt"].map(
        (name) => ({ name, state: "uploaded", size: 1 }),
      ),
    },
  });
  assert.equal((await f.run()).alreadyPublished, true);
  assert.equal(f.calls.length, 1);
});
test("resume a draft by replacing only its incomplete upload", async () => {
  const f = fixture({
    existing: {
      id: 123,
      target_commitish: sha,
      draft: true,
      assets: [
        { id: 456, name: "ChatNoteUki-0.2.3-Setup-x64.exe", state: "starter" },
      ],
    },
  });
  await f.run();
  const deleteIndex = f.calls.findIndex((c) => c.method === "DELETE");
  assert.ok(deleteIndex > 0);
  assert.match(f.calls[deleteIndex].path, /\/assets\/456$/);
  assert.equal(f.calls[deleteIndex + 1].method, "UPLOAD");
  assert.equal(f.calls.at(-1).method, "PATCH");
});
test("resume a draft without reuploading a verified installer", async () => {
  const data = Buffer.from("mock installer");
  const f = fixture({
    existing: {
      id: 123,
      target_commitish: sha,
      draft: true,
      assets: [
        {
          name: "ChatNoteUki-0.2.3-Setup-x64.exe",
          state: "uploaded",
          digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
        },
      ],
    },
  });
  await f.run();
  assert.deepEqual(
    f.calls.filter((c) => c.method === "UPLOAD").map((c) => c.data.name),
    ["SHA256SUMS.txt"],
  );
  assert.equal(
    f.calls.some((c) => c.method === "DELETE"),
    false,
  );
});
test("unexpected source or incomplete published release is rejected", async () => {
  for (const existing of [
    { target_commitish: "b".repeat(40) },
    { target_commitish: sha, draft: false, assets: [] },
  ]) {
    const f = fixture({ existing });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 1);
  }
});
test("development branches and pull requests cannot publish", async () => {
  for (const change of [
    { GITHUB_REF: "refs/heads/codex/test" },
    { GITHUB_EVENT_NAME: "pull_request" },
  ]) {
    const f = fixture();
    await assert.rejects(f.run({ env: { ...env, ...change } }));
    assert.equal(f.calls.length, 0);
  }
});
