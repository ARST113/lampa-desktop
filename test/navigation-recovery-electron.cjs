const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const profile = path.join(root, ".cache", "navigation-recovery-test");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);

let server;
const windows = [];
const watchdog = setTimeout(() => app.exit(2), 30000);

async function until(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(message);
}

function createTestWindow() {
  const window = new BrowserWindow({
    show: false,
    backgroundColor: "#14161b",
    webPreferences: {
      preload: path.join(root, "src/preload.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  windows.push(window);
  return window;
}

app
  .whenReady()
  .then(async () => {
    const {
      createNavigationFallback,
    } = require("../src/modules/navigationFallback");
    const store = require("../src/modules/storeManager");

    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (req.url === "/blank" || req.url === "/unready") {
        res.end(
          "<!doctype html><title>Not ready</title><body>" +
            "<script>window.Lampa = {};</script></body>",
        );
        return;
      }
      res.end(
        `<!doctype html><title>Lampa local test</title>
        <body><div id="app">
          <div class="head"></div>
          <div class="wrap" style="width:800px;height:600px">
            <div class="wrap__content"><div id="ready">Local Lampa loaded</div></div>
          </div>
        </div>
        <script>window.Lampa = {};window.appready = true;</script></body>`,
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;

    // Bad network address: automatically switch to the configured fallback.
    const window = createTestWindow();
    let readyCount = 0;
    let defaultFailures = 0;
    const registerStoreHandlers = require("../src/modules/ipcHandlers/storeHandlers");
    const navigation = createNavigationFallback(window, store, {
      defaultUrl: base,
      timeoutMs: 1100,
      pollMs: 25,
      onReady: () => {
        readyCount += 1;
        window.show();
      },
      onUnavailable: () => {
        defaultFailures += 1;
      },
    });
    registerStoreHandlers(store, {
      getMainWindow: () => window,
      openLampaUrl: (_mainWindow, url) => navigation.open(url),
    });

    navigation.open("http://127.0.0.1:65534/wrong");
    assert.equal(window.isVisible(), false);
    await until(() => readyCount === 1, "Failed URL did not fall back.");
    assert.equal(window.webContents.getURL(), base);
    assert.equal(store.get("lampaUrl"), base);
    assert.equal(defaultFailures, 0);
    const rendered = await window.webContents.executeJavaScript(
      "document.getElementById('ready')?.textContent",
    );
    assert.equal(rendered, "Local Lampa loaded");
    console.log(
      "PASS: invalid network address switches to Lampa without white screen.",
    );

    // Valid but empty HTML must also fall back instead of staying blank.
    window.hide();
    navigation.open(base + "blank");
    await until(() => readyCount === 2, "Blank HTTP page did not fall back.");
    assert.equal(window.webContents.getURL(), base);
    assert.equal(store.get("lampaUrl"), base);
    console.log("PASS: blank 200 OK document also falls back.");

    // Malformed input never navigates to a browser error page.
    window.hide();
    navigation.open("notaurl");
    await until(() => readyCount === 3, "Malformed URL did not open default.");
    assert.equal(window.webContents.getURL(), base);
    console.log("PASS: malformed URL opens the default directly.");

    // Regression: the settings UI writes via electronAPI.store.set, not
    // navigation.open. That IPC route previously called loadURL twice.
    await window.webContents.executeJavaScript(
      "window.electronAPI.store.set('lampaUrl', 'http://127.0.0.1:65534/typo')",
    );
    await until(
      () => readyCount === 4,
      "Settings store change did not fall back.",
    );
    assert.equal(window.webContents.getURL(), base);
    assert.equal(store.get("lampaUrl"), base);
    console.log(
      "PASS: settings IPC typo returns to default without competing navigation.",
    );

    // A subsequent correct URL must also load, preserving the new address.
    const correct = base + "?correct=1";
    await window.webContents.executeJavaScript(
      `window.electronAPI.store.set("lampaUrl", ${JSON.stringify(correct)})`,
    );
    await until(
      () => readyCount === 5,
      "A valid URL entered after a typo did not load.",
    );
    assert.equal(window.webContents.getURL(), correct);
    assert.equal(store.get("lampaUrl"), correct);
    console.log(
      "PASS: settings IPC accepts correct address after a failed one.",
    );

    // window.Lampa alone must not mark a non-rendered page as ready.
    navigation.open(base + "unready");
    await until(
      () => readyCount === 6,
      "Page with window.Lampa but without the interface was accepted.",
    );
    assert.equal(window.webContents.getURL(), base);
    console.log("PASS: global window.Lampa without rendered UI falls back.");

    // A malformed store request must be rejected before it is persisted.
    await assert.rejects(
      window.webContents.executeJavaScript(
        "window.electronAPI.store.set('lampaUrl', 'javascript:alert(1)')",
      ),
    );
    assert.equal(store.get("lampaUrl"), base);
    console.log("PASS: invalid setting is rejected without navigation.");

    // When even the default fails, notify once rather than looping forever.
    const second = createTestWindow();
    let unavailable = 0;
    const missingDefault = createNavigationFallback(second, store, {
      defaultUrl: "http://127.0.0.1:1/",
      timeoutMs: 500,
      pollMs: 25,
      onUnavailable: () => {
        unavailable += 1;
      },
    });
    missingDefault.open("definitely invalid");
    await until(
      () => unavailable === 1,
      "Unreachable default was not reported.",
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(unavailable, 1);
    assert.equal(second.isVisible(), false);
    console.log(
      "PASS: unreachable default stops retrying and never shows white.",
    );

    clearTimeout(watchdog);
    for (const item of windows) item.destroy();
    server.close();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(watchdog);
    for (const item of windows) {
      if (!item.isDestroyed()) item.destroy();
    }
    if (server) server.close();
    app.exit(1);
  });
