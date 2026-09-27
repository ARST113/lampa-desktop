const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { subtitleToolPath } = require("../src/modules/subtitleToolPath");

test("Linux uses native subtitle tools from PATH", () => {
  assert.equal(subtitleToolPath({ platform: "linux", probing: false }), "ffmpeg");
  assert.equal(subtitleToolPath({ platform: "linux", probing: true }), "ffprobe");
});

test("Windows keeps the bundled tools for installed and development builds", () => {
  assert.equal(
    subtitleToolPath({
      platform: "win32",
      isPackaged: true,
      resourcesPath: "/resources",
      probing: true,
    }),
    path.join("/resources", "subtitle-tools", "ffprobe.exe"),
  );
  assert.equal(
    subtitleToolPath({
      platform: "win32",
      isPackaged: false,
      appPath: "/app",
      probing: false,
    }),
    path.join("/app", ".cache", "subtitle-tools", "ffmpeg.exe"),
  );
});
