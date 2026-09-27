const path = require("node:path");

function subtitleToolPath({
  platform,
  isPackaged,
  resourcesPath,
  appPath,
  probing,
}) {
  if (platform !== "win32") return probing ? "ffprobe" : "ffmpeg";
  const directory = isPackaged
    ? path.join(resourcesPath, "subtitle-tools")
    : path.join(appPath, ".cache", "subtitle-tools");
  return path.join(directory, probing ? "ffprobe.exe" : "ffmpeg.exe");
}

module.exports = { subtitleToolPath };
