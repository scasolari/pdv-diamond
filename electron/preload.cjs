const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  syncTheme: (payload) => ipcRenderer.send("theme:sync", payload),
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  listDevices: () => ipcRenderer.invoke("devices:list"),
  connectDevice: (payload) => ipcRenderer.invoke("device:connect", payload),
  disconnectDevice: (deviceId) => ipcRenderer.invoke("device:disconnect", deviceId),
  getDeviceConnectionState: (deviceId) => ipcRenderer.invoke("device:get-connection-state", deviceId),
  onDeviceConnectionStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("device:connection-status", listener);

    return () => {
      ipcRenderer.removeListener("device:connection-status", listener);
    };
  },
  onDeviceConnectionLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("device:connection-log", listener);

    return () => {
      ipcRenderer.removeListener("device:connection-log", listener);
    };
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:update-status", listener);

    return () => {
      ipcRenderer.removeListener("app:update-status", listener);
    };
  },
});
