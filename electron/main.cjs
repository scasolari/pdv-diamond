const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { SerialPort } = require("serialport");
const { Client: SshClient } = require("ssh2");
const { execFile, spawn } = require("child_process");
const os = require("os");
const path = require("path");
const net = require("net");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const sshDiscoveryPort = 22;
const sshDiscoveryTimeoutMs = 180;
const sshDiscoveryConcurrency = 48;

const defaultPort = Number(process.env.PORT || 3000);
const localAppHost = "127.0.0.1";
const devServerUrl = process.env.ELECTRON_URL || `http://${localAppHost}:${defaultPort}`;
const appEntryUrl = `${devServerUrl.replace(/\/$/, "")}/app/dashboard`;
const isDev = process.env.NODE_ENV === "development";
const electronSessionPartition = "persist:placedv-desktop";
const desktopAppName = "Placedv AI";
const updateCheckIntervalMs = 5 * 60 * 1000;
const sshTerminalInactivityTimeoutMs = 5 * 60 * 1000;
const serialConnectionLogLimit = 200;
const deviceTerminalSessions = new Map();
const runtimeConfigFilename = "runtime-config.json";
const sshKnownHostsFilename = "ssh-known-hosts.json";
const requiredProductionEnvKeys = [
  "NEXTAUTH_SECRET",
];
const optionalProviderEnvGroups = [
  {
    name: "GitHub",
    keys: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  },
  {
    name: "Facebook",
    keys: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
  },
];

let mainWindow;
let isQuitting = false;
let updateCheckInterval;
let isUpdateCheckInProgress = false;
const deviceConnections = new Map();
let updateStatus = {
  state: "idle",
  label: "Check for updates",
  progress: null,
};

app.setName(desktopAppName);
process.title = desktopAppName;

function parseEnvFile(fileContent) {
  return fileContent
    .split(/\r?\n/)
    .reduce((result, rawLine) => {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        return result;
      }

      const separatorIndex = line.indexOf("=");

      if (separatorIndex === -1) {
        return result;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      const unwrappedValue =
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
          ? rawValue.slice(1, -1)
          : rawValue;

      if (key) {
        result[key] = unwrappedValue;
      }

      return result;
    }, {});
}

function loadDesktopEnv() {
  if (app.isPackaged) {
    return;
  }

  const candidatePaths = [
    path.join(process.cwd(), ".env"),
  ];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    try {
      const parsedEnv = parseEnvFile(fs.readFileSync(candidatePath, "utf8"));

      for (const [key, value] of Object.entries(parsedEnv)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      console.error(`Failed to load env file at ${candidatePath}:`, error);
    }
  }
}

loadDesktopEnv();

function toPrismaSqliteUrl(filePath) {
  return `file:${filePath.split(path.sep).join("/")}`;
}

function getRuntimeConfigPath() {
  return path.join(app.getPath("userData"), runtimeConfigFilename);
}

function getKnownHostsPath() {
  return path.join(app.getPath("userData"), sshKnownHostsFilename);
}

function loadKnownHosts() {
  const knownHostsPath = getKnownHostsPath();

  if (!fs.existsSync(knownHostsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(knownHostsPath, "utf8"));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch (error) {
    console.error(`Failed to read known hosts file at ${knownHostsPath}:`, error);
    return {};
  }
}

function saveKnownHosts(knownHosts) {
  const knownHostsPath = getKnownHostsPath();
  fs.mkdirSync(path.dirname(knownHostsPath), { recursive: true });
  fs.writeFileSync(knownHostsPath, `${JSON.stringify(knownHosts, null, 2)}\n`, "utf8");
}

function getKnownHostKey(host, port) {
  return `${host}:${port}`;
}

function getSshHostFingerprint(hostKey) {
  return `SHA256:${crypto
    .createHash("sha256")
    .update(hostKey)
    .digest("base64")
    .replace(/=+$/g, "")}`;
}

function getDefaultRuntimeConfig() {
  return {
    NEXTAUTH_SECRET: "",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    FACEBOOK_CLIENT_ID: "",
    FACEBOOK_CLIENT_SECRET: "",
  };
}

function ensureRuntimeConfigFile() {
  const runtimeConfigPath = getRuntimeConfigPath();

  if (fs.existsSync(runtimeConfigPath)) {
    return runtimeConfigPath;
  }

  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
  fs.writeFileSync(
    runtimeConfigPath,
    `${JSON.stringify(getDefaultRuntimeConfig(), null, 2)}\n`,
    "utf8",
  );

  return runtimeConfigPath;
}

function loadRuntimeConfigFromDisk() {
  const runtimeConfigPath = ensureRuntimeConfigFile();

  try {
    const rawConfig = fs.readFileSync(runtimeConfigPath, "utf8");
    const parsedConfig = JSON.parse(rawConfig);

    if (!parsedConfig || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) {
      throw new Error("Runtime config must contain a JSON object.");
    }

    return {
      path: runtimeConfigPath,
      values: parsedConfig,
    };
  } catch (error) {
    throw new Error(`Unable to read runtime config at ${runtimeConfigPath}: ${error.message}`);
  }
}

function applyRuntimeConfigEnv() {
  if (!app.isPackaged) {
    return;
  }

  const { path: runtimeConfigPath, values } = loadRuntimeConfigFromDisk();

  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined && typeof value === "string" && value.trim()) {
      process.env[key] = value.trim();
    }
  }

  const missingKeys = requiredProductionEnvKeys.filter((key) => !String(process.env[key] || "").trim());
  const incompleteProviders = [];
  const enabledProviders = [];

  for (const providerGroup of optionalProviderEnvGroups) {
    const filledKeys = providerGroup.keys.filter((key) => String(process.env[key] || "").trim());

    if (filledKeys.length === 0) {
      continue;
    }

    if (filledKeys.length !== providerGroup.keys.length) {
      incompleteProviders.push({
        name: providerGroup.name,
        missingKeys: providerGroup.keys.filter((key) => !String(process.env[key] || "").trim()),
      });
      continue;
    }

    enabledProviders.push(providerGroup.name);
  }

  if (missingKeys.length > 0 || incompleteProviders.length > 0 || enabledProviders.length === 0) {
    const detailLines = [];

    if (missingKeys.length > 0) {
      detailLines.push(`Missing required keys: ${missingKeys.join(", ")}`);
    }

    if (incompleteProviders.length > 0) {
      for (const provider of incompleteProviders) {
        detailLines.push(`${provider.name} is partially configured. Missing keys: ${provider.missingKeys.join(", ")}`);
      }
    }

    if (enabledProviders.length === 0) {
      detailLines.push("No auth provider is fully configured. Configure at least one provider.");
    }

    const error = new Error(
      [
        "The packaged app is missing required runtime secrets.",
        "",
        `Config file: ${runtimeConfigPath}`,
        ...detailLines,
      ].join("\n"),
    );
    error.code = "RUNTIME_CONFIG_MISSING";
    error.runtimeConfigPath = runtimeConfigPath;
    error.runtimeConfigDir = path.dirname(runtimeConfigPath);
    error.missingKeys = missingKeys;
    error.incompleteProviders = incompleteProviders;
    error.enabledProviders = enabledProviders;
    throw error;
  }
}

