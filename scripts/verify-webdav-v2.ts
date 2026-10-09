/** Explicit real-server acceptance. Reads local DPAPI credentials, uses a unique child folder, never calls AI. */
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Credentials } from "../electron/credentials";
import { Store } from "../electron/store";
import { SyncEngine, WebDav } from "../electron/webdav";
import type { SyncDiagnostic } from "../src/shared";
import { Materials } from "../electron/materials";
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
    const dataRoot = resolve(".local", `webdav-format6-${Date.now()}`);
    mkdirSync(dataRoot, { recursive: true });
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
      const local = new Store(join(dataRoot, "thoughts.db"));
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
      const materialText =
        "隔离合成附件资料，仅验证提取、文件同步、恢复与清理。";
      const materialFile = join(dataRoot, "合成资料.txt");
      writeFileSync(materialFile, materialText, "utf8");
      const materialService = new Materials(
        local,
        () => 32768,
        () => {},
        () => {},
        (hash) => sync.downloadBlob(hash),
      );
      const [materialId] = await materialService.import([materialFile], id);
      const deadline = Date.now() + 20000;
      while (
        local.material(materialId).status === "extracting" &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(local.material(materialId).status, "pending");
      local.saveQuery({
        name: "隔离保存查询",
        workspace: "all",
        query: "隔离",
      });
      const sourceMaterial = local.material(materialId),
        segment = sourceMaterial.segments[0];
      const excerptId = local.captureExcerpt({
        clientId: randomUUID(),
        raw: "自己的理解与引用分开",
        threadId: null,
        quote: {
          materialId,
          sha256: sourceMaterial.sha256,
          segmentId: segment.id,
          start: 0,
          end: segment.text.length,
          text: segment.text,
        },
      });
      await sync.backup();
      const start = trace.length;
      await new SyncEngine(local, dav, () => {}, "isolated-v2").sync();
      const idle = trace.slice(start);
      assert.equal(idle.length, 2);
      assert.ok(idle.every((r) => r.method === "GET"));
      report.idleReads = idle.length;
      report.idleWrites = 0;
      const restored = new Store(join(dataRoot, "restored", "thoughts.db"));
      stores.push(restored);
      const restoredSync = new SyncEngine(
        restored,
        dav,
        () => {},
        "restore-v2",
      );
      await restoredSync.restore();
      assert.deepEqual(restored.snapshot(), local.snapshot());
      assert.deepEqual(
        restored.detail(id).revisions,
        local.detail(id).revisions,
      );
      report.versionedRestore = true;
      assert.deepEqual(restored.savedQueries(), local.savedQueries());
      assert.equal(restored.quoteSource(excerptId).current, true);
      report.savedQueryAndExcerptRestore = true;
      assert.deepEqual(
        restored.research(researchId),
        local.research(researchId),
      );
      assert.equal(restored.detail(id).discussions[0].researchId, researchId);
      report.researchAndDiscussionRestore = true;
      assert.deepEqual(
        restored.material(materialId),
        local.material(materialId),
      );
      const restoredMaterials = new Materials(
        restored,
        () => 32768,
        () => {},
        () => {},
        (hash) => restoredSync.downloadBlob(hash),
      );
      assert.equal(
        readFileSync(
          await restoredMaterials.ensureOriginal(restored.material(materialId)),
          "utf8",
        ),
        materialText,
      );
      report.materialFileAndTextRestore = true;
      const deletedHash = restored.material(materialId).chunks[0].sha256;
      await restoredMaterials.action(materialId, "trash");
      await restoredMaterials.action(materialId, "purge");
      restored.append("note.trashed", { id });
      restored.append("note.purged", { id });
      await restoredSync.backup();
      assert.equal(restoredSync.lastSucceeded, true);
      assert.equal(
        (await dav.request("GET", `blobs/${deletedHash}.bin`)).status,
        404,
      );
      const final = new Store(join(dataRoot, "final", "thoughts.db"));
      stores.push(final);
      await new SyncEngine(final, dav, () => {}, "final-restore-v6").restore();
      assert.equal(final.material(materialId).purged, true);
      assert.equal(final.note(id).purged, true);
      assert.equal(final.note(excerptId).raw, "自己的理解与引用分开");
      assert.equal(final.quoteSource(excerptId).material, null);
      assert.equal(final.note(excerptId).materialQuote?.text, "资料已删除");
      assert.ok(!JSON.stringify(final.eventsAfter()).includes(materialText));
      report.permanentDeletionDoesNotRevive = true;
      const manifest = JSON.parse(
        Buffer.from((await dav.request("GET", "manifest.json")).body).toString(
          "utf8",
        ),
      );
      assert.equal(manifest.schemaVersion, 6);
      report.cloudFormat = 6;
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
