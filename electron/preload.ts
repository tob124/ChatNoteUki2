import { contextBridge, ipcRenderer } from "electron";
import type { UkiApi } from "../src/shared";
const api: UkiApi = {
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
