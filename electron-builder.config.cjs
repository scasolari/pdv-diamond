const fs = require("fs");
const path = require("path");

module.exports = {
  appId: "com.placedv.ai",
  productName: "Placedv AI",
  artifactName: "Placedv-AI-${version}-${arch}.${ext}",
  icon: "build/icon.icns",
  files: [
    "electron/**/*",
    "package.json",
  ],
  asarUnpack: [
    "**/*.node",
  ],
  mac: {
    target: [
      "dmg",
      "zip",
    ],
    icon: "build/icon.icns",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
  },
  win: {
    icon: "build/icon.ico",
  },
  afterPack: async (context) => {
    const projectDir = context.projectDir || context.packager?.projectDir;
    const appOutDir = context.appOutDir || context.outDir;
    const productFilename =
      context.packager?.appInfo?.productFilename || context.packager?.appInfo?.productName || "Placedv AI";

    const appBundlePath = path.join(
      appOutDir,
      `${productFilename}.app`,
      "Contents",
      "Resources",
    );
    const standaloneSource = path.join(projectDir, ".next", "standalone");
    const standaloneTarget = path.join(appBundlePath, "app-standalone");
    const staticSource = path.join(projectDir, ".next", "static");
    const staticTarget = path.join(standaloneTarget, ".next", "static");
    const publicSource = path.join(projectDir, "public");
    const publicTarget = path.join(standaloneTarget, "public");
    const envSource = path.join(projectDir, ".env");
    const envTarget = path.join(appBundlePath, ".env");

    fs.rmSync(standaloneTarget, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(staticTarget), { recursive: true });
    fs.cpSync(standaloneSource, standaloneTarget, { recursive: true });
    fs.cpSync(staticSource, staticTarget, { recursive: true });

    if (fs.existsSync(publicSource)) {
      fs.cpSync(publicSource, publicTarget, { recursive: true });
    }

    if (fs.existsSync(envSource)) {
      fs.cpSync(envSource, envTarget);
    }
  },
};
