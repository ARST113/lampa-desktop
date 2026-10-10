const fs = require("node:fs");
const path = require("node:path");

function resolvePortableRoot({
  env = process.env,
  platform = process.platform,
} = {}) {
  if (platform !== "win32") return null;

  const portableDir = env.PORTABLE_EXECUTABLE_DIR;
  if (typeof portableDir === "string" && portableDir.trim()) {
    return path.resolve(portableDir);
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
