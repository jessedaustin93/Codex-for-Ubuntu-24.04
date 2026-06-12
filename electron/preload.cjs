const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexLinux", {
  getEnvironment: () => ipcRenderer.invoke("app:get-environment"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  connect: (workspace) => ipcRenderer.invoke("codex:connect", workspace),
  disconnect: () => ipcRenderer.invoke("codex:disconnect"),
  startThread: (options) => ipcRenderer.invoke("codex:start-thread", options),
  listThreads: () => ipcRenderer.invoke("codex:list-threads"),
  resumeThread: (threadId) => ipcRenderer.invoke("codex:resume-thread", threadId),
  startTurn: (payload) => ipcRenderer.invoke("codex:start-turn", payload),
  interruptTurn: (payload) => ipcRenderer.invoke("codex:interrupt-turn", payload),
  respond: (payload) => ipcRenderer.invoke("codex:respond", payload),
  listMemories: (query) => ipcRenderer.invoke("memory:list", query),
  setMemoriesEnabled: (enabled) => ipcRenderer.invoke("memory:set-enabled", enabled),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
  onEvent: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("codex:event", listener);
    return () => ipcRenderer.removeListener("codex:event", listener);
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("codex:status", listener);
    return () => ipcRenderer.removeListener("codex:status", listener);
  }
});
