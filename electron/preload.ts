import { contextBridge, ipcRenderer } from "electron";
import type { UkiApi } from "../src/shared";
const api: UkiApi = {
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
  correct: (id, raw) => ipcRenderer.invoke("uki:correct", id, raw),
  title: (id, title) => ipcRenderer.invoke("uki:title", id, title),
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
