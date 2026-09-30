/** Explicit local setup + isolated real WebDAV verification. Secrets only come from the process environment. */
import { app } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Credentials } from "../electron/credentials";
import { Store } from "../electron/store";
import { WebDav, SyncEngine, strongEtag, type Dav } from "../electron/webdav";

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const user = process.env.UKI_DAV_USER;
const password = process.env.UKI_DAV_PASSWORD;
const apiKey = process.env.UKI_API_KEY;
delete process.env.UKI_DAV_USER;
delete process.env.UKI_DAV_PASSWORD;
delete process.env.UKI_API_KEY;

app
  .whenReady()
  .then(async () => {
    if (!user || !password)
      throw new Error("请为此进程设置 UKI_DAV_USER 和 UKI_DAV_PASSWORD");
    const folder = "ChatNoteUki";
    const profile = join(app.getPath("appData"), "ChatNoteUki");
    mkdirSync(profile, { recursive: true });
    const credentials = new Credentials(join(profile, "credentials.json"));
    const settings = {
      ...credentials.settings(),
      davUrl: "https://dav.jianguoyun.com/dav/",
      davUser: user,
      directory: folder,
    };
    const rootDav = new WebDav(settings, password);
    const root = await rootDav.request("PROPFIND", "", undefined, {
      Depth: "0",
    });
    if (![200, 207].includes(root.status))
      throw new Error(`指定文件夹无法访问（HTTP ${root.status}）`);
    const original = await rootDav.request("GET", "inbox.txt");
    if (![200, 404].includes(original.status))
      throw new Error(`无法检查正式 inbox（HTTP ${original.status}）`);
    const previousSettings = credentials.settings();
    const production = new Store(join(profile, "thoughts.db"));
    if (
      Number(production.getMeta("syncedSeq") ?? 0) > 0 &&
      (previousSettings.davUrl !== settings.davUrl ||
        previousSettings.directory !== settings.directory ||
        previousSettings.davUser !== settings.davUser)
    ) {
      production.close();
      throw new Error("已有云端备份，不能直接更换账户或目录");
    }
    credentials.save(
      settings,
      credentials.view().hasApiKey ? undefined : apiKey,
      password,
    );
    process.stdout.write(
      "账户与文件夹已验证；本机凭据已加密保存。开始隔离联调。\n",
    );
    const childName = `verify-${randomUUID()}`;
    const testDav = new WebDav(
      { ...settings, directory: `${folder}/${childName}` },
      password,
    );
    let owned = false;
    const stores: Store[] = [production];
    const trace: {
      method: string;
      path: string;
      status: number;
      strongEtag: boolean;
    }[] = [];
    const dav: Dav = {
      request: async (method, path, body, headers) => {
        const response = await testDav.request(method, path, body, headers);
        trace.push({
          method,
          path,
          status: response.status,
          strongEtag: strongEtag(response.etag),
        });
        return response;
      },
    };
    const report: Record<string, unknown> = {
      configured: true,
      folderVerified: true,
      originalInboxExisted: original.status === 200,
      paidAiCalls: 0,
    };
    try {
      const created = await testDav.request("MKCOL", "");
      if (created.status !== 201)
        throw new Error(`临时验证目录创建失败（HTTP ${created.status}）`);
      owned = true;
      const fixture =
        "\uFEFF联调记录一\r\n保留单次换行\r\n\r\n联调记录二\r\n\r\n联调记录二";
      const seed = await testDav.request("PUT", "inbox.txt", fixture, {
        "If-None-Match": "*",
      });
      if (![200, 201, 204].includes(seed.status))
        throw new Error(`测试入口写入失败（HTTP ${seed.status}）`);
      const local = new Store(":memory:");
      stores.push(local);
      const engine = new SyncEngine(local, dav);
      await engine.sync();
      const notes = local.snapshot().notes;
      report.importedNotes = notes.length;
      report.orderAndNewlinesPreserved =
        JSON.stringify(notes.map((n) => n.raw)) ===
        JSON.stringify([
          "联调记录一\r\n保留单次换行",
          "联调记录二",
          "联调记录二",
        ]);
      const after = await testDav.request("GET", "inbox.txt");
      report.conditionalClear = after.status === 200 && after.body.length === 0;
      report.importStatus = engine.status;
      if (report.conditionalClear) {
        const recovered = new Store(":memory:");
        stores.push(recovered);
        await new SyncEngine(recovered, dav).restore();
        report.fullRestore =
          JSON.stringify(recovered.snapshot()) ===
          JSON.stringify(local.snapshot());
        if (!report.orderAndNewlinesPreserved || !report.fullRestore)
          throw new Error("原文顺序或云端恢复验证未通过");
        process.stdout.write(
          "隔离笔记导入、条件清空和完整恢复已通过；初始化正式备份目录。\n",
        );
        const prod = new SyncEngine(production, rootDav);
        await prod.backup();
        report.productionBackup = prod.status;
        // Create only after real conditional-write support has been verified. Never empty an existing inbox.
        if (original.status === 404) {
          const current = await rootDav.request("GET", "inbox.txt");
          if (current.status === 404) {
            const create = await rootDav.request("PUT", "inbox.txt", "", {
              "If-None-Match": "*",
            });
            if (![200, 201, 204, 412].includes(create.status))
              throw new Error(`正式 inbox 初始化失败（HTTP ${create.status}）`);
            report.inboxCreated = create.status !== 412;
          }
        }
      } else {
        report.fullRestore = false;
        report.conditionDiagnostics = trace.filter((t) =>
          t.path.startsWith(".condition-probe-"),
        );
      }
      const final = await rootDav.request("GET", "inbox.txt");
      report.existingInboxUntouched =
        original.status === 404 ||
        (final.status === 200 && digest(final.body) === digest(original.body));
      report.apiKeyConfigured = credentials.view().hasApiKey;
    } finally {
      for (const store of stores) store.close();
      if (owned) {
        if (!/^verify-[a-f0-9-]{36}$/.test(childName))
          throw new Error("清理验证目录检查失败");
        const removed = await testDav.request("DELETE", "").catch(() => null);
        report.temporaryFolderRemoved =
          !!removed && [200, 204, 404].includes(removed.status);
      }
      const out = resolve(".local", "webdav-verification");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    }
  })
  .catch((error) => {
    process.stderr.write(
      (error instanceof Error ? error.message : "联调失败").replace(
        /sk-[A-Za-z0-9_-]+/g,
        "[已隐藏]",
      ) + "\n",
    );
    process.exitCode = 1;
  })
  .finally(() => app.exit(Number(process.exitCode ?? 0)));