function getLocalDatabasePath() {
  return path.join(app.getPath("userData"), "placedv-local.db");
}

async function bootstrapLocalDatabaseWithSqlite(databasePath) {
  const statements = [
    "PRAGMA journal_mode = WAL;",
    "CREATE TABLE IF NOT EXISTS `User` (`id` TEXT NOT NULL PRIMARY KEY, `name` TEXT, `email` TEXT, `emailVerified` DATETIME, `image` TEXT, `admin` BOOLEAN NOT NULL DEFAULT false, `is2FAEnabled` BOOLEAN NOT NULL DEFAULT false, `is2FAActive` BOOLEAN NOT NULL DEFAULT false, `twoFASecret` TEXT);",
    "CREATE UNIQUE INDEX IF NOT EXISTS `User_email_key` ON `User`(`email`);",
    "CREATE TABLE IF NOT EXISTS `Session` (`id` TEXT NOT NULL PRIMARY KEY, `sessionToken` TEXT NOT NULL, `userId` TEXT NOT NULL, `expires` DATETIME NOT NULL);",
    "CREATE UNIQUE INDEX IF NOT EXISTS `Session_sessionToken_key` ON `Session`(`sessionToken`);",
    "CREATE TABLE IF NOT EXISTS `Account` (`id` TEXT NOT NULL PRIMARY KEY, `userId` TEXT NOT NULL, `type` TEXT NOT NULL, `provider` TEXT NOT NULL, `providerAccountId` TEXT NOT NULL, `refresh_token` TEXT, `access_token` TEXT, `expires_at` INTEGER, `token_type` TEXT, `scope` TEXT, `id_token` TEXT, `session_state` TEXT);",
    "CREATE UNIQUE INDEX IF NOT EXISTS `Account_provider_providerAccountId_key` ON `Account`(`provider`, `providerAccountId`);",
    "CREATE TABLE IF NOT EXISTS `VerificationToken` (`identifier` TEXT NOT NULL, `token` TEXT NOT NULL, `expires` DATETIME NOT NULL);",
    "CREATE UNIQUE INDEX IF NOT EXISTS `VerificationToken_token_key` ON `VerificationToken`(`token`);",
    "CREATE UNIQUE INDEX IF NOT EXISTS `VerificationToken_identifier_token_key` ON `VerificationToken`(`identifier`, `token`);",
    "CREATE TABLE IF NOT EXISTS `AppSetting` (`key` TEXT NOT NULL PRIMARY KEY, `value` TEXT NOT NULL, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    "CREATE TABLE IF NOT EXISTS `SavedDevice` (`id` TEXT NOT NULL PRIMARY KEY, `sourceKey` TEXT NOT NULL, `alias` TEXT NOT NULL, `name` TEXT NOT NULL, `baudRate` INTEGER NOT NULL DEFAULT 115200, `transport` TEXT NOT NULL, `type` TEXT NOT NULL, `source` TEXT NOT NULL, `path` TEXT, `address` TEXT, `port` INTEGER, `protocol` TEXT, `manufacturer` TEXT, `serialNumber` TEXT, `vendorId` TEXT, `productId` TEXT, `pnpId` TEXT, `mac` TEXT, `interface` TEXT, `archivedAt` DATETIME, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    "CREATE UNIQUE INDEX IF NOT EXISTS `SavedDevice_sourceKey_key` ON `SavedDevice`(`sourceKey`);",
    "CREATE TABLE IF NOT EXISTS `Mission` (`id` TEXT NOT NULL PRIMARY KEY, `name` TEXT NOT NULL, `deviceId` TEXT NOT NULL, `remotePath` TEXT NOT NULL, `entrypoint` TEXT NOT NULL, `notes` TEXT, `filesJson` TEXT NOT NULL DEFAULT '[]', `status` TEXT NOT NULL DEFAULT 'draft', `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT `Mission_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `SavedDevice` (`id`) ON DELETE CASCADE ON UPDATE CASCADE);",
    "CREATE INDEX IF NOT EXISTS `Mission_deviceId_idx` ON `Mission`(`deviceId`);",
  ];
  const migrationStatements = [
    "ALTER TABLE `SavedDevice` ADD COLUMN `mac` TEXT;",
    "ALTER TABLE `SavedDevice` ADD COLUMN `interface` TEXT;",
  ];
  let database;

  try {
    database = new DatabaseSync(databasePath);

    for (const statement of statements) {
      database.exec(statement);
    }

    for (const statement of migrationStatements) {
      try {
        database.exec(statement);
      } catch (error) {
        if (!String(error?.message || "").toLowerCase().includes("duplicate column name")) {
          throw error;
        }
      }
    }
  } catch (error) {
    throw new Error(`Unable to initialize SQLite schema at ${databasePath}: ${error.message}`);
  } finally {
    try {
      database?.close();
    } catch (error) {
      console.error(`Failed to close SQLite bootstrap database at ${databasePath}:`, error);
    }
  }
}

async function ensureLocalDatabaseSchema() {
  const databasePath = getLocalDatabasePath();

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  process.env.DATABASE_URL = toPrismaSqliteUrl(databasePath);

  try {
    await bootstrapLocalDatabaseWithSqlite(databasePath);
  } catch (error) {
    const bootstrapMessage = error?.message || "Unknown SQLite bootstrap error.";
    throw new Error(`Unable to initialize the local SQLite database.\n${String(bootstrapMessage).trim()}`);
  }
}

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

function waitForPort(portToCheck, host = localAppHost, timeoutMs = 30000) {
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
        fallbackServer.listen(0, localAppHost, () => {
          const address = fallbackServer.address();
          const freePort = typeof address === "object" && address ? address.port : preferredPort;

          fallbackServer.close(() => resolve(freePort));
        });
        return;
      }

      reject(error);
    });

    server.listen(preferredPort, localAppHost, () => {
      const address = server.address();
      const freePort = typeof address === "object" && address ? address.port : preferredPort;

      server.close(() => resolve(freePort));
    });
  });
}

function broadcastUpdateStatus(nextStatus) {
  updateStatus = {
    ...updateStatus,
    ...nextStatus,
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:update-status", updateStatus);
  }
}

