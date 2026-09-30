const fs = require("node:fs");
const path = require("node:path");

function subtitleToolPath({
  platform,
  isPackaged,
  resourcesPath,
  appPath,
  probing,
}) {
  const name = probing ? "ffprobe" : "ffmpeg";
  if (platform === "win32") {
    const directory = isPackaged
      ? path.join(resourcesPath, "subtitle-tools")
      : path.join(appPath, ".cache", "subtitle-tools");
    return path.join(directory, `${name}.exe`);
  }
  // macOS has no ffmpeg in PATH by default, so the dmg ships the static tools
  // next to the application and uses them when they are present. Development
  // runs and every other platform keep resolving the tools from PATH.
  if (platform === "darwin" && isPackaged && resourcesPath) {
    const bundled = path.join(resourcesPath, "subtitle-tools", name);
    if (fs.existsSync(bundled)) return bundled;
  }
  return name;
}

module.exports = { subtitleToolPath };
