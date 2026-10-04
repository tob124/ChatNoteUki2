import { contextBridge, ipcRenderer } from "electron";
import type { UkiApi } from "../src/shared";
const api: UkiApi = {
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
  cancelAi: (id, kind) => ipcRenderer.invoke("uki:cancelAi", id, kind),
  taskDetail: (id) => ipcRenderer.invoke("uki:taskDetail", id),
  exportNotes: (ids, threadId) =>
    ipcRenderer.invoke("uki:exportNotes", ids, threadId),
  moveBatch: (ids, threadId) =>
    ipcRenderer.invoke("uki:moveBatch", ids, threadId),
  undoMove: (id) => ipcRenderer.invoke("uki:undoMove", id),
  research: (input) => ipcRenderer.invoke("uki:research", input),
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
  workspaceState: (key, value) =>
    ipcRenderer.invoke("uki:workspaceState", key, value),
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
