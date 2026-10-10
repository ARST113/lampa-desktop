const fs = require("node:fs");
const path = require("node:path");

const PORTABLE_MARKER = "portable.flag";

function resolvePortableRoot({
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  fileExists = fs.existsSync,
} = {}) {
  if (platform !== "win32") return null;

  const portableDir = env.PORTABLE_EXECUTABLE_DIR;
  if (typeof portableDir === "string" && portableDir.trim()) {
    return path.resolve(portableDir);
  }

  const exeDir = path.dirname(execPath);
  return fileExists(path.join(exeDir, PORTABLE_MARKER)) ? exeDir : null;
}

function configurePortableProfile(app, options) {
  const root = resolvePortableRoot(options);
  if (!root) return null;

  const userData = path.join(root, "LampaData");
  const sessionData = path.join(userData, "Session");
  fs.mkdirSync(sessionData, { recursive: true });
  app.setPath("userData", userData);
  app.setPath("sessionData", sessionData);
  return userData;
}

module.exports = { resolvePortableRoot, configurePortableProfile };
