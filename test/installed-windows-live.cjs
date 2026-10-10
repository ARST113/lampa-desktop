// Test the actual Windows release binary against live Lampa servers.
// Unlike the deterministic local fixture, this must pass before publishing.
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

if (process.platform !== "win32") {
  throw new Error("Live Lampa test is Windows-only.");
}
const executable = path.resolve(process.argv[2] || "");
const mode = process.argv[3];
assert.ok(fs.existsSync(executable), "Windows executable not found.");
assert.ok(["installed", "portable"].includes(mode), "Specify installed or portable.");
const dataDir = mode === "portable"
  ? path.join(path.dirname(executable), "LampaData")
  : path.join(process.env.APPDATA, "Lampa");
const configPath = path.join(dataDir, "config.json");
const existed = fs.existsSync(configPath);
const previous = existed ? fs.readFileSync(configPath) : null;
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync("dist", { recursive: true });
const report = [];
const DEFAULT_URL = "http://lampa.mx/";
const BACKUP_URL = "https://cf.lampa.mx/";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const value = listener.address().port;
      listener.close(() => resolve(value));
    });
  });
}
async function cdp(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const watchdog = setTimeout(() => {
      socket.close();
      reject(new Error("CDP timed out: " + method));
    }, 4000);
    function finish(error, value) {
      clearTimeout(watchdog);
      socket.close();
      if (error) reject(error);
      else resolve(value);
    }
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      let response;
      try {
        response = JSON.parse(event.data);
      } catch (error) {
        finish(error);
        return;
      }
      if (response.id !== 1) return;
      if (response.error) {
        finish(new Error(JSON.stringify(response.error)));
      } else {
        resolve(response.result);
        clearTimeout(watchdog);
        socket.close();
      }
    });
    socket.addEventListener("error", () => {
      finish(new Error("CDP connection error: " + method));
    });
  });
}
async function tabFor(port) {
  const response = await fetch("http://127.0.0.1:" + port + "/json/list", {
    signal: AbortSignal.timeout(1200),
  });
  if (!response.ok) throw new Error("CDP returned HTTP " + response.status);
  const pages = await response.json();
  return pages.find((page) => page.type === "page" && page.webSocketDebuggerUrl);
}
async function snapshot(tab) {
  const result = await cdp(tab.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression: String.raw`(() => ({
      url: location.href,
      ready: window.appready === true,
      hasLampa: Boolean(window.Lampa),
      head: Boolean(document.querySelector("#app .head")),
      wrap: Boolean(document.querySelector("#app .wrap")),
      content: Boolean(document.querySelector("#app .wrap__content")),
      languageChoice: Boolean(
        document.querySelector("body > .lang .lang__selector-item[data-code]")
      ),
      documentVisibility: document.visibilityState,
      documentStart: performance.timeOrigin,
      title: document.title,
      body: (document.body?.innerText || "").slice(0, 350)
    }))()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}
async function capture(tab, name) {
  try {
    const result = await cdp(tab.webSocketDebuggerUrl, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    if (result.data) {
      fs.writeFileSync(
        path.join("dist", "lampa-" + mode + "-" + name + ".png"),
        Buffer.from(result.data, "base64"),
      );
    }
  } catch (error) {
    console.warn("Screenshot unavailable:", error.message);
  }
}
async function stop(child) {
  if (!child || !child.pid) return;
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
    windowsHide: true,
    timeout: 12000,
  });
  await delay(500);
}

async function runScenario(name, configuredUrl, check) {
  const debugPort = await availablePort();
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      lampaUrl: configuredUrl,
      webSecurity: true,
      autoUpdate: false,
      tsAutoStart: false,
    }),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "installed") delete env.PORTABLE_EXECUTABLE_DIR;
  let child;
  let latest = null;
  let latestTab = null;
  let logs = "";
  try {
    child = spawn(
      executable,
      ["--remote-debugging-port=" + debugPort, "--remote-allow-origins=*"],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (data) => {
      logs = (logs + String(data)).slice(-6000);
    });
    child.stderr.on("data", (data) => {
      logs = (logs + String(data)).slice(-6000);
    });
    const timeoutMs = 85000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error("Process exited with code " + child.exitCode);
      }
      try {
        const tab = await tabFor(debugPort);
        if (tab) {
          latestTab = tab;
          latest = await snapshot(tab);
          if (latest && check(latest)) {
            const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
            console.log("PASS: " + mode + " " + name + " " + latest.url);
            report.push({ mode, name, status: "passed", state: latest, savedUrl: saved.lampaUrl });
            return;
          }
        }
      } catch {
        // The debugging endpoint and renderer may temporarily disappear
        // during Electron startup and HTTP navigation.
      }
      await delay(350);
    }
    throw new Error("Actual Lampa interface did not become visible in " + timeoutMs + "ms.");
  } catch (error) {
    if (latestTab) await capture(latestTab, name);
    report.push({ mode, name, status: "failed", error: error.message, lastState: latest, logs });
    console.error("FAIL: " + mode + " " + name + ": " + error.message);
    console.error("Last document:", JSON.stringify(latest));
    console.error("Application logs:", logs);
    throw error;
  } finally {
    await stop(child);
  }
}


async function runSequentialScenario() {
  const name = "same-process-failure-and-correction";
  const debugPort = await availablePort();
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      lampaUrl: DEFAULT_URL,
      webSecurity: true,
      autoUpdate: false,
      tsAutoStart: false,
    }),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "installed") delete env.PORTABLE_EXECUTABLE_DIR;
  let child;
  let latest = null;
  let lastTab = null;
  let stage = "startup";
  let logs = "";
  const ready = (page) =>
    page && page.hasLampa &&
    ((page.head && page.wrap && page.content) || page.languageChoice) &&
    page.documentVisibility === "visible";
  async function waitFor(url, afterStart = 0) {
    const deadline = Date.now() + 50000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("Process exited: " + child.exitCode);
      try {
        const tab = await tabFor(debugPort);
        if (tab) {
          lastTab = tab;
          latest = await snapshot(tab);
          const configured = JSON.parse(fs.readFileSync(configPath, "utf8")).lampaUrl;
          if (
            ready(latest) &&
            new URL(latest.url).hostname === new URL(url).hostname &&
            latest.documentStart !== afterStart &&
            new URL(configured).hostname === new URL(url).hostname
          ) {
            console.log("PASS: " + mode + " " + stage + " " + latest.url);
            report.push({ mode, name: stage, status: "passed", state: latest, configured });
            return latest.documentStart;
          }
        }
      } catch {
        // A failing page and a renderer replacement are expected mid-navigation.
      }
      await delay(200);
    }
    throw new Error("Failed to navigate after " + stage + "; state=" + JSON.stringify(latest));
  }
  async function setThroughSettings(url) {
    const tab = await tabFor(debugPort);
    const result = await cdp(tab.webSocketDebuggerUrl, "Runtime.evaluate", {
      expression: "window.electronAPI.store.set('lampaUrl'," + JSON.stringify(url) + ")",
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  }
  function editConfig(url) {
    const current = JSON.parse(fs.readFileSync(configPath, "utf8"));
    current.lampaUrl = url;
    fs.writeFileSync(configPath, JSON.stringify(current));
  }
  try {
    child = spawn(
      executable,
      ["--remote-debugging-port=" + debugPort, "--remote-allow-origins=*"],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (data) => { logs = (logs + String(data)).slice(-10000); });
    child.stderr.on("data", (data) => { logs = (logs + String(data)).slice(-10000); });

    stage = "initial-live";
    let start = await waitFor(DEFAULT_URL);
    stage = "first-invalid-settings";
    await setThroughSettings("http://127.0.0.1:1/broken-one");
    start = await waitFor(DEFAULT_URL, start);
    stage = "correct-settings-after-failure";
    await setThroughSettings(BACKUP_URL);
    start = await waitFor(BACKUP_URL, start);
    stage = "second-invalid-settings";
    await setThroughSettings("http://127.0.0.1:1/broken-two");
    start = await waitFor(DEFAULT_URL, start);
    stage = "manual-config-correction-while-running";
    editConfig(BACKUP_URL);
    start = await waitFor(BACKUP_URL, start);
    stage = "third-invalid-settings";
    await setThroughSettings("http://127.0.0.1:1/broken-three");
    start = await waitFor(DEFAULT_URL, start);
    stage = "correct-settings-after-three-failures";
    await setThroughSettings(BACKUP_URL);
    await waitFor(BACKUP_URL, start);
  } catch (error) {
    if (lastTab) await capture(lastTab, stage);
    console.error("FAIL: " + mode + " " + stage + " " + error.message + "\n" + logs);
    report.push({ mode, name: stage, status: "failed", error: error.message, state: latest, logs });
    throw error;
  } finally {
    await stop(child);
  }
}

async function main() {
  try {
    const loaded = (page) =>
      page.hasLampa &&
      ((page.head && page.wrap && page.content) || page.languageChoice) &&
      page.documentVisibility === "visible" &&
      [DEFAULT_URL, BACKUP_URL].some((url) => new URL(page.url).host === new URL(url).host);

    // A fresh profile legitimately shows a first-run language selection
    // before the main Lampa shell is created. Both states are interactive.
    // Mocked HTML cannot pass a live host + real DOM check.
    // Real default URL loaded from config.json.
    await runScenario("default", DEFAULT_URL, loaded);

    // A wrong saved URL must recover automatically on the same process.
    await runScenario("bad-url-recovery", "http://127.0.0.1:1/not-found", loaded);

    // Editing config.json to a valid HTTPS Lampa host must work too.
    await runScenario("manual-https-config", BACKUP_URL, (page) =>
      loaded(page) && new URL(page.url).host === new URL(BACKUP_URL).host
    );

    // Keep the actual executable alive while repeatedly switching from
    // failed to valid addresses, including an on-disk config edit.
    await runSequentialScenario();
  } finally {
    fs.writeFileSync(
      path.join("dist", "lampa-live-" + mode + ".json"),
      JSON.stringify(report, null, 2),
    );
    if (existed) fs.writeFileSync(configPath, previous);
    else fs.rmSync(configPath, { force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