function getDefaultDeviceConnectionSnapshot(deviceId) {
  return {
    deviceId,
    state: "disconnected",
    connected: false,
    transport: "unknown",
    baudRate: null,
    path: null,
    address: null,
    port: null,
    protocol: null,
    lastError: null,
  };
}

function getDeviceConnectionRecord(deviceId) {
  return deviceConnections.get(deviceId) || null;
}

function getDeviceTerminalSession(deviceId) {
  return deviceTerminalSessions.get(deviceId) || null;
}

function clearDeviceTerminalInactivityTimer(session) {
  if (!session?.inactivityTimer) {
    return;
  }

  clearTimeout(session.inactivityTimer);
  session.inactivityTimer = null;
}

function refreshDeviceTerminalInactivityTimer(deviceId) {
  const session = getDeviceTerminalSession(deviceId);

  if (!session?.stream || session.transport !== "network") {
    return;
  }

  clearDeviceTerminalInactivityTimer(session);
  session.lastActivityAt = Date.now();
  session.inactivityTimer = setTimeout(() => {
    const activeSession = getDeviceTerminalSession(deviceId);

    if (!activeSession || activeSession !== session) {
      return;
    }

    broadcastDeviceTerminalData(
      deviceId,
      `\r\n[ssh] session closed after 5 minutes of inactivity\r\n`
    );

    closeDeviceTerminal(deviceId).catch(() => {});
  }, sshTerminalInactivityTimeoutMs);
}

function getDeviceConnectionSnapshot(deviceId) {
  const record = getDeviceConnectionRecord(deviceId);

  if (!record) {
    return getDefaultDeviceConnectionSnapshot(deviceId);
  }

  const serializedPort =
    typeof record.port === "number"
      ? record.port
      : null;

  return {
    deviceId,
    state: record.state,
    connected: record.state === "connected",
    transport: record.transport || "unknown",
    baudRate: record.baudRate ?? null,
    path: record.path ?? null,
    address: record.address ?? null,
    port: serializedPort,
    protocol: record.protocol ?? null,
    lastError: record.lastError ?? null,
  };
}

function broadcastDeviceConnectionStatus(deviceId) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("device:connection-status", getDeviceConnectionSnapshot(deviceId));
}

function broadcastDeviceConnectionLog(deviceId, message) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("device:connection-log", {
    deviceId,
    message,
    timestamp: new Date().toISOString(),
  });
}

function broadcastDeviceTerminalData(deviceId, data) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("device:terminal-data", {
    deviceId,
    data,
  });
}

function broadcastDeviceTerminalExit(deviceId, exitCode = 0, signal = null) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("device:terminal-exit", {
    deviceId,
    exitCode,
    signal,
  });
}

function appendDeviceConnectionLog(record, message) {
  record.logs.push({
    message,
    timestamp: new Date().toISOString(),
  });

  if (record.logs.length > serialConnectionLogLimit) {
    record.logs = record.logs.slice(-serialConnectionLogLimit);
  }

  broadcastDeviceConnectionLog(record.deviceId, message);
}

function setDeviceConnectionState(deviceId, nextState) {
  const currentRecord = deviceConnections.get(deviceId) || {
    deviceId,
    logs: [],
    state: "disconnected",
    lastError: null,
    baudRate: null,
    path: null,
    transport: "unknown",
    address: null,
    port: null,
    protocol: null,
    port: null,
    process: null,
  };

  const nextRecord = {
    ...currentRecord,
    ...nextState,
  };

  deviceConnections.set(deviceId, nextRecord);
  broadcastDeviceConnectionStatus(deviceId);

  return nextRecord;
}

function attachSerialConnectionListeners(record) {
  const { deviceId, port } = record;

  port.on("open", () => {
    setDeviceConnectionState(deviceId, {
      state: "connected",
      lastError: null,
    });
    appendDeviceConnectionLog(record, `Connected to ${record.path} at ${record.baudRate} baud`);
  });

  port.on("data", (chunk) => {
    const nextMessage = Buffer.from(chunk).toString("utf8");

    if (nextMessage) {
      broadcastDeviceTerminalData(deviceId, nextMessage);
      appendDeviceConnectionLog(record, nextMessage);
    }
  });

  port.on("error", (error) => {
    setDeviceConnectionState(deviceId, {
      state: "error",
      lastError: error.message,
    });
    appendDeviceConnectionLog(record, `Error: ${error.message}`);
  });

  port.on("close", () => {
    const currentRecord = getDeviceConnectionRecord(deviceId);
    const nextState = currentRecord?.state === "disconnecting" ? "disconnected" : "disconnected";

    setDeviceConnectionState(deviceId, {
      state: nextState,
      port: null,
    });
    appendDeviceConnectionLog(record, `Disconnected from ${record.path}`);
    broadcastDeviceTerminalExit(deviceId, 0, null);
  });
}

