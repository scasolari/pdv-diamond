const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distPath = path.join(projectRoot, "dist");

if (!fs.existsSync(distPath)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(distPath)) {
  fs.rmSync(path.join(distPath, entry), { recursive: true, force: true });
}
