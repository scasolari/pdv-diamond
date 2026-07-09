const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  syncTheme: (payload) => ipcRenderer.send("theme:sync", payload),
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:update-status", listener);

    return () => {
      ipcRenderer.removeListener("app:update-status", listener);
    };
  },
});