async function connectSerialDevice(payload) {
  const deviceId = payload?.id;
  const devicePath = payload?.path;
  const baudRate = Number(payload?.baudRate) || 115200;

  if (!deviceId || !devicePath) {
    throw new Error("Missing serial device configuration.");
  }

  const existingRecord = getDeviceConnectionRecord(deviceId);

  if (existingRecord?.state === "connected" || existingRecord?.state === "connecting") {
    return getDeviceConnectionSnapshot(deviceId);
  }

  const port = new SerialPort({
    path: devicePath,
    baudRate,
    autoOpen: false,
  });

  const record = setDeviceConnectionState(deviceId, {
    state: "connecting",
    port,
    baudRate,
    path: devicePath,
    transport: "serial",
    lastError: null,
    logs: existingRecord?.logs || [],
  });

  attachSerialConnectionListeners(record);

  await new Promise((resolve, reject) => {
    port.open((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  }).catch((error) => {
    setDeviceConnectionState(deviceId, {
      state: "error",
      port: null,
      lastError: error.message,
    });
    appendDeviceConnectionLog(record, `Error: ${error.message}`);
    throw error;
  });

  return getDeviceConnectionSnapshot(deviceId);
}

function buildSshSpawnCommand(payload) {
  const address = payload?.address;
  const port = Number(payload?.port) || 22;
  const sshUser = payload?.sshUser || process.env.SSH_USER || "arduino";
  const sshKeyPath = payload?.sshKeyPath || process.env.SSH_KEY_PATH;

  if (!address) {
    throw new Error("Missing network device address.");
  }

  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=5",
    "-p",
    String(port),
  ];

  if (sshKeyPath) {
    args.push("-i", sshKeyPath);
  }

  args.push(`${sshUser}@${address}`);

  return {
    command: "ssh",
    args,
    sshUser,
    sshKeyPath: sshKeyPath || null,
  };
}

async function connectNetworkSshDevice(payload) {
  const deviceId = payload?.id;
  const address = payload?.address;
  const port = Number(payload?.port) || 22;

  if (!deviceId || !address) {
    throw new Error("Missing SSH device configuration.");
  }

  const existingRecord = getDeviceConnectionRecord(deviceId);

  if (existingRecord?.state === "connected" || existingRecord?.state === "connecting") {
    return getDeviceConnectionSnapshot(deviceId);
  }

  const { command, args, sshUser, sshKeyPath } = buildSshSpawnCommand(payload);
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const record = setDeviceConnectionState(deviceId, {
    state: "connecting",
    process: child,
    address,
    port,
    protocol: "ssh",
    transport: "network",
    lastError: null,
    logs: existingRecord?.logs || [],
  });

  appendDeviceConnectionLog(
    record,
    `Opening SSH connection to ${sshUser}@${address}:${port}${sshKeyPath ? ` using key ${sshKeyPath}` : ""}`
  );

  child.once("spawn", () => {
    setDeviceConnectionState(deviceId, {
      state: "connected",
      lastError: null,
    });
    appendDeviceConnectionLog(record, `SSH connected to ${sshUser}@${address}:${port}`);
  });

  child.stdout?.on("data", (chunk) => {
    const nextMessage = Buffer.from(chunk).toString("utf8");

    if (nextMessage) {
      appendDeviceConnectionLog(record, nextMessage);
    }
  });

  child.stderr?.on("data", (chunk) => {
    const nextMessage = Buffer.from(chunk).toString("utf8");

    if (nextMessage) {
      appendDeviceConnectionLog(record, nextMessage);
    }
  });

  child.once("error", (error) => {
    setDeviceConnectionState(deviceId, {
      state: "error",
      process: null,
      lastError: error.message,
    });
    appendDeviceConnectionLog(record, `Error: ${error.message}`);
  });

  child.once("close", (code, signal) => {
    const currentRecord = getDeviceConnectionRecord(deviceId);
    const wasDisconnecting = currentRecord?.state === "disconnecting";
    const nextError = wasDisconnecting ? null : currentRecord?.lastError || (code && code !== 0 ? `SSH exited with code ${code}` : null);

    setDeviceConnectionState(deviceId, {
      state: wasDisconnecting ? "disconnected" : code && code !== 0 ? "error" : "disconnected",
      process: null,
      lastError: nextError,
    });
    appendDeviceConnectionLog(
      record,
      wasDisconnecting
        ? `SSH disconnected from ${address}:${port}`
        : `SSH process closed${code !== null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}`
    );
  });

  return getDeviceConnectionSnapshot(deviceId);
}

async function disconnectDevice(deviceId) {
  const record = getDeviceConnectionRecord(deviceId);

  if (!record?.port && !record?.process) {
    return getDeviceConnectionSnapshot(deviceId);
  }

  setDeviceConnectionState(deviceId, {
    state: "disconnecting",
  });

  if (record.process) {
    record.process.kill("SIGTERM");
    return getDeviceConnectionSnapshot(deviceId);
  }

  await new Promise((resolve, reject) => {
    record.port.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  }).catch((error) => {
    setDeviceConnectionState(deviceId, {
      state: "error",
      lastError: error.message,
    });
    appendDeviceConnectionLog(record, `Error: ${error.message}`);
    throw error;
  });

  return getDeviceConnectionSnapshot(deviceId);
}

async function closeDeviceTerminal(deviceId) {
  const session = getDeviceTerminalSession(deviceId);

  if (session) {
    clearDeviceTerminalInactivityTimer(session);
    session.stream?.end?.();
    session.client?.end?.();
    deviceTerminalSessions.delete(deviceId);
    return true;
  }

  const record = getDeviceConnectionRecord(deviceId);

  if (record?.port && record.transport === "serial") {
    await disconnectDevice(deviceId);
    return true;
  }

  return false;
}

function writeDeviceTerminal(deviceId, data) {
  const terminalSession = getDeviceTerminalSession(deviceId);

  if (terminalSession?.stream) {
    refreshDeviceTerminalInactivityTimer(deviceId);
    terminalSession.stream.write(String(data || ""));
    return true;
  }

  const record = getDeviceConnectionRecord(deviceId);

  if (record?.port && record.transport === "serial") {
    record.port.write(String(data || ""));
    return true;
  }

  return false;
}

function resizeDeviceTerminal(deviceId, cols, rows) {
  const session = getDeviceTerminalSession(deviceId);

  if (!session?.stream) {
    const record = getDeviceConnectionRecord(deviceId);
    return Boolean(record?.port && record.transport === "serial");
  }

  const nextCols = Math.max(20, Number(cols) || 80);
  const nextRows = Math.max(8, Number(rows) || 24);

  session.cols = nextCols;
  session.rows = nextRows;
  session.stream.setWindow(nextRows, nextCols, 0, 0);
  return true;
}

function getSshConnectionConfig(payload) {
  const sshKeyPath = payload?.sshKeyPath || process.env.SSH_KEY_PATH;
  const sshKey =
    sshKeyPath && fs.existsSync(sshKeyPath)
      ? fs.readFileSync(sshKeyPath, "utf8")
      : undefined;
  const host = payload.address;
  const port = Number(payload?.port) || 22;
  const knownHostKey = getKnownHostKey(host, port);

  return {
    host,
    port,
    username: payload?.sshUser || process.env.SSH_USER || "arduino",
    password: payload?.password || undefined,
    privateKey: sshKey,
    agent: process.env.SSH_AUTH_SOCK || undefined,
    tryKeyboard: true,
    readyTimeout: 8000,
    hostVerifier: (hostKey) => {
      const fingerprint = getSshHostFingerprint(hostKey);
      const knownHosts = loadKnownHosts();
      const existingEntry = knownHosts[knownHostKey];

      if (!existingEntry) {
        knownHosts[knownHostKey] = {
          fingerprint,
          addedAt: new Date().toISOString(),
        };
        saveKnownHosts(knownHosts);
        return true;
      }

      return existingEntry.fingerprint === fingerprint;
    },
  };
}

function connectSshClient(payload) {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;

    const finishReject = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      client.end();
      reject(error);
    };

    client.on("ready", () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(client);
    });

    client.on("error", (error) => {
      finishReject(error);
    });

    client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      const passwordPrompt = prompts?.find((prompt) =>
        String(prompt?.prompt || "")
          .toLowerCase()
          .includes("password")
      );

      if (payload?.password && passwordPrompt) {
        finish([payload.password]);
        return;
      }

      finish([]);
    });

    client.connect(getSshConnectionConfig(payload));
  });
}

function openSftpClient(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(sftp);
    });
  });
}

function sftpReadDir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, list) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(list || []);
    });
  });
}

function sftpStat(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stats);
    });
  });
}

function sftpMkdir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(true);
    });
  });
}

