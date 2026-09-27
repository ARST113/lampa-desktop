const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
execFileSync(
  process.execPath,
  [path.join(__dirname, "make-subtitle-fixture.cjs")],
  { windowsHide: true, stdio: "inherit", timeout: 40000 },
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(
  path.join(root, ".cache/electron-ac3-eac3/electron.exe"),
  [path.join(__dirname, "subtitles-electron.cjs")],
  { env, windowsHide: true, encoding: "utf8", timeout: 70000 },
);
if (result.status !== 0) {
  console.error(result.error || result.stderr || result.stdout);
  process.exitCode = 1;
} else {
  console.log(
    result.stdout
      .split("\n")
      .filter((line) => line.includes("PASS:"))
      .join("\n"),
  );
}
