const fs = require("fs");
const os = require("os");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(projectRoot, "package.json");

function parseArgs(argv) {
  return argv.slice(2).reduce((result, arg, index, args) => {
    if (!arg.startsWith("--")) {
      return result;
    }

    const [rawKey, inlineValue] = arg.split("=", 2);
    const key = rawKey.slice(2);

    if (!key) {
      return result;
    }

    if (inlineValue !== undefined) {
      result[key] = inlineValue;
      return result;
    }

    const nextValue = args[index + 1];

    if (nextValue && !nextValue.startsWith("--")) {
      result[key] = nextValue;
    } else {
      result[key] = "true";
    }

    return result;
  }, {});
}

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

const args = parseArgs(process.argv);
const envPath = path.resolve(args.env || path.join(projectRoot, ".env"));
const runtimeConfigPathOverride = args.output ? path.resolve(args.output) : null;

if (!fs.existsSync(envPath)) {
  throw new Error(`.env not found at ${envPath}`);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const appName = packageJson.productName || "Placedv Labs";
const parsedEnv = parseEnvFile(fs.readFileSync(envPath, "utf8"));
const runtimeConfigDir = runtimeConfigPathOverride ? path.dirname(runtimeConfigPathOverride) : getUserDataDir(appName);
const runtimeConfigPath = runtimeConfigPathOverride || path.join(runtimeConfigDir, "runtime-config.json");

const runtimeConfig = Object.entries(parsedEnv).reduce((result, [key, value]) => {
  result[key] = value;
  return result;
}, {});

if (!runtimeConfig.NEXTAUTH_SECRET) {
  throw new Error(
    `NEXTAUTH_SECRET is missing in ${envPath}. Add it before generating runtime-config.json.`,
  );
}

fs.mkdirSync(runtimeConfigDir, { recursive: true });
fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf8");

console.log(`runtime-config.json written to ${runtimeConfigPath}`);
