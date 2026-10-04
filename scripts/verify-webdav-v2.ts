/** Explicit real-server acceptance. Reads local DPAPI credentials, uses a unique child folder, never calls AI. */
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Credentials } from "../electron/credentials";
import { Store } from "../electron/store";
import { SyncEngine, WebDav } from "../electron/webdav";
import type { SyncDiagnostic } from "../src/shared";
app
  .whenReady()
  .then(async () => {
    const profile = join(app.getPath("appData"), "ChatNoteUki"),
      credentials = new Credentials(join(profile, "credentials.json"));
    const settings = credentials.settings(),
      password = credentials.davPassword();
    if (!password || !settings.davUser)
      throw new Error("请先保存本机坚果云凭据");
    const child = "verify-v2-" + randomUUID();
    assert.match(child, /^verify-v2-[a-f0-9-]{36}$/);
    const trace: SyncDiagnostic[] = [],
      dav = new WebDav(
        { ...settings, directory: settings.directory + "/" + child },
        password,
        (r) => trace.push(r),
      );
    const stores: Store[] = [];
    let owned = false;
    const report: Record<string, unknown> = { paidAiCalls: 0 };
    try {
      assert.equal((await dav.request("MKCOL", "")).status, 201);
      owned = true;
      await dav.request(
        "PUT",
        "inbox.txt",
        "\uFEFF隔离验收第一条\r\n\r\n第二条\n\n第二条",
        { "If-None-Match": "*" },
      );
      const local = new Store(":memory:");
      stores.push(local);
      const sync = new SyncEngine(local, dav, () => {}, "isolated-v2");
      await sync.sync();
      assert.equal(sync.lastSucceeded, true);
      assert.deepEqual(
        local.snapshot().notes.map((n) => n.raw),
        ["隔离验收第一条", "第二条", "第二条"],
      );
      assert.equal((await dav.request("GET", "inbox.txt")).body.length, 0);
      report.orderedImportAndClear = true;
      const id = local.snapshot().notes[0].id;
      local.append("note.corrected", { id, raw: "更正版本仍保留原文" });
      local.thread({
        title: "隔离验证问题",
        description: "验证线程资料",
        parentId: null,
      });
      local.addTask("organize", null, "deepseek-flash", [id]);
      const researchId = randomUUID();
      const taskId = local.addTask("research", null, "deepseek-flash", [id], {
        noteId: id,
        threadId: null,
        question: "隔离资料验收的问题",
        queries: ["公开合成搜索词"],
      });
      const now = new Date().toISOString();
      const source = {
        id: "a".repeat(24),
        url: "https://example.com/study",
        title: "隔离合成资料",
        discoveredAt: now,
        fetchedAt: now,
        snippet: "",
        text: "这是独立生成的合成验收正文，只用于核对资料恢复是否一致。",
        status: "read",
        error: null,
        coverage: "模拟静态正文",
      };
      local.appendMany([
        local.event("research.added", {
          id: researchId,
          taskId,
          noteId: id,
          threadId: null,
          question: "隔离资料验收的问题",
          queries: ["公开合成搜索词"],
          createdAt: now,
          evidence: [{ noteId: id, revision: 1 }],
          baseVersion: 0,
          sources: [source],
          searches: 1,
          report: {
            findings: [
              {
                sourceId: source.id,
                quote: "独立生成的合成验收正文",
                claim: "仅测试来源恢复",
                relation: "context",
              },
            ],
            analysis: "合成验收分析，不代表用户表达。",
            limitations: ["模拟内容"],
            questions: [],
          },
        }),
        local.event("task.updated", {
          id: taskId,
          status: "done",
          result: { resultId: researchId },
        }),
      ]);
      local.capture({
        raw: "这是围绕合成资料的用户追问。",
        mode: "discussion",
        parentNoteId: id,
        parentRevision: 1,
        researchId,
      });
      await sync.backup();
      const start = trace.length;
      await new SyncEngine(local, dav, () => {}, "isolated-v2").sync();
      const idle = trace.slice(start);
      assert.equal(idle.length, 2);
      assert.ok(idle.every((r) => r.method === "GET"));
      report.idleReads = idle.length;
      report.idleWrites = 0;
      const restored = new Store(":memory:");
      stores.push(restored);
      await new SyncEngine(restored, dav, () => {}, "restore-v2").restore();
      assert.deepEqual(restored.snapshot(), local.snapshot());
      assert.deepEqual(
        restored.detail(id).revisions,
        local.detail(id).revisions,
      );
      report.versionedRestore = true;
      assert.deepEqual(
        restored.research(researchId),
        local.research(researchId),
      );
      assert.equal(restored.detail(id).discussions[0].researchId, researchId);
      report.researchAndDiscussionRestore = true;
      const manifest = JSON.parse(
        Buffer.from((await dav.request("GET", "manifest.json")).body).toString(
          "utf8",
        ),
      );
      assert.equal(manifest.schemaVersion, 4);
      report.cloudFormat = 4;
    } finally {
      stores.forEach((s) => s.close());
      if (owned) {
        assert.match(child, /^verify-v2-[a-f0-9-]{36}$/);
        const response = await dav.request("DELETE", "");
        assert.ok([200, 204, 404].includes(response.status));
        report.isolatedFolderRemoved = true;
      }
      const output = resolve(".local", "webdav-v2-verification");
      mkdirSync(output, { recursive: true });
      writeFileSync(
        join(output, "report.json"),
        JSON.stringify(report, null, 2),
      );
      writeFileSync(
        join(output, "requests.json"),
        JSON.stringify(trace, null, 2),
      );
      process.stdout.write(JSON.stringify(report) + "\n");
    }
  })
  .catch((e) => {
    process.stderr.write(
      (e instanceof Error ? e.message : "验证失败").replace(
        /sk-[A-Za-z0-9_-]+/g,
        "[已隐藏]",
      ) + "\n",
    );
    process.exitCode = 1;
  })
  .finally(() => app.exit(Number(process.exitCode ?? 0)));
