const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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

test("macOS prefers the tools bundled into the application", () => {
  let resources;
  try {
    resources = fs.mkdtempSync(path.join(os.tmpdir(), "lampa-subtitle-tools-"));
  } catch {
    resources = fs.mkdtempSync(path.join(__dirname, "lampa-subtitle-tools-"));
  }
  const directory = path.join(resources, "subtitle-tools");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "ffmpeg"), "");
  try {
    assert.equal(
      subtitleToolPath({ platform: "darwin", isPackaged: true, resourcesPath: resources, probing: false }),
      path.join(directory, "ffmpeg"),
    );
    // ffprobe is absent here, so macOS falls back to PATH.
    assert.equal(
      subtitleToolPath({ platform: "darwin", isPackaged: true, resourcesPath: resources, probing: true }),
      "ffprobe",
    );
    assert.equal(
      subtitleToolPath({ platform: "darwin", isPackaged: false, probing: false }),
      "ffmpeg",
    );
  } finally {
    fs.rmSync(resources, { recursive: true, force: true });
  }
});
