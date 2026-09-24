const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const runtime = require("../build/electron-runtime.json");

const [executable, ffmpeg] = process.argv.slice(2);
assert(
  executable && ffmpeg,
  "Pass the Electron executable and ffmpeg.dll paths",
);
const hash = createHash("sha256").update(readFileSync(ffmpeg)).digest("hex");
assert.equal(hash, runtime.ffmpegSha256, "The custom ffmpeg.dll was replaced");

const probe = spawnSync(
  resolve(executable),
  ["-p", "JSON.stringify(process.versions)"],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  },
);
if (probe.error) throw probe.error;
assert.equal(probe.status, 0, probe.stderr || "Electron runtime probe failed");
const versions = JSON.parse(probe.stdout.trim());
assert.equal(versions.electron, runtime.version, "Unexpected Electron version");
console.log(
  JSON.stringify({ electron: versions.electron, ffmpegSha256: hash }),
);
