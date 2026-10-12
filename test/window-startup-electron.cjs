// Regression: a valid saved server must open without flashing the URL editor.
// The editor appears only after a failed server and can recover without restart.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const profile = path.join(root, ".cache", "window-startup-test");
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);

const watchdog = setTimeout(() => app.exit(2), 40000);
let server;
let window;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeoutMs = 9000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(35);
  }
  throw new Error(message);
}

function editorFor(main) {
  return BrowserWindow.getAllWindows().find((item) => item !== main);
}

app.whenReady().then(async () => {
  const store = require("../src/modules/storeManager");
  const { createWindow, openLampaUrl } = require("../src/modules/windowManager");

  server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html><body>' +
      '<div id="app"><div class="head"></div><div class="wrap">' +
      '<div class="wrap__content">Lampa fixture</div></div></div>' +
      '<script>window.Lampa = {}</script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = `http://127.0.0.1:${server.address().port}/`;
  const other = saved + "another";
  const bad = "http://127.0.0.1:1/unavailable";

  store.set("lampaUrl", saved);
  store.set("autoUpdate", false);

  window = createWindow();
  assert.equal(BrowserWindow.getAllWindows().length, 1,
    "A normal launch must not create the recovery editor");

  await until(() => window.isVisible(), "Saved valid server did not display Lampa").catch(
    async (error) => {
      const renderer = await window.webContents.executeJavaScript(
        `(() => ({ url: location.href, hasLampa: Boolean(window.Lampa),
          head: Boolean(document.querySelector("#app .head")),
          wrap: Boolean(document.querySelector("#app .wrap")),
          content: Boolean(document.querySelector("#app .wrap__content")),
          html: document.documentElement?.outerHTML?.slice(0, 500) }))()`,
        true,
      ).catch((cause) => ({ error: String(cause) }));
      const windows = BrowserWindow.getAllWindows().map((item) => ({
        title: item.getTitle(), visible: item.isVisible(),
        url: item.webContents.getURL(),
      }));
      throw new Error(error.message + " " + JSON.stringify({ renderer, windows }));
    },
  );
  assert.equal(editorFor(window), undefined,
    "A valid saved server flashed the recovery editor");
  assert.equal(new URL(window.webContents.getURL()).host, new URL(saved).host);
  console.log("PASS: valid saved server starts directly without URL editor");

  store.set("lampaUrl", other);
  openLampaUrl(window, other);
  assert.equal(editorFor(window), undefined,
    "Switching to a valid server must not open the URL editor");
  await until(() => window.isVisible() && window.webContents.getURL() === other,
    "Valid server switch did not display");
  assert.equal(editorFor(window), undefined);
  console.log("PASS: changing a working server loads it directly");

  store.set("lampaUrl", bad);
  openLampaUrl(window, bad);
  await until(async () => {
    const panel = editorFor(window);
    if (!panel || !panel.isVisible() || window.isVisible()) return false;
    return panel.webContents.executeJavaScript(
      "document.querySelector('#message')?.classList.contains('error')", true,
    ).catch(() => false);
  }, "Bad server did not reveal a usable recovery panel", 12000);
  const panel = editorFor(window);
  assert.ok(panel && panel.isVisible());
  console.log("PASS: invalid server opens URL editor only after failure");

  await panel.webContents.executeJavaScript(
    `document.getElementById("url").value = ${JSON.stringify(saved)};
    document.getElementById("recovery-form").requestSubmit();`,
  );
  await until(() => window.isVisible() && !panel.isVisible() &&
    window.webContents.getURL() === saved, "Corrected server was not restored");
  assert.equal(store.get("lampaUrl"), saved);
  console.log("PASS: corrected server is saved and editor closes");

  window.close();
  await until(() => BrowserWindow.getAllWindows().length === 0,
    "Closing Lampa left the server editor running");
  assert.equal(store.get("lampaUrl"), saved);
  console.log("PASS: exit does not open or leave a server editor");

  window = createWindow();
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  await until(() => window.isVisible(), "Restart did not reopen the saved server");
  assert.equal(window.webContents.getURL(), saved);
  assert.equal(editorFor(window), undefined);
  console.log("PASS: restart reuses saved server without URL editor");

  window.close();
  clearTimeout(watchdog);
  server.close();
  app.quit();
}).catch((error) => {
  console.error(error);
  clearTimeout(watchdog);
  if (window && !window.isDestroyed()) window.destroy();
  if (server) server.close();
  app.exit(1);
});
