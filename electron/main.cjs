const { app, BrowserWindow, dialog, ipcMain, nativeTheme, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const net = require("net");
const fs = require("fs");

const defaultPort = Number(process.env.PORT || 3000);
const devServerUrl = process.env.ELECTRON_URL || `http://localhost:${defaultPort}`;
const appEntryUrl = `${devServerUrl.replace(/\/$/, "")}/app/dashboard`;
const isDev = process.env.NODE_ENV === "development";
const electronSessionPartition = "persist:placedv-desktop";

let mainWindow;
let isQuitting = false;
let updateStatus = {
  state: "idle",
  label: "Check for updates",
};

function getUpdateErrorStatus(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const stack = String(error?.stack || "").toLowerCase();
  const fullText = `${message}\n${stack}`;

  if (message.includes("status code 404") || message.includes("404")) {
    return {
      state: "error",
      label: "GitHub 404",
    };
  }

  if (message.includes("status code 401") || message.includes("401") || message.includes("status code 403") || message.includes("403")) {
    return {
      state: "error",
      label: "GitHub auth",
    };
  }

  if (message.includes("no published versions") || message.includes("no valid update available")) {
    return {
      state: "up-to-date",
      label: "No update",
    };
  }

  if (fullText.includes("code signature") || fullText.includes("signature") || fullText.includes("signed")) {
    return {
      state: "error",
      label: "Signature error",
    };
  }

  if (message.includes("net::err_internet_disconnected") || message.includes("network") || message.includes("socket") || message.includes("timeout")) {
    return {
      state: "error",
      label: "Network error",
    };
  }

  if (message.includes("yaml")) {
    return {
      state: "error",
      label: "Metadata error",
    };
  }

  return {
    state: "error",
    label: "Update error",
  };
}

function getWindowBackgroundColor(resolvedTheme) {
  return resolvedTheme === "dark" ? "#1c1c1e" : "#ffffff";
}

function syncWindowChromeTheme(theme, resolvedTheme) {
  const nextThemeSource = theme === "system" ? "system" : theme === "dark" ? "dark" : "light";
  const nextResolvedTheme =
    resolvedTheme ?? (nextThemeSource === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : nextThemeSource);

  nativeTheme.themeSource = nextThemeSource;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(getWindowBackgroundColor(nextResolvedTheme));
  }
}

function waitForPort(portToCheck, host = "127.0.0.1", timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    function tryConnect() {
      const socket = net.createConnection({ port: portToCheck, host }, () => {
        socket.end();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - startTime >= timeoutMs) {
          reject(new Error(`Timed out waiting for localhost:${portToCheck}`));
          return;
        }

        setTimeout(tryConnect, 250);
      });
    }

    tryConnect();
  });
}

function getAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      server.close();

      if (error.code === "EADDRINUSE") {
        const fallbackServer = net.createServer();

        fallbackServer.once("error", reject);
        fallbackServer.listen(0, "127.0.0.1", () => {
          const address = fallbackServer.address();
          const freePort = typeof address === "object" && address ? address.port : preferredPort;

          fallbackServer.close(() => resolve(freePort));
        });
        return;
      }

      reject(error);
    });

    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();
      const freePort = typeof address === "object" && address ? address.port : preferredPort;

      server.close(() => resolve(freePort));
    });
  });
}