function writeRemoteFile(sftp, remotePath, buffer) {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, {
      flags: "w",
      encoding: null,
      mode: 0o644,
    });

    stream.on("error", reject);
    stream.on("close", resolve);
    stream.end(buffer);
  });
}

function getDefaultRemoteRoot(payload) {
  const sshUser = payload?.sshUser || process.env.SSH_USER || "arduino";
  return `/home/${sshUser}`;
}

function normalizeRemotePath(remotePath, payload) {
  const fallback = getDefaultRemoteRoot(payload);
  const nextPath = String(remotePath || fallback).trim() || fallback;
  const normalized = path.posix.normalize(nextPath);

  if (!normalized || normalized === ".") {
    return fallback;
  }

  return normalized.startsWith("/") ? normalized : path.posix.join(fallback, normalized);
}

async function ensureRemoteDirectoryExists(sftp, remotePath) {
  const normalizedPath = path.posix.normalize(remotePath);

  if (!normalizedPath || normalizedPath === "." || normalizedPath === "/") {
    return "/";
  }

  const parentPath = path.posix.dirname(normalizedPath);

  if (parentPath && parentPath !== normalizedPath) {
    await ensureRemoteDirectoryExists(sftp, parentPath);
  }

  try {
    const stats = await sftpStat(sftp, normalizedPath);

    if (!stats?.isDirectory?.()) {
      throw new Error(`${normalizedPath} exists but is not a directory.`);
    }
  } catch (error) {
    const message = String(error?.message || "");
    const code = error?.code;

    if (code !== 2 && !message.toLowerCase().includes("no such file")) {
      throw error;
    }

    await sftpMkdir(sftp, normalizedPath);
  }

  return normalizedPath;
}

async function withSftpSession(payload, callback) {
  const client = await connectSshClient(payload);

  try {
    const sftp = await openSftpClient(client);
    return await callback({ client, sftp });
  } finally {
    client.end();
  }
}

async function listMissionRemoteDirectories(payload) {
  const remotePath = normalizeRemotePath(payload?.remotePath, payload);

  return withSftpSession(payload, async ({ sftp }) => {
    const entries = await sftpReadDir(sftp, remotePath);
    const directories = entries
      .filter((entry) => entry?.attrs?.isDirectory?.())
      .map((entry) => ({
        name: entry.filename,
        path: path.posix.join(remotePath, entry.filename),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const files = entries
      .filter((entry) => !entry?.attrs?.isDirectory?.())
      .map((entry) => ({
        name: entry.filename,
        path: path.posix.join(remotePath, entry.filename),
      }))
      .filter((entry) => entry.name.toLowerCase().endsWith(".py"))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      remotePath,
      parentPath: remotePath === "/" ? null : path.posix.dirname(remotePath),
      directories,
      files,
    };
  });
}

async function createMissionRemoteDirectory(payload) {
  const parentPath = normalizeRemotePath(payload?.parentPath, payload);
  const directoryName = String(payload?.directoryName || "").trim();

  if (!directoryName) {
    throw new Error("Directory name is required.");
  }

  if (directoryName.includes("/") || directoryName.includes("\\")) {
    throw new Error("Directory name cannot contain path separators.");
  }

  const remotePath = path.posix.join(parentPath, directoryName);

  return withSftpSession(payload, async ({ sftp }) => {
    await ensureRemoteDirectoryExists(sftp, remotePath);

    return {
      created: true,
      remotePath,
    };
  });
}

async function uploadMissionFiles(payload) {
  const remotePath = normalizeRemotePath(payload?.remotePath, payload);
  const files = Array.isArray(payload?.files) ? payload.files : [];

  if (!files.length) {
    return {
      uploaded: [],
      remotePath,
    };
  }

  return withSftpSession(payload, async ({ sftp }) => {
    await ensureRemoteDirectoryExists(sftp, remotePath);

    const uploaded = [];

    for (const file of files) {
      const fileName = path.posix.basename(String(file?.name || "").trim());
      const dataBase64 = String(file?.dataBase64 || "");

      if (!fileName || !dataBase64) {
        continue;
      }

      const destinationPath = path.posix.join(remotePath, fileName);
      const buffer = Buffer.from(dataBase64, "base64");

      await writeRemoteFile(sftp, destinationPath, buffer);
      uploaded.push({
        name: fileName,
        path: destinationPath,
        size: buffer.byteLength,
      });
    }

    return {
      uploaded,
      remotePath,
    };
  });
}

function normalizeSshOpenError(error) {
  const message = String(error?.message || error || "");
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("connection lost before handshake") ||
    normalizedMessage.includes("econnreset") ||
    normalizedMessage.includes("socket hang up")
  ) {
    return {
      expected: true,
      message: "SSH connection is not available on this device right now.",
    };
  }

  if (
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("etimedout") ||
    normalizedMessage.includes("ehostunreach") ||
    normalizedMessage.includes("enotfound") ||
    normalizedMessage.includes("econnrefused")
  ) {
    return {
      expected: true,
      message: "Unable to reach the SSH service on this device.",
    };
  }

  if (normalizedMessage.includes("all configured authentication methods failed")) {
    return {
      expected: true,
      message: "SSH authentication failed.",
    };
  }

  return {
    expected: false,
    message,
  };
}

async function openSerialDeviceTerminal(payload) {
  const deviceId = payload?.id;
  const devicePath = payload?.path;
  const baudRate = Number(payload?.baudRate) || 115200;
  const existingRecord = getDeviceConnectionRecord(deviceId);

  if (!deviceId || !devicePath) {
    throw new Error("Missing serial device configuration.");
  }

  const reused = existingRecord?.state === "connected" && existingRecord?.path === devicePath;

  await connectSerialDevice({
    id: deviceId,
    path: devicePath,
    baudRate,
  });

  return {
    deviceId,
    path: devicePath,
    baudRate,
    transport: "serial",
    reused,
  };
}

async function openSshDeviceTerminal(payload) {
  const deviceId = payload?.id;
  const address = payload?.address;
  const port = Number(payload?.port) || 22;
  const sshUser = payload?.sshUser || process.env.SSH_USER || "arduino";
  const cols = Math.max(20, Number(payload?.cols) || 120);
  const rows = Math.max(8, Number(payload?.rows) || 24);

  if (!deviceId || !address) {
    throw new Error("Missing SSH device configuration.");
  }

  const existingSession = getDeviceTerminalSession(deviceId);

  if (existingSession?.stream) {
    resizeDeviceTerminal(deviceId, cols, rows);
    refreshDeviceTerminalInactivityTimer(deviceId);

    try {
      existingSession.stream.write("\n");
    } catch (error) {
      // Ignore prompt refresh failures on reused sessions.
    }

    return {
      deviceId,
      address,
      port,
      sshUser,
      reused: true,
    };
  }

  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      client.end();
      reject(error);
    };

    client.on("ready", () => {
      client.shell(
        {
          term: "xterm-256color",
          cols,
          rows,
        },
        (error, stream) => {
          if (error) {
            fail(error);
            return;
          }

          const sessionRecord = {
            deviceId,
            address,
            port,
            sshUser,
            transport: "network",
            client,
            stream,
            cols,
            rows,
            inactivityTimer: null,
            lastActivityAt: Date.now(),
          };

          deviceTerminalSessions.set(deviceId, sessionRecord);
          refreshDeviceTerminalInactivityTimer(deviceId);

          stream.on("data", (data) => {
            if (!mainWindow || mainWindow.isDestroyed()) {
              return;
            }

            refreshDeviceTerminalInactivityTimer(deviceId);
            broadcastDeviceTerminalData(deviceId, Buffer.from(data).toString("utf8"));
          });

          stream.on("close", () => {
            clearDeviceTerminalInactivityTimer(sessionRecord);
            deviceTerminalSessions.delete(deviceId);
            broadcastDeviceTerminalExit(deviceId, 0, null);
          });

          stream.stderr?.on?.("data", (data) => {
            if (!mainWindow || mainWindow.isDestroyed()) {
              return;
            }

            refreshDeviceTerminalInactivityTimer(deviceId);
            broadcastDeviceTerminalData(deviceId, Buffer.from(data).toString("utf8"));
          });

          client.on("close", () => {
            clearDeviceTerminalInactivityTimer(sessionRecord);
            deviceTerminalSessions.delete(deviceId);
          });

          settled = true;
          resolve({
            deviceId,
            address,
            port,
            sshUser,
            reused: false,
          });
        }
      );
    });

    client.on("error", (error) => {
      fail(error);
    });

    client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      const passwordPrompt = prompts?.find((prompt) =>
        String(prompt?.prompt || "")
          .toLowerCase()
          .includes("password")
      );

      if (payload?.password && passwordPrompt) {
        finish([payload.password]);
        return;
      }

      finish([]);
    });

    client.connect(getSshConnectionConfig(payload));
  });
}

