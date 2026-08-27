const fs = require("fs");
const os = require("os");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env");
const packageJsonPath = path.join(projectRoot, "package.json");

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

function getUserDataDir(appName) {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  }

  if (process.platform === "win32") {
    const appDataDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appDataDir, appName);
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, appName);
}

if (!fs.existsSync(envPath)) {
  throw new Error(`.env not found at ${envPath}`);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const appName = packageJson.productName || "Placedv Labs";
const runtimeConfigDir = getUserDataDir(appName);
const runtimeConfigPath = path.join(runtimeConfigDir, "runtime-config.json");
const parsedEnv = parseEnvFile(fs.readFileSync(envPath, "utf8"));

const runtimeConfig = {
  NEXTAUTH_SECRET: parsedEnv.NEXTAUTH_SECRET || "",
  GITHUB_CLIENT_ID: parsedEnv.GITHUB_CLIENT_ID || "",
  GITHUB_CLIENT_SECRET: parsedEnv.GITHUB_CLIENT_SECRET || "",
  FACEBOOK_CLIENT_ID: parsedEnv.FACEBOOK_CLIENT_ID || "",
  FACEBOOK_CLIENT_SECRET: parsedEnv.FACEBOOK_CLIENT_SECRET || "",
};

fs.mkdirSync(runtimeConfigDir, { recursive: true });
fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf8");

console.log(`runtime-config.json written to ${runtimeConfigPath}`);
