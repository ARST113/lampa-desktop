const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const profile = path.join(root, ".cache", "navigation-recovery-test");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);

let window;
let server;
const watchdog = setTimeout(() => app.exit(2), 30000);

async function until(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

app
  .whenReady()
  .then(async () => {
    const navigation = require("../src/modules/windowManager");
    const store = require("../src/modules/storeManager");

    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/next" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Local Lampa test</title>
        <h1 id="page">${req.url}</h1>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(root, "src/preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });
    navigation.setupNavigationHandlers(window);
    navigation.setupErrorHandler(window);
    require("../src/modules/ipcHandlers/windowHandlers")(() => window);

    await window.loadURL(base + "/");
    window.webContents.executeJavaScript("location.assign('/next')");
    await until(
      async () =>
        (await window.webContents
          .executeJavaScript("document.querySelector('#page')?.textContent")
          .catch(() => "")) === "/next",
      "Same-site navigation was blocked.",
    );
    assert.equal(window.webContents.getURL(), base + "/next");
    await window.loadURL(base + "/redirect");
    assert.equal(window.webContents.getURL(), base + "/next");
    console.log("PASS: same-origin navigation and HTTP redirects work.");

    // A local refusal reliably produces a main-frame network error.
    await window.loadURL("http://127.0.0.1:1/failed").catch(() => {});
    await until(
      () => window.webContents.getURL().startsWith("data:text/html"),
      "The error recovery page was not opened.",
    );
    await until(
      async () =>
        (await window.webContents
          .executeJavaScript("Boolean(document.getElementById('retry'))")
          .catch(() => false)) === true,
      "The error recovery controls are not visible.",
    );
    const available = await window.webContents.executeJavaScript(
      "Boolean(window.electronAPI?.loadUrl)",
    );
    assert.equal(available, true, "Preload IPC is missing on the error page");
    console.log("PASS: a failed network load shows the recovery screen.");

    await window.webContents.executeJavaScript(`(() => {
      document.getElementById("url").value = ${JSON.stringify(base + "/recovered")};
      document.getElementById("retry").click();
    })()`);
    await until(
      () => window.webContents.getURL() === base + "/recovered",
      "The retry button did not navigate to the specified URL.",
    );
    await until(
      async () =>
        (await window.webContents
          .executeJavaScript("document.querySelector('#page')?.textContent")
          .catch(() => "")) === "/recovered",
      "The recovered site did not render.",
    );
    assert.equal(store.get("lampaUrl"), base + "/recovered");
    console.log("PASS: retry button restores a user-selected site via IPC.");

    clearTimeout(watchdog);
    server.close();
    window.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(watchdog);
    if (server) server.close();
    app.exit(1);
  });
