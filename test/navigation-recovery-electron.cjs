const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const profile = path.join(root, ".cache", "navigation-recovery-test");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
const watchdog = setTimeout(() => app.exit(2), 30000);
let server;
let window;

async function until(fn, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  throw new Error(message);
}

async function screenIsRecovery() {
  try {
    return (
      window.webContents.getURL().startsWith("file:") &&
      (await window.webContents.executeJavaScript(
        'Boolean(document.querySelector("#recovery-form"))',
      ))
    );
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  const { createNavigationFallback } = require("../src/modules/navigationFallback");
  const registerStoreHandlers = require("../src/modules/ipcHandlers/storeHandlers");
  const store = require("../src/modules/storeManager");

  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (req.url === "/blank" || req.url === "/unready") {
      res.end("<!doctype html><title>Empty</title><script>window.Lampa={}</script>");
      return;
    }
    if (req.url === "/language") {
      res.end('<!doctype html><title>Lampa first run</title><div class="lang">' +
        '<div class="lang__selector-item" data-code="ru">Русский</div></div>' +
        '<script>window.Lampa={};</script>');
      return;
    }
    res.end(`<!doctype html><title>Local Lampa</title><div id="app">
      <div class="head"></div><div class="wrap">
        <div class="wrap__content">Работает</div></div></div>
      <script>window.Lampa={};window.appready=true</script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  store.set("lampaUrl", base);

  window = new BrowserWindow({
    show: true,
    backgroundColor: "#14161b",
    webPreferences: {
      preload: path.join(root, "src/preload.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  const originalLoadURL = window.loadURL.bind(window);
  let requests = [];
  window.loadURL = (url) => {
    requests.push(url);
    return originalLoadURL(url);
  };

  let ready = 0;
  let failed = 0;
  let lastError;
  const navigation = createNavigationFallback(window, store, {
    timeoutMs: 600,
    pollMs: 30,
    onReady: () => { ready += 1; },
    onUnavailable: (error, url) => {
      failed += 1;
      lastError = { error: String(error.message || error), url };
      void window.loadFile(path.join(root, "src", "recovery.html"), {
        query: { url, reason: lastError.error },
      });
    },
  });
  registerStoreHandlers(store, {
    getMainWindow: () => window,
    openLampaUrl: (_window, url) => navigation.open(url),
  });

  // A valid address loads immediately.
  navigation.open(base);
  await until(() => ready === 1, "Initial Lampa failed");
  assert.equal(window.webContents.getURL(), base);
  console.log("PASS: valid address opens once");

  // A connection refusal must show the editable URL panel directly.
  const bad = "http://127.0.0.1:65534/typo";
  const baseline = requests.length;
  navigation.open(bad);
  await until(screenIsRecovery, "First failed request did not open URL editor");
  assert.equal(requests.length, baseline + 1);
  assert.equal(requests.at(-1), bad);
  assert.equal(lastError.url, bad);
  assert.equal(failed, 1);
  assert.equal(store.get("lampaUrl"), base);
  const shownUrl = await window.webContents.executeJavaScript(
    'document.querySelector("#url").value',
  );
  assert.equal(shownUrl, bad);
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(requests.length, baseline + 1);
  console.log("PASS: first failure opens correction panel without any automatic retries");

  // The user can enter a good URL into the form without restarting.
  await window.webContents.executeJavaScript(`
    document.querySelector("#url").value = ${JSON.stringify(base + "?correct=1")};
    document.querySelector("#recovery-form").requestSubmit();
  `);
  await until(() => ready === 2, "Correct address did not load after failure");
  assert.equal(window.webContents.getURL(), base + "?correct=1");
  assert.equal(store.get("lampaUrl"), base + "?correct=1");
  console.log("PASS: editable recovery form opens corrected URL in same Electron process");

  // An HTTP 200 empty page is not success.
  const previouslyFailed = failed;
  const beforeBlank = requests.length;
  navigation.open(base + "blank");
  await until(screenIsRecovery, "Empty page was not rejected");
  assert.equal(failed, previouslyFailed + 1);
  assert.equal(requests.length, beforeBlank + 1);
  console.log("PASS: HTTP 200 without real Lampa interface opens correction panel once");

  // Repeated attempts are exclusively user initiated.
  const beforeRetry = requests.length;
  await window.webContents.executeJavaScript('document.querySelector("#retry").click()');
  await until(() => failed === previouslyFailed + 2 && screenIsRecovery(),
    "Manual retry did not return to recovery panel");
  assert.equal(requests.length, beforeRetry + 1);
  console.log("PASS: Retry makes exactly one new request and returns to the panel");

  // Syntactically invalid values do not initiate any network call.
  const beforeInvalid = requests.length;
  navigation.open("notaurl");
  await until(async () =>
    (await screenIsRecovery()) &&
    (await window.webContents.executeJavaScript('document.querySelector("#url").value')) === "notaurl",
    "Malformed URL did not show editor",
  );
  assert.equal(requests.length, beforeInvalid);
  console.log("PASS: malformed address opens editor without a network request");

  // The language chooser counts as a functioning Lampa screen.
  navigation.open(base + "language");
  await until(() => ready === 3, "First-run language screen was rejected");
  assert.equal(window.webContents.getURL(), base + "language");
  console.log("PASS: initial language selection is accepted");

  // Disallow non-http/https values from privileged renderer API.
  await assert.rejects(
    window.webContents.executeJavaScript(
      "window.electronAPI.store.set('lampaUrl','javascript:alert(1)')",
    ),
  );
  console.log("PASS: renderer IPC validates URLs");

  clearTimeout(watchdog);
  window.destroy();
  server.close();
  app.exit(0);
}).catch((error) => {
  console.error(error);
  clearTimeout(watchdog);
  if (window && !window.isDestroyed()) window.destroy();
  if (server) server.close();
  app.exit(1);
});
