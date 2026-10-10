const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolvePortableRoot,
  configurePortableProfile,
} = require("../src/modules/portablePaths");

test("portable EXE uses launcher directory instead of extracted runtime directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lampa-portable-exe-"));
  try {
    assert.equal(
      resolvePortableRoot({
        env: { PORTABLE_EXECUTABLE_DIR: root },
        execPath: path.join(os.tmpdir(), "extracted", "Lampa.exe"),
        platform: "win32",
      }),
      root,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unpacked ZIP recognizes marker and keeps userData next to Lampa.exe", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lampa-portable-zip-"));
  try {
    fs.writeFileSync(path.join(root, "portable.flag"), "portable\n");
    const calls = [];
    const app = { setPath: (name, dir) => calls.push([name, dir]) };
    const result = configurePortableProfile(app, {
      env: {},
      execPath: path.join(root, "Lampa.exe"),
      platform: "win32",
    });
    assert.equal(result, path.join(root, "LampaData"));
    assert.deepEqual(calls, [
      ["userData", path.join(root, "LampaData")],
      ["sessionData", path.join(root, "LampaData", "Session")],
    ]);
    assert.ok(
      fs.statSync(path.join(root, "LampaData", "Session")).isDirectory(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installed Windows and non-Windows builds retain normal profile locations", () => {
  const options = {
    env: {},
    execPath: path.join(os.tmpdir(), "regular", "Lampa.exe"),
    fileExists: () => false,
  };
  assert.equal(resolvePortableRoot({ ...options, platform: "win32" }), null);
  assert.equal(resolvePortableRoot({ ...options, platform: "linux" }), null);
  assert.equal(
    configurePortableProfile(
      { setPath: () => assert.fail() },
      { ...options, platform: "win32" },
    ),
    null,
  );
});
