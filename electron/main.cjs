const { app, BrowserWindow, dialog, ipcMain, nativeTheme, session } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");

const port = Number(process.env.PORT || 3000);
const devServerUrl = process.env.ELECTRON_URL || `http://localhost:${port}`;
const appEntryUrl = `${devServerUrl.replace(/\/$/, "")}/app/dashboard`;
const isDev = process.env.NODE_ENV === "development";
const electronSessionPartition = "persist:placedv-desktop";

let mainWindow;
let nextServerProcess;
let isQuitting = false;

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

    mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("theme:sync", (_event, payload) => {
  syncWindowChromeTheme(payload?.theme, payload?.resolvedTheme);
});

async function loadApp() {
  createWindow();

  if (isDev) {
    await mainWindow.loadURL(appEntryUrl);
    return;
  }

  const nextBin = path.join(
    app.getAppPath(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  );
  const buildDir = path.join(app.getAppPath(), ".next");

  if (!fs.existsSync(buildDir)) {
    await dialog.showErrorBox(
      "Build mancante",
      "Esegui `npm run build` prima di avviare l'app Electron in modalita produzione."
    );
    app.quit();
    return;
  }

  nextServerProcess = spawn(
    process.execPath,
    [nextBin, "start", "-p", String(port)],
    {
      cwd: app.getAppPath(),
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "inherit",
    }
  );

  nextServerProcess.on("exit", (code) => {
    if (!app.isQuitting && code !== 0) {
      dialog.showErrorBox(
        "Next.js terminato",
        `Il server Next.js si e chiuso con codice ${code ?? "sconosciuto"}.`
      );
      app.quit();
    }
  });

  await waitForPort(port);
  await mainWindow.loadURL(`http://localhost:${port}/app/dashboard`);
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

  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill();
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