function detectDeviceTransport(port) {
  const pathValue = String(port?.path || "").toLowerCase();
  const manufacturer = String(port?.manufacturer || "").toLowerCase();
  const pnpId = String(port?.pnpId || "").toLowerCase();

  const fullText = `${pathValue} ${manufacturer} ${pnpId}`;

  if (
    fullText.includes("bluetooth") ||
    fullText.includes("bth") ||
    fullText.includes("rfcomm")
  ) {
    return "bluetooth";
  }

  if (
    port?.vendorId ||
    port?.productId ||
    fullText.includes("usb") ||
    fullText.includes("cu.usb") ||
    fullText.includes("ttyusb") ||
    fullText.includes("ttyacm")
  ) {
    return "usb";
  }

  return "usb";
}

function normalizeDeviceName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extractBluetoothDeviceNames(payload, result = []) {
  if (!payload) {
    return result;
  }

  if (Array.isArray(payload)) {
    payload.forEach((item) => extractBluetoothDeviceNames(item, result));
    return result;
  }

  if (typeof payload !== "object") {
    return result;
  }

  for (const [key, value] of Object.entries(payload)) {
    const looksLikeBluetoothDevice =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).some((nestedKey) => nestedKey.startsWith("device_"));

    if (looksLikeBluetoothDevice) {
      result.push(key);
    }

    extractBluetoothDeviceNames(value, result);
  }

  return result;
}

