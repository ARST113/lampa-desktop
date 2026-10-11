// End-to-end test of a real, clean portable launcher, not a pre-created
// LampaData/config.json fixture. Works for both NSIS EXE and unpacked ZIP.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

assert.equal(process.platform, "win32");
assert.equal(process.env.CI, "true", "This script is CI-only.");
const exe = path.resolve(process.argv[2] || "");
const root = path.resolve(process.argv[3] || "");
const kind = process.argv[4] || "portable";
assert.ok(fs.existsSync(exe), "Missing executable: " + exe);
assert.ok(root.startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep));
assert.equal(path.dirname(exe), root, "EXE and profile directory must match");
const userData = path.join(root, "LampaData");
const logPath = path.join(process.env.LOCALAPPDATA, "Lampa-NextGen", "diagnostics", "startup.log");
assert.equal(fs.existsSync(userData), false, "LampaData was already present: invalid fresh-profile test");
const priorInstalledConfig = path.join(process.env.APPDATA, "Lampa", "config.json");
const oldInstalled = fs.existsSync(priorInstalledConfig) ? fs.readFileSync(priorInstalledConfig) : null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function inspect(ws) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(ws);
    const timer = setTimeout(() => { socket.close(); reject(new Error("CDP query timeout")); }, 3500);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          returnByValue: true,
          expression: "(() => ({url: location.href, lampa: !!window.Lampa, shell: !!document.querySelector('#app .wrap__content'), lang: !!document.querySelector('body > .lang .lang__selector-item[data-code]'), visibility: document.visibilityState}))()",
        },
      }));
    });
    socket.addEventListener("message", (event) => {
      const result = JSON.parse(event.data);
      if (result.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (result.error || result.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(result)));
      } else {
        resolve(result.result?.result?.value);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP connection error"));
    });
  });
}

async function main() {
  let child;
  let stderr = "";
  let snapshot = null;
  const port = await reservePort();
  const env = { ...process.env };
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  const result = { kind, exe, root, started: false, profileCreated: false, visible: false };
  try {
    child = spawn(exe, ["--remote-debugging-port=" + port, "--remote-allow-origins=*"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    result.started = true;
    child.stdout.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-12000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-12000); });
    const until = Date.now() + 95000;
    while (Date.now() < until) {
      if (child.exitCode !== null) throw new Error("Launcher exited unexpectedly: " + child.exitCode);
      result.profileCreated = fs.existsSync(path.join(userData, "Session"));
      try {
        const res = await fetch("http://127.0.0.1:" + port + "/json/list", {
          signal: AbortSignal.timeout(900),
        });
        if (res.ok) {
          const targets = await res.json();
          const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
          if (page) {
            snapshot = await inspect(page.webSocketDebuggerUrl);
            if (snapshot?.lampa && (snapshot.shell || snapshot.lang) &&
                snapshot.visibility === "visible" && result.profileCreated) {
              const file = path.join(userData, "config.json");
              assert.ok(fs.existsSync(file), "Portable profile has no config.json");
              const config = JSON.parse(fs.readFileSync(file, "utf8"));
              assert.ok(config.lampaUrl || snapshot.url.includes("lampa.mx"));
              const nowInstalled = fs.existsSync(priorInstalledConfig) ?
                fs.readFileSync(priorInstalledConfig) : null;
              assert.deepEqual(nowInstalled, oldInstalled,
                "Portable modified the installed Lampa profile");
              result.visible = true;
              result.snapshot = snapshot;
              console.log("PASS: fresh " + kind +
                " created LampaData/Session/config.json and displayed a real Lampa page");
              return;
            }
          }
        }
      } catch (error) {
        if (error.message.includes("Portable modified")) throw error;
      }
      await delay(300);
    }
    throw new Error("No clean portable profile and interactive Lampa window within 95s");
  } catch (error) {
    result.error = error.message;
    result.lastSnapshot = snapshot;
    result.launcherOutput = stderr;
    result.startupLog = fs.existsSync(logPath) ?
      fs.readFileSync(logPath, "utf8").slice(-12000) : "(no main-process log)";
    console.error("FAIL: " + kind, JSON.stringify(result, null, 2));
    throw error;
  } finally {
    if (child?.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true, timeout: 12000,
      });
    }
    const out = path.join("dist", "lampa-fresh-" + kind + ".json");
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
  }
}
main().catch(() => { process.exitCode = 1; });
