const fs = require("node:fs");
const path = require("node:path");

function resolvePortableRoot({
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
  fileExists = fs.existsSync,
} = {}) {
  if (platform !== "win32") return null;

  // electron-builder's NSIS portable wrapper launches Electron from a
  // temporary extraction directory and injects these environment variables.
  // The FILE fallback also covers wrappers that omit DIR.
  const portableDir = env.PORTABLE_EXECUTABLE_DIR;
  if (typeof portableDir === "string" && portableDir.trim()) {
    return path.resolve(portableDir);
  }
  const launcher = env.PORTABLE_EXECUTABLE_FILE;
  if (typeof launcher === "string" && launcher.trim()) {
    return path.dirname(path.resolve(launcher));
  }

  // An unpacked ZIP must not depend on NSIS extraction or environment
  // variables. Its marker is deliberately excluded from the installed EXE.
  if (typeof execPath === "string" && execPath.trim()) {
    const root = path.dirname(path.resolve(execPath));
    if (fileExists(path.join(root, "portable.flag"))) return root;
  }

  return null;
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
