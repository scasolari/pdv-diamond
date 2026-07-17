const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const { SerialPort } = require("serialport");
const { execFile, spawn } = require("child_process");
const os = require("os");
const path = require("path");
const net = require("net");
const fs = require("fs");
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
const serialConnectionLogLimit = 200;

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
  const candidatePaths = [
    path.join(process.cwd(), ".env"),
    app?.isPackaged ? path.join(process.resourcesPath, ".env") : null,
    app?.isPackaged ? path.join(process.resourcesPath, "app-standalone", ".env") : null,
  ].filter(Boolean);

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

function getLocalDatabasePath() {
  return path.join(app.getPath("userData"), "placedv-local.db");
}

function getBundledDatabaseTemplatePath() {
  return path.join(process.resourcesPath, "placedv-local-template.db");
}

function copyBundledDatabaseTemplate(targetPath) {
  const templatePath = getBundledDatabaseTemplatePath();

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Bundled database template not found at ${templatePath}`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(templatePath, targetPath);
}

async function isDatabaseSchemaReady() {
  try {
    const { stdout } = await execFileAsync("sqlite3", [
      getLocalDatabasePath(),
      "SELECT name FROM sqlite_master WHERE type='table' AND name='AppSetting' LIMIT 1;",
    ]);

    return String(stdout || "").trim() === "AppSetting";
  } catch (error) {
    return false;
  }
}

async function ensureLocalDatabaseSchema() {
  const databasePath = getLocalDatabasePath();

  if (!fs.existsSync(databasePath)) {
    copyBundledDatabaseTemplate(databasePath);
  }

  const isReady = await isDatabaseSchemaReady();

  if (isReady) {
    return;
  }

  const backupPath = `${databasePath}.invalid-${Date.now()}.bak`;

  if (fs.existsSync(databasePath)) {
    fs.renameSync(databasePath, backupPath);
  }

  copyBundledDatabaseTemplate(databasePath);

  const isReadyAfterRestore = await isDatabaseSchemaReady();

  if (!isReadyAfterRestore) {
    throw new Error("Unable to initialize the local SQLite database.");
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

function getDeviceConnectionSnapshot(deviceId) {
  const record = getDeviceConnectionRecord(deviceId);

  if (!record) {
    return getDefaultDeviceConnectionSnapshot(deviceId);
  }

  return {
    deviceId,
    state: record.state,
    connected: record.state === "connected",
    transport: record.transport || "unknown",
    baudRate: record.baudRate ?? null,
    path: record.path ?? null,
    address: record.address ?? null,
    port: record.port ?? null,
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
  process.env.DATABASE_URL = toPrismaSqliteUrl(getLocalDatabasePath());
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

ipcMain.handle("device:disconnect", async (_event, deviceId) => {
  if (!deviceId) {
    throw new Error("Invalid device id.");
  }

  return disconnectDevice(deviceId);
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
