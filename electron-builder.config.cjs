const fs = require("fs");
const path = require("path");

module.exports = {
  appId: "com.placedv.labs",
  productName: "Placedv Labs",
  artifactName: "Placedv-Labs-${version}-${arch}.${ext}",
  icon: "build/icon.icns",
  files: [
    "electron/**/*",
    "package.json",
    "prisma/schema.prisma",
    "prisma/migrations/**/*",
  ],
  asarUnpack: [
    "**/*.node",
    "**/.prisma/**/*",
    "**/@prisma/**/*",
    "**/prisma/**/*",
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
      context.packager?.appInfo?.productFilename || context.packager?.appInfo?.productName || "Placedv Labs";

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
    const prismaRuntimeTarget = path.join(appBundlePath, "prisma-runtime");
    const prismaSchemaSource = path.join(projectDir, "prisma", "schema.prisma");
    const prismaSchemaTarget = path.join(prismaRuntimeTarget, "schema.prisma");
    const prismaMigrationsSource = path.join(projectDir, "prisma", "migrations");
    const prismaMigrationsTarget = path.join(prismaRuntimeTarget, "migrations");

    fs.rmSync(standaloneTarget, { recursive: true, force: true });
    fs.rmSync(prismaRuntimeTarget, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(staticTarget), { recursive: true });
    fs.cpSync(standaloneSource, standaloneTarget, { recursive: true });
    fs.cpSync(staticSource, staticTarget, { recursive: true });

    if (fs.existsSync(publicSource)) {
      fs.cpSync(publicSource, publicTarget, { recursive: true });
    }

    fs.mkdirSync(prismaRuntimeTarget, { recursive: true });

    if (fs.existsSync(prismaSchemaSource)) {
      fs.cpSync(prismaSchemaSource, prismaSchemaTarget);
    }

    if (fs.existsSync(prismaMigrationsSource)) {
      fs.cpSync(prismaMigrationsSource, prismaMigrationsTarget, { recursive: true });
    }
  },
};
