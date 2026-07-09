const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  syncTheme: (payload) => ipcRenderer.send("theme:sync", payload),
});
