import { app, BrowserWindow, ipcMain, Menu, protocol, net } from "electron";
import { join, resolve, sep } from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { Store } from "./store";
import { Credentials } from "./credentials";
import { AiQueue, safeAiError } from "./ai";
import { SyncEngine, WebDav } from "./webdav";
import { AutoSync } from "./auto-sync";
import {
  settingsSchema,
  stateContentSchema,
  type AppView,
  type Bootstrap,
  type SyncDiagnostic,
} from "../src/shared";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
// Keep installed builds and the setup helper on the same stable profile path.
// An explicit profile isolates acceptance tests and supports portable data.
const profile = process.env.UKI_DATA_DIR
  ? resolve(process.env.UKI_DATA_DIR)
  : join(app.getPath("appData"), "ChatNoteUki");
mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
let win: BrowserWindow | null = null;
let store: Store;
let credentials: Credentials;
let ai: AiQueue;
let sync: SyncEngine | null = null;
const diagnostics: SyncDiagnostic[] = [];
const automaticSync = new AutoSync(async (kind) => {
  const engine = sync;
  if (!engine) throw new Error("请先配置坚果云");
  try {
    if (kind === "full") await engine.sync();
    else if (kind === "restore") await engine.restore();
    else await engine.backup();
    if (!engine.lastSucceeded) throw new Error(engine.status);
  } finally {
    if (kind !== "backup") void ai.pump();
  }
});
const uuid = z.string().uuid();
const model = z.enum(["deepseek-flash", "deepseek-v4-pro"]);
function notify() {
  win?.webContents.send("uki:changed");
}
function scheduleBackup() {
  if (sync) automaticSync.changed();
}
function changed() {
  notify();
}
function configureSync() {
  const settings = credentials.settings();
  let password: string;
  try {
    password = credentials.davPassword();
  } catch {
    sync = null;
    automaticSync.configure(false, 60000);
    return;
  }
  sync =
    settings.davUser && password
      ? new SyncEngine(
          store,
          new WebDav(settings, password, (r) => {
            const stats = JSON.parse(
              store.getMeta("syncStatistics") ??
                '{"read":0,"written":0,"lastCheck":null}',
            );
            if (r.method === "GET") stats.read++;
            else stats.written++;
            stats.lastCheck = r.at;
            store.setMeta("syncStatistics", JSON.stringify(stats));
            diagnostics.push(r);
            if (diagnostics.length > 200) diagnostics.shift();
          }),
          notify,
          `${settings.davUrl}|${settings.davUser}|${settings.directory}|${credentials.revision()}|nutstore-v2`,
        )
      : null;
  automaticSync.configure(
    !!sync && settings.autoSync,
    settings.syncIntervalSeconds * 1000,
  );
}
function view(): AppView {
  return {
    ...store.snapshot(),
    settings: credentials.view(),
    syncStatus: sync?.status ?? "配置坚果云后可导入手机笔记和备份",
    aiStatus: ai.status,
    deviceId: store.getMeta("deviceId")!,
    pendingSync: store.latestSeq() - Number(store.getMeta("syncedSeq") ?? 0),
    canRestore: store.latestSeq() === 0,
  };
}
function bootstrap(): Bootstrap {
  return {
    threads: store.threads(),
    counts: store.counts(),
    settings: credentials.view(),
    syncStatus: sync?.status ?? "配置坚果云后同步",
    aiStatus: ai.status,
    deviceId: store.getMeta("deviceId")!,
    pendingSync: store.latestSeq() - Number(store.getMeta("syncedSeq") ?? 0),
    canRestore: store.latestSeq() === 0,
    latest: store.latestSeq(),
    profile,
    version: app.getVersion(),
    diagnostics: [...diagnostics],
    statistics: JSON.parse(
      store.getMeta("syncStatistics") ??
        '{"read":0,"written":0,"lastCheck":null}',
    ),
    tasks: store
      .latest<import("../src/shared").AiTask>("tasks", 30)
      .map(({ input, result, ...task }) => {
        const resultId = uuid.safeParse(
          (result as { resultId?: string } | undefined)?.resultId,
        ).data;
        return {
          ...task,
          resultId,
          resultBefore: resultId ? store.resultBefore(resultId) : undefined,
        };
      }),
  };
}
function registerIpc() {
  const handle = (name: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(`uki:${name}`, async (event, ...args) => {
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("不允许的调用来源");
      try {
        return await fn(...args);
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new Error("输入格式无效，请检查内容或设置");
        throw new Error(safeAiError(error));
      }
    });
  handle("view", view);
  handle("dataReport", (before) =>
    store.dataReport(z.number().int().positive().optional().parse(before)),
  );
  handle("importDetail", (id) => store.importDetail(uuid.parse(id)));
  handle("bootstrap", bootstrap);
  handle("workspace", (input) =>
    store.display(
      store.workspace(
        z
          .object({
            workspace: z.union([
              uuid,
              z.enum(["all", "pending", "organize", "review", "history"]),
            ]),
            before: z.number().int().positive().optional(),
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            query: z.string().max(200).optional(),
            searchIn: z.enum(["original", "reply"]).optional(),
            aiFilter: z.enum(["all", "pending", "failed"]).optional(),
          })
          .parse(input),
      ),
    ),
  );
  handle("detail", (id) => store.display(store.detail(uuid.parse(id))));
  handle("resources", (id) =>
    store.display(store.resources(uuid.nullable().parse(id))),
  );
  handle("workspaceState", (key, value) =>
    store.workspaceState(
      z.string().max(100).parse(key),
      value === undefined
        ? undefined
        : z
            .object({
              draft: z.string().max(50000),
              mode: z.enum(["note", "discussion"]),
              parentNoteId: uuid.nullable(),
              parentRevision: z.number().int().nonnegative().optional(),
              parentTitle: z.string().max(200).optional(),
              before: z.number().int().positive().optional(),
              anchor: uuid.optional(),
              anchorOffset: z.number().finite().optional(),
              date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional(),
              openIds: z.array(uuid).max(100),
              panel: z.enum(["closed", "normal", "wide", "max"]).optional(),
              scroll: z.number().nonnegative().optional(),
              discussionDraftMoved: z.boolean().optional(),
            })
            .parse(value),
    ),
  );
  handle("preferences", (value) =>
    store.preferences(
      value === undefined
        ? undefined
        : z
            .record(
              z.string().max(100),
              z.union([
                z.number().finite(),
                z.boolean(),
                z.string().max(10000),
              ]),
            )
            .parse(value),
    ),
  );
  handle("thread", (input) =>
    store.thread(
      z
        .object({
          id: uuid.optional(),
          title: z.string().trim().min(1).max(60),
          description: z.string().max(500),
          parentId: uuid.nullable(),
          archived: z.boolean().optional(),
        })
        .parse(input),
    ),
  );
  handle("correct", (id, raw) => {
    store.append("note.corrected", {
      id: uuid.parse(id),
      raw: z
        .string()
        .min(1)
        .max(50000)
        .refine((s) => !!s.trim())
        .parse(raw),
    });
    void ai.pump();
  });
  handle("title", (id, title) =>
    store.append("note.titled", {
      id: uuid.parse(id),
      title: z.string().trim().min(1).max(60).parse(title),
    }),
  );
  handle("structure", (ids, decision, target, targets) =>
    store.resolveStructures(
      z.array(uuid).min(1).max(30).parse(ids),
      z.enum(["accept", "reject", "defer"]).parse(decision),
      uuid.optional().parse(target),
      z.record(uuid, uuid).optional().parse(targets),
    ),
  );
  handle("undo", (id) =>
    store.append("structure.undone", { id: uuid.parse(id) }),
  );
  handle("regenerate", (id) => {
    const s = store.structure(uuid.parse(id));
    if (s.status === "pending") store.resolveStructures([s.id], "defer");
    store.addTask(
      "organize",
      null,
      "deepseek-flash",
      s.evidence.map((e) => e.noteId).slice(0, 10),
    );
    void ai.pump();
  });
  handle("retryTask", (id) => {
    const task = store.task(uuid.parse(id));
    if (!task || !["failed", "budget"].includes(task.status))
      throw new Error("该任务不能重试");
    store.append("task.updated", {
      id: task.id,
      status: "pending",
      error: null,
    });
    void ai.pump();
  });
  handle("recap", (id, selectedModel) => {
    const task = ai.queueAnalysis(
      "recap",
      uuid.parse(id),
      model.parse(selectedModel),
    );
    void ai.pump();
    return task;
  });
  handle("capture", (input) => {
    const id = store.capture(input);
    changed();
    void ai.pump();
    return id;
  });
  handle("search", (query) => store.search(z.string().max(200).parse(query)));
  handle("retry", (id) => {
    store.append("note.retried", { id: uuid.parse(id) });
    changed();
    void ai.pump();
  });
  handle("move", (id, threadId) => {
    store.append("note.moved", {
      id: uuid.parse(id),
      threadId: uuid.nullable().parse(threadId),
    });
    changed();
  });
  handle("propose", (id, selectedModel) => {
    const task = ai.queueAnalysis(
      "cognition",
      uuid.parse(id),
      model.parse(selectedModel),
    );
    void ai.pump();
    return task;
  });
  handle("resolve", (id, decision, content) => {
    store.append("proposal.resolved", {
      id: uuid.parse(id),
      decision: z.enum(["accept", "reject"]).parse(decision),
      content:
        content === undefined ? undefined : stateContentSchema.parse(content),
    });
    changed();
  });
  handle("settings", (settings, key, password) => {
    const previous = credentials.settings();
    const next = settingsSchema.parse(settings);
    const cloudChanged =
      previous.davUrl !== next.davUrl ||
      previous.davUser !== next.davUser ||
      previous.directory !== next.directory;
    if (cloudChanged && Number(store.getMeta("syncedSeq") ?? 0) > 0)
      throw new Error(
        "已有云端备份时不能直接切换账户或目录；请先在新 Windows 资料目录恢复",
      );
    credentials.save(
      next,
      z.string().max(300).optional().parse(key),
      z.string().max(300).optional().parse(password),
    );
    configureSync();
    if (
      next.dailyInputLimit !== previous.dailyInputLimit ||
      next.dailyOutputLimit !== previous.dailyOutputLimit
    )
      store.setMeta("noteBudgetDay", "");
    notify();
    void ai.pump();
    scheduleBackup();
    if (sync && next.autoSync) void automaticSync.run("full").catch(() => {});
  });
  handle("sync", () => automaticSync.run("full"));
  handle("restore", async () => {
    if (!sync) throw new Error("请先配置坚果云");
    await automaticSync.run("restore");
    scheduleBackup();
  });
}
async function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: "#f5f7fa",
    title: "ChatNoteUki",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
  const dev =
    !app.isPackaged && process.env.UKI_DEV_URL === "http://127.0.0.1:5173"
      ? process.env.UKI_DEV_URL
      : null;
  await win.loadURL(dev ?? "app://uki/index.html");
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      if (process.platform !== "win32")
        throw new Error("ChatNoteUki 首版仅支持 Windows");
      const data = app.getPath("userData");
      mkdirSync(data, { recursive: true });
      store = new Store(join(data, "thoughts.db"));
      store.reimportRawNotes();
      store.recoverInterrupted();
      credentials = new Credentials(join(data, "credentials.json"));
      ai = new AiQueue(store, credentials, changed);
      configureSync();
      store.onCommitted = () => {
        notify();
        scheduleBackup();
      };
      const root = resolve(__dirname, "../dist");
      protocol.handle("app", (request) => {
        const url = new URL(request.url);
        if (url.hostname !== "uki")
          return new Response("Not found", { status: 404 });
        const path = resolve(root, "." + decodeURIComponent(url.pathname));
        if (!path.startsWith(root + sep))
          return new Response("Forbidden", { status: 403 });
        return net.fetch(pathToFileURL(path).toString());
      });
      Menu.setApplicationMenu(null);
      registerIpc();
      await createWindow();
      void ai.pump();
      if (sync) void automaticSync.run("full").catch(() => {});
      const aiWake = setInterval(() => void ai.pump(), 60000);
      app.on("before-quit", () => {
        clearInterval(aiWake);
        ai.stop();
      });
    })
    .catch((error) => {
      console.error(safeAiError(error));
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    automaticSync.stop();
    store?.close();
  });
}