async function listMacBluetoothDeviceNames() {
  if (process.platform !== "darwin") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("system_profiler", ["SPBluetoothDataType", "-json"], {
      maxBuffer: 5 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    const names = extractBluetoothDeviceNames(parsed);

    return [...new Set(names)];
  } catch (error) {
    console.error("Failed to list macOS Bluetooth devices:", error);
    return [];
  }
}

function isMacBluetoothSerialPort(port, bluetoothDeviceNames) {
  const pathValue = String(port?.path || "").toLowerCase();
  const baseName = pathValue.split("/").pop() || "";

  if (process.platform !== "darwin" || !baseName.startsWith("tty.") || port?.vendorId || port?.productId) {
    return false;
  }

  const normalizedSerialName = normalizeDeviceName(baseName.replace(/^tty\./, ""));

  if (!normalizedSerialName) {
    return false;
  }

  return bluetoothDeviceNames.some((deviceName) => {
    const normalizedBluetoothName = normalizeDeviceName(deviceName);

    if (!normalizedBluetoothName) {
      return false;
    }

    return (
      normalizedBluetoothName === normalizedSerialName ||
      normalizedBluetoothName.includes(normalizedSerialName) ||
      normalizedSerialName.includes(normalizedBluetoothName)
    );
  });
}

function detectDeviceTransportWithContext(port, options = {}) {
  const bluetoothDeviceNames = options.bluetoothDeviceNames || [];

  if (isMacBluetoothSerialPort(port, bluetoothDeviceNames)) {
    return "bluetooth";
  }

  return detectDeviceTransport(port);
}

function isIgnoredSerialPort(port) {
  const pathValue = String(port?.path || "").toLowerCase();

  if (!pathValue) {
    return true;
  }

  return [
    "/dev/tty.bluetooth-incoming-port",
    "/dev/cu.bluetooth-incoming-port",
    "/dev/tty.debug-console",
    "/dev/cu.debug-console",
  ].includes(pathValue);
}

async function listSerialDevices() {
  try {
    const [ports, bluetoothDeviceNames] = await Promise.all([
      SerialPort.list(),
      listMacBluetoothDeviceNames(),
    ]);

    return ports
      .filter((port) => !isIgnoredSerialPort(port))
      .map((port) => ({
        id: `serial:${port.path}`,
        name: port.friendlyName || port.manufacturer || port.path,
        path: port.path,
        manufacturer: port.manufacturer || null,
        serialNumber: port.serialNumber || null,
        vendorId: port.vendorId || null,
        productId: port.productId || null,
        pnpId: port.pnpId || null,
        transport: detectDeviceTransportWithContext(port, { bluetoothDeviceNames }),
        type: "serial",
        source: "local",
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    console.error("Failed to list serial devices:", error);
    return [];
  }
}

function ipv4ToInt(address) {
  return address.split(".").reduce((value, octet) => ((value << 8) + Number(octet)) >>> 0, 0);
}

function intToIpv4(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function getActiveIpv4Candidates() {
  const interfaces = os.networkInterfaces();

  return Object.values(interfaces)
    .flatMap((entries) => entries || [])
    .filter((entry) => {
      if (!entry || entry.internal || entry.family !== "IPv4" || !entry.address) {
        return false;
      }

      return (
        entry.address.startsWith("10.") ||
        entry.address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(entry.address)
      );
    });
}

function getSubnetScanTargets() {
  const seen = new Set();
  const targets = [];

  for (const entry of getActiveIpv4Candidates()) {
    const base = ipv4ToInt(entry.address) & ipv4ToInt("255.255.255.0");

    for (let host = 1; host <= 254; host += 1) {
      const candidate = intToIpv4(base + host);

      if (candidate === entry.address || seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      targets.push(candidate);
    }
  }

  return targets;
}

function probeTcpPort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (isOpen) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(isOpen);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    socket.connect(port, host);
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = [];
  let currentIndex = 0;

  async function runNext() {
    if (currentIndex >= items.length) {
      return;
    }

    const itemIndex = currentIndex;
    currentIndex += 1;

    const result = await worker(items[itemIndex], itemIndex);

    if (result) {
      results.push(result);
    }

    await runNext();
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runNext())
  );

  return results;
}

async function discoverSshDevices() {
  const targets = getSubnetScanTargets();

  if (!targets.length) {
    return [];
  }

  try {
    const results = await mapWithConcurrency(targets, sshDiscoveryConcurrency, async (address) => {
      const isOpen = await probeTcpPort(address, sshDiscoveryPort, sshDiscoveryTimeoutMs);

      if (!isOpen) {
        return null;
      }

      return {
        id: `network-ssh:${address}`,
        name: address,
        address,
        port: sshDiscoveryPort,
        protocol: "ssh",
        transport: "network",
        type: "network",
        source: "network",
      };
    });

    return results.sort((left, right) => left.address.localeCompare(right.address));
  } catch (error) {
    console.error("Failed to discover SSH devices:", error);
    return [];
  }
}

function parseArpNeighbors(stdout) {
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (process.platform === "win32") {
    return lines
      .map((line) => {
        const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\w+)$/i);

        if (!match) {
          return null;
        }

        const [, address, mac, entryType] = match;

        return {
          id: `network:${address}`,
          name: address,
          address,
          mac,
          entryType,
          transport: "network",
          type: "network",
          source: "network",
        };
      })
      .filter(Boolean);
  }

  return lines
    .map((line) => {
      const match = line.match(/^(.+?) \(([^)]+)\) at ([^ ]+) on ([^ ]+)(?:\s+\[.*\])?$/i);

      if (!match) {
        return null;
      }

      const [, rawName, address, mac, interfaceName] = match;
      const name = rawName === "?" ? address : rawName;

      return {
        id: `network:${address}`,
        name,
        address,
        mac,
        interface: interfaceName,
        transport: "network",
        type: "network",
        source: "network",
      };
    })
    .filter(Boolean);
}

async function listNetworkDevices() {
  try {
    const { stdout } = await execFileAsync("arp", ["-a"], {
      maxBuffer: 5 * 1024 * 1024,
    });

    return parseArpNeighbors(stdout)
      .filter((device, index, devices) => devices.findIndex((item) => item.address === device.address) === index)
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    console.error("Failed to list network devices:", error);
    return [];
  }
}

async function listAvailableDevices() {
  const [serialDevices, arpDevices, sshDevices] = await Promise.all([
    listSerialDevices(),
    listNetworkDevices(),
    discoverSshDevices(),
  ]);
  const mergedNetworkDevices = [...arpDevices, ...sshDevices]
    .filter((device, index, devices) => devices.findIndex((item) => item.address === device.address) === index)
    .sort((left, right) => left.name.localeCompare(right.name));
  const groups = {
    usb: serialDevices.filter((device) => device.transport === "usb"),
    bluetooth: serialDevices.filter((device) => device.transport === "bluetooth"),
    network: mergedNetworkDevices,
  };

  return {
    connected: serialDevices,
    groups,
    network: {
      neighbors: mergedNetworkDevices,
    },
  };
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    broadcastUpdateStatus({
      state: "checking",
      label: "Checking...",
      progress: null,
    });
  });

  autoUpdater.on("update-available", () => {
    broadcastUpdateStatus({
      state: "available",
      label: "New version available",
      progress: null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    broadcastUpdateStatus({
      state: "up-to-date",
      label: "Up to date",
      progress: null,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));

    broadcastUpdateStatus({
      state: "downloading",
      label: `Downloading ${percent}%`,
      progress: percent,
    });
  });

  autoUpdater.on("update-downloaded", () => {
    broadcastUpdateStatus({
      state: "downloaded",
      label: "Restart to update",
      progress: 100,
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

async function runUpdateCheck({ manual = false } = {}) {
  if (!app.isPackaged) {
    broadcastUpdateStatus({
      state: "idle",
      label: "Updates disabled in dev",
      progress: null,
    });

    return updateStatus;
  }

  if (updateStatus.state === "downloaded" && manual) {
    setImmediate(() => {
      autoUpdater.quitAndInstall();
    });

    return updateStatus;
  }

  if (updateStatus.state === "available" && manual) {
    broadcastUpdateStatus({
      state: "downloading",
      label: "Downloading...",
      progress: 0,
    });

    try {
      await autoUpdater.downloadUpdate();
      return updateStatus;
    } catch (error) {
      console.error("Electron downloadUpdate failed:", {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        statusCode: error?.statusCode,
        name: error?.name,
      });

      broadcastUpdateStatus(getUpdateErrorStatus(error));
      return updateStatus;
    }
  }

  if (isUpdateCheckInProgress || ["checking", "downloading"].includes(updateStatus.state)) {
    return updateStatus;
  }

  isUpdateCheckInProgress = true;

  try {
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
  } finally {
    isUpdateCheckInProgress = false;
  }
}

function scheduleAutoUpdateChecks() {
  if (!app.isPackaged) {
    return;
  }

  runUpdateCheck().catch(() => {});

  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }

  updateCheckInterval = setInterval(() => {
    if (!isQuitting) {
      runUpdateCheck().catch(() => {});
    }
  }, updateCheckIntervalMs);
}

async function navigateToAppPath(pathname) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const currentUrl = mainWindow.webContents.getURL();
  const fallbackBaseUrl = isDev ? appEntryUrl : "http://127.0.0.1:3000/app/dashboard";
  const targetUrl = new URL(currentUrl || fallbackBaseUrl);

  targetUrl.pathname = pathname;
  targetUrl.search = "";
  targetUrl.hash = "";

  await mainWindow.loadURL(targetUrl.toString());
}

function buildAppMenu() {
  if (process.platform !== "darwin") {
    return;
  }

  const template = [
    {
      label: desktopAppName,
      submenu: [
        { role: "about", label: `About ${desktopAppName}` },
        {
          label: "Check for updates...",
          click: () => {
            runUpdateCheck({ manual: true }).catch((error) => {
              console.error("Menu checkForUpdates failed:", error);
            });
          },
        },
        {
          label: "Settings",
          click: () => {
            navigateToAppPath("/app/settings/general").catch((error) => {
              console.error("Menu openSettings failed:", error);
            });
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    { role: "help" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
      const normalizedKey = String(input.key || "").toLowerCase();
      const isDevToolsShortcut =
        input.key === "F12" ||
        ((input.meta || input.control) && input.alt && normalizedKey === "i") ||
        ((input.meta || input.control) && input.shift && normalizedKey === "i") ||
        ((input.meta || input.control) && input.alt && normalizedKey === "j") ||
        ((input.meta || input.control) && input.shift && normalizedKey === "j");

      if (isZoomShortcut) {
        event.preventDefault();
      }

      if (!isDev && isDevToolsShortcut) {
        event.preventDefault();
      }
    });

    if (!isDev) {
      mainWindow.webContents.on("devtools-opened", () => {
        mainWindow.webContents.closeDevTools();
      });
    }

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
  process.env.HOSTNAME = localAppHost;
  process.env.NEXTAUTH_URL = `http://${localAppHost}:${serverPort}`;
  process.env.NEXTAUTH_URL_INTERNAL = `http://${localAppHost}:${serverPort}`;
  applyRuntimeConfigEnv();
  await ensureLocalDatabaseSchema();
  process.chdir(standaloneDir);

  require(serverEntry);
  app.setName(desktopAppName);
  process.title = desktopAppName;
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
  return runUpdateCheck({ manual: true });
});

ipcMain.handle("devices:list", async () => {
  return listAvailableDevices();
});

ipcMain.handle("device:get-connection-state", async (_event, deviceId) => {
  return getDeviceConnectionSnapshot(deviceId);
});

ipcMain.handle("device:connect", async (_event, payload) => {
  if (!payload || !payload.id) {
    throw new Error("Invalid device payload.");
  }

  const transport = payload.transport;
  const type = payload.type;

  if (type === "network" || transport === "network" || payload.protocol === "ssh") {
    return connectNetworkSshDevice(payload);
  }

  if (type !== "serial" && transport !== "usb" && transport !== "bluetooth") {
    throw new Error("Unsupported device transport.");
  }

  return connectSerialDevice(payload);
});

ipcMain.handle("device:terminal-open", async (_event, payload) => {
  if (!payload || !payload.id) {
    throw new Error("Invalid device payload.");
  }

  if (payload.address) {
    try {
      return await openSshDeviceTerminal(payload);
    } catch (error) {
      if (
        error?.level === "client-authentication" &&
        !payload?.password
      ) {
        return {
          authRequired: true,
          transport: "network",
        };
      }

      const normalizedError = normalizeSshOpenError(error);

      if (normalizedError.expected) {
        return {
          error: true,
          expected: true,
          transport: "network",
          message: normalizedError.message,
        };
      }

      throw error;
    }
  }

  if (payload.path) {
    return openSerialDeviceTerminal(payload);
  }

  throw new Error("This device does not expose a supported terminal transport.");
});

ipcMain.handle("device:terminal-write", async (_event, payload) => {
  if (!payload?.deviceId) {
    throw new Error("Invalid device id.");
  }

  return writeDeviceTerminal(payload.deviceId, payload.data);
});

ipcMain.handle("device:terminal-resize", async (_event, payload) => {
  if (!payload?.deviceId) {
    throw new Error("Invalid device id.");
  }

  return resizeDeviceTerminal(payload.deviceId, payload.cols, payload.rows);
});

ipcMain.handle("device:terminal-close", async (_event, deviceId) => {
  if (!deviceId) {
    throw new Error("Invalid device id.");
  }

  return closeDeviceTerminal(deviceId);
});

ipcMain.handle("device:disconnect", async (_event, deviceId) => {
  if (!deviceId) {
    throw new Error("Invalid device id.");
  }

  return disconnectDevice(deviceId);
});

ipcMain.handle("mission:list-remote-directories", async (_event, payload) => {
  if (!payload?.address) {
    throw new Error("This device does not expose an SSH address.");
  }

  try {
    return await listMissionRemoteDirectories(payload);
  } catch (error) {
    if (error?.level === "client-authentication" && !payload?.password) {
      return {
        authRequired: true,
      };
    }

    throw error;
  }
});

ipcMain.handle("mission:create-remote-directory", async (_event, payload) => {
  if (!payload?.address) {
    throw new Error("This device does not expose an SSH address.");
  }

  try {
    return await createMissionRemoteDirectory(payload);
  } catch (error) {
    if (error?.level === "client-authentication" && !payload?.password) {
      return {
        authRequired: true,
      };
    }

    throw error;
  }
});

ipcMain.handle("mission:upload-files", async (_event, payload) => {
  if (!payload?.address) {
    throw new Error("This device does not expose an SSH address.");
  }

  try {
    return await uploadMissionFiles(payload);
  } catch (error) {
    if (error?.level === "client-authentication" && !payload?.password) {
      return {
        authRequired: true,
      };
    }

    throw error;
  }
});

async function loadApp() {
  configureAutoUpdater();
  buildAppMenu();
  createWindow();

  if (isDev) {
    await mainWindow.loadURL(appEntryUrl);
    return;
  }

  const { standaloneDir, serverEntry } = getProductionServerPaths();
  const serverPort = defaultPort;

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
  await mainWindow.loadURL(`http://${localAppHost}:${serverPort}/app/dashboard`);
  scheduleAutoUpdateChecks();
}

async function showStartupError(error) {
  if (app.isPackaged && error?.code === "RUNTIME_CONFIG_MISSING") {
    const actionIndex = await dialog.showMessageBox({
      type: "error",
      buttons: ["Open config folder", "OK"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "Electron startup failed",
      message: "Missing production runtime configuration.",
      detail: [
        `The packaged app needs ${runtimeConfigFilename} inside the userData folder.`,
        `Folder: ${error.runtimeConfigDir}`,
        error.missingKeys?.length ? `Missing keys: ${error.missingKeys.join(", ")}` : null,
        ...(error.incompleteProviders || []).map((provider) => `${provider.name}: missing ${provider.missingKeys.join(", ")}`),
        error.enabledProviders?.length ? `Enabled providers: ${error.enabledProviders.join(", ")}` : "Enabled providers: none",
      ].filter(Boolean).join("\n\n"),
    });

    if (actionIndex.response === 0) {
      await shell.openPath(error.runtimeConfigDir);
    }

    return;
  }

  dialog.showErrorBox("Avvio Electron fallito", error.message);
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

app.whenReady().then(loadApp).catch(async (error) => {
  await showStartupError(error);
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