function broadcastUpdateStatus(nextStatus) {
  updateStatus = nextStatus;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:update-status", updateStatus);
  }
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    broadcastUpdateStatus({
      state: "checking",
      label: "Checking...",
    });
  });

  autoUpdater.on("update-available", () => {
    broadcastUpdateStatus({
      state: "downloading",
      label: "Downloading...",
    });
  });

  autoUpdater.on("update-not-available", () => {
    broadcastUpdateStatus({
      state: "up-to-date",
      label: "Up to date",
    });
  });

  autoUpdater.on("download-progress", () => {
    broadcastUpdateStatus({
      state: "downloading",
      label: "Downloading...",
    });
  });

  autoUpdater.on("update-downloaded", () => {
    broadcastUpdateStatus({
      state: "downloaded",
      label: "Restart to update",
    });
  });

  autoUpdater.on("error", (error) => {
    console.error("Electron autoUpdater error:", {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      statusCode: error?.statusCode,
      name: error?.name,
    });

    broadcastUpdateStatus(getUpdateErrorStatus(error));
  });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 780,
        minWidth: 840,
        minHeight: 620,
        backgroundColor: getWindowBackgroundColor(nativeTheme.shouldUseDarkColors ? "dark" : "light"),
        ...(process.platform === "darwin"
            ? {
                titleBarStyle: "hiddenInset",
                trafficLightPosition: { x: 16, y: 14 },

            }
            : {}),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            partition: "persist:placedv-desktop",
            preload: path.join(__dirname, "preload.cjs"),
        },
    });

    mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.on("before-input-event", (event, input) => {
      const isZoomShortcut =
        (input.meta || input.control) &&
        ["+", "-", "0"].includes(input.key);

      if (isZoomShortcut) {
        event.preventDefault();
      }
    });

    mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function getProductionServerPaths() {
  const standaloneDir = path.join(process.resourcesPath, "app-standalone");

  return {
    standaloneDir,
    serverEntry: path.join(standaloneDir, "server.js"),
  };
}

async function startStandaloneServer(serverEntry, standaloneDir, serverPort) {
  process.env.NODE_ENV = "production";
  process.env.PORT = String(serverPort);
  process.env.HOSTNAME = "127.0.0.1";
  process.chdir(standaloneDir);

  require(serverEntry);
}

ipcMain.on("theme:sync", (_event, payload) => {
  syncWindowChromeTheme(payload?.theme, payload?.resolvedTheme);
});

ipcMain.handle("app:get-info", () => {
  return {
    version: app.getVersion(),
    updateStatus,
  };
});

ipcMain.handle("app:check-for-updates", async () => {
  if (!app.isPackaged) {
    broadcastUpdateStatus({
      state: "idle",
      label: "Updates disabled in dev",
    });

    return updateStatus;
  }

  try {
    if (updateStatus.state === "downloaded") {
      setImmediate(() => {
        autoUpdater.quitAndInstall();
      });

      return updateStatus;
    }

    await autoUpdater.checkForUpdates();
    return updateStatus;
  } catch (error) {
    console.error("Electron checkForUpdates failed:", {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      statusCode: error?.statusCode,
      name: error?.name,
    });

    broadcastUpdateStatus(getUpdateErrorStatus(error));

    return updateStatus;
  }
});

async function loadApp() {
  configureAutoUpdater();
  createWindow();

  if (isDev) {
    await mainWindow.loadURL(appEntryUrl);
    return;
  }

  const { standaloneDir, serverEntry } = getProductionServerPaths();
  const serverPort = await getAvailablePort(defaultPort);

  if (!fs.existsSync(serverEntry)) {
    await dialog.showErrorBox(
      "Build mancante",
      "Build standalone mancante. Rigenera la build Electron dopo `npm run build`."
    );
    app.quit();
    return;
  }

  await startStandaloneServer(serverEntry, standaloneDir, serverPort);

  await waitForPort(serverPort);
  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}/app/dashboard`);
}

app.on("before-quit", async (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  app.isQuitting = true;

  try {
    await session.fromPartition(electronSessionPartition).flushStorageData();
  } catch (error) {
    console.error("Failed to flush Electron storage:", error);
  }

  app.quit();
});

app.whenReady().then(loadApp).catch((error) => {
  dialog.showErrorBox("Avvio Electron fallito", error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    loadApp().catch((error) => {
      dialog.showErrorBox("Riapertura Electron fallita", error.message);
    });
  }
});
