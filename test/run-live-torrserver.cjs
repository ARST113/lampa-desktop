// Windows Electron is a GUI process. Invoke synchronously from Node instead
// of PowerShell, which may return before the Electron app finishes.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electron = path.join(root, ".cache", "electron-ac3-eac3", "electron.exe");
const testcase = path.join(__dirname, "live-torrserver-electron.cjs");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, [testcase], {
  cwd: root,
  env,
  timeout: 240000,
  encoding: "utf8",
  windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error);
console.log("Electron test exit:", result.status, "signal:", result.signal);
if (result.status !== 0 || result.error) process.exitCode = 1;
