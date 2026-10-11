import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { UkiApi } from "../src/shared";
const localWrites = new Map<string, Promise<unknown>>();
const flushers = new Set<() => Promise<void>>();
ipcRenderer.on("uki:flush", async (_event, id: string) => {
  try {
    await Promise.all([...flushers].map((fn) => fn()));
    for (let pass = 0; pass < 10; pass++) {
      const snapshot = new Map(localWrites);
      await Promise.all(snapshot.values());
      if (
        [...localWrites].every(
          ([key, promise]) => snapshot.get(key) === promise,
        )
      ) {
        ipcRenderer.send("uki:flushed", id, null);
        return;
      }
    }
    throw new Error("草稿仍在更新，请停止输入后重试");
  } catch {
    ipcRenderer.send("uki:flushed", id, "本机草稿保存未完成，请重试或继续编辑");
  }
});
const api: UkiApi = {
  savedQueries: () => ipcRenderer.invoke("uki:savedQueries"),
  saveQuery: (input) => ipcRenderer.invoke("uki:saveQuery", input),
  deleteQuery: (id) => ipcRenderer.invoke("uki:deleteQuery", id),
  captureExcerpt: (input) => ipcRenderer.invoke("uki:captureExcerpt", input),
  quoteSource: (id) => ipcRenderer.invoke("uki:quoteSource", id),
  analyzeSelection: (input) =>
    ipcRenderer.invoke("uki:analyzeSelection", input),
  locateNote: (id) => ipcRenderer.invoke("uki:locateNote", id),
  onFlush: (callback) => {
    flushers.add(callback);
    return () => {
      flushers.delete(callback);
    };
  },
  importFiles: (noteId) => ipcRenderer.invoke("uki:importFiles", noteId),
  importDropped: (files, noteId) =>
    ipcRenderer.invoke(
      "uki:importDropped",
      files.map((file) => webUtils.getPathForFile(file)),
      noteId,
    ),
  materialPage: (query, before, trash, noteId) =>
    ipcRenderer.invoke("uki:materialPage", query, before, trash, noteId),
  materialDetail: (id) => ipcRenderer.invoke("uki:materialDetail", id),
  materialOriginal: (id, saveAs) =>
    ipcRenderer.invoke("uki:materialOriginal", id, saveAs),
  materialAction: (id, operation) =>
    ipcRenderer.invoke("uki:materialAction", id, operation),
  onProgress: (callback) => {
    const listener = (
      _event: unknown,
      progress: { id: string; text: string },
    ) => callback(progress);
    ipcRenderer.on("uki:progress", listener);
    return () => ipcRenderer.removeListener("uki:progress", listener);
  },
  aiTasks: () => ipcRenderer.invoke("uki:aiTasks"),
  referenceTitles: (ids) => ipcRenderer.invoke("uki:referenceTitles", ids),
  trash: (ids, operation) => ipcRenderer.invoke("uki:trash", ids, operation),
  bookmark: (id, value) => ipcRenderer.invoke("uki:bookmark", id, value),
  pin: (id, value) => ipcRenderer.invoke("uki:pin", id, value),
  conversations: (id, before) =>
    ipcRenderer.invoke("uki:conversations", id, before),
  editCognition: (id, version, content) =>
    ipcRenderer.invoke("uki:editCognition", id, version, content),
  cognitionVersion: (id, version) =>
    ipcRenderer.invoke("uki:cognitionVersion", id, version),
  restoreCognition: (id, version, base) =>
    ipcRenderer.invoke("uki:restoreCognition", id, version, base),
  cancelAi: (id, kind) => ipcRenderer.invoke("uki:cancelAi", id, kind),
  taskDetail: (id) => ipcRenderer.invoke("uki:taskDetail", id),
  exportNotes: (ids, threadId) =>
    ipcRenderer.invoke("uki:exportNotes", ids, threadId),
  moveBatch: (ids, threadId) =>
    ipcRenderer.invoke("uki:moveBatch", ids, threadId),
  undoMove: (id) => ipcRenderer.invoke("uki:undoMove", id),
  research: (input) => ipcRenderer.invoke("uki:research", input),
  researchAuto: (input) => ipcRenderer.invoke("uki:researchAuto", input),
  recapDetail: (id) => ipcRenderer.invoke("uki:recapDetail", id),
  researchDetail: (id) => ipcRenderer.invoke("uki:researchDetail", id),
  researchSource: (id, sourceId) =>
    ipcRenderer.invoke("uki:researchSource", id, sourceId),
  cancelResearch: (id) => ipcRenderer.invoke("uki:cancelResearch", id),
  openSource: (url) => ipcRenderer.invoke("uki:openSource", url),
  dataReport: (before) => ipcRenderer.invoke("uki:dataReport", before),
  importDetail: (id) => ipcRenderer.invoke("uki:importDetail", id),
  bootstrap: () => ipcRenderer.invoke("uki:bootstrap"),
  workspace: (query) => ipcRenderer.invoke("uki:workspace", query),
  detail: (id) => ipcRenderer.invoke("uki:detail", id),
  resources: (id) => ipcRenderer.invoke("uki:resources", id),
  workspaceState: (key, value) => {
    const request = ipcRenderer.invoke("uki:workspaceState", key, value);
    if (value !== undefined) localWrites.set(key, request);
    return request;
  },
  preferences: (value) => ipcRenderer.invoke("uki:preferences", value),
  thread: (input) => ipcRenderer.invoke("uki:thread", input),
  correct: (id, raw, version) =>
    ipcRenderer.invoke("uki:correct", id, raw, version),
  title: (id, title, base) => ipcRenderer.invoke("uki:title", id, title, base),
  structure: (ids, decision, target, targets) =>
    ipcRenderer.invoke("uki:structure", ids, decision, target, targets),
  undo: (id) => ipcRenderer.invoke("uki:undo", id),
  regenerate: (id) => ipcRenderer.invoke("uki:regenerate", id),
  retryTask: (id) => ipcRenderer.invoke("uki:retryTask", id),
  recap: (id, model) => ipcRenderer.invoke("uki:recap", id, model),
  view: () => ipcRenderer.invoke("uki:view"),
  capture: (input) => ipcRenderer.invoke("uki:capture", input),
  search: (query) => ipcRenderer.invoke("uki:search", query),
  retry: (id) => ipcRenderer.invoke("uki:retry", id),
  move: (id, thread) => ipcRenderer.invoke("uki:move", id, thread),
  propose: (id, model) => ipcRenderer.invoke("uki:propose", id, model),
  resolve: (id, decision, content) =>
    ipcRenderer.invoke("uki:resolve", id, decision, content),
  saveSettings: (settings, key, password) =>
    ipcRenderer.invoke("uki:settings", settings, key, password),
  sync: () => ipcRenderer.invoke("uki:sync"),
  restore: () => ipcRenderer.invoke("uki:restore"),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("uki:changed", listener);
    return () => {
      ipcRenderer.removeListener("uki:changed", listener);
    };
  },
};
contextBridge.exposeInMainWorld("uki", api);
