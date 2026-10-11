const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const profile = path.join(root, ".cache", "navigation-recovery-test");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
let server;
let browser;
let panel;
const watchdog = setTimeout(() => app.exit(2), 40000);

async function until(fn, reason, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(reason);
}
async function content(win, expression) {
  return win.webContents.executeJavaScript(expression, true).catch(() => null);
}
async function panelState() {
  return content(panel, `(() => ({
    url: document.getElementById("url")?.value,
    message: document.getElementById("message-text")?.textContent,
    error: document.querySelector("#message")?.classList.contains("error"),
    heading: document.querySelector("h1")?.textContent
  }))()`);
}

app.whenReady().then(async () => {
  const { createNavigationFallback } = require("../src/modules/navigationFallback");
  const { normalizeHttpUrl } = require("../src/modules/pageNavigation");
  const store = require("../src/modules/storeManager");
  server = http.createServer((req, res) => {
    if (req.url === "/http-404" || req.url === "/http-503") {
      const status = req.url === "/http-404" ? 404 : 503;
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>Server unavailable</title><body>Not Lampa</body>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (req.url === "/unrelated-script") {
      res.end("<!doctype html><title>Unrelated website</title>" +
        "<body><h1>Other service</h1><script>document.body.dataset.ready='yes'</script></body>");
      return;
    }
    if (req.url === "/blank") {
      res.end("<!doctype html><title>Empty</title><body>Empty site</body>");
      return;
    }
    if (req.url === "/language") {
      res.end('<!doctype html><div class="lang"><div class="lang__selector-item" data-code="ru">Русский</div></div><script>window.Lampa={}</script>');
      return;
    }
    if (req.url === "/slow-script") {
      res.end(`<!doctype html><div id="app"><div class="wrap"><div class="wrap__content"></div></div><div class="head"></div></div>
        <script>setTimeout(() => { window.Lampa = {}; document.querySelector(".wrap__content").textContent = "Late Lampa ready"; }, 1100)</script>`);
      return;
    }
    res.end('<!doctype html><div id="app"><div class="wrap"><div class="wrap__content">Ready</div></div><div class="head"></div></div><script>window.Lampa={}</script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const bad = "http://127.0.0.1:65534/bad";
  store.set("lampaUrl", base);

  browser = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(root, "src/preload.js"),
      sandbox: false, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false },
  });
  panel = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(root, "src/recoveryPreload.js"),
      sandbox: false, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false },
  });
  const history = [];
  const originalLoad = browser.loadURL.bind(browser);
  browser.loadURL = (url) => {
    history.push(url);
    return originalLoad(url);
  };
  await panel.loadFile(path.join(root, "src/recovery.html"), { query: { url: base } });

  function setPanel(phase, url, error = "") {
    panel.webContents.send("lampa-recovery-state", { phase, url, error });
    panel.show();
    browser.hide();
  }
  let success = 0;
  let failure = 0;
  const navigation = createNavigationFallback(browser, store, {
    timeoutMs: 400,
    renderTimeoutMs: 1500,
    unrecognizedPageMs: 600,
    emptyDocumentMs: 300,
    pollMs: 30,
    onLoading: (url) => setPanel("loading", url),
    onDocumentLoaded: (url) => setPanel("rendering", url),
    onReady: () => {
      success += 1;
      browser.show();
      panel.hide();
    },
    onUnavailable: (error, url) => {
      failure += 1;
      setPanel("error", url, String(error.message || error));
    },
  });

  ipcMain.handle("lampa-recovery-try-url", (event, url) => {
    assert.equal(event.sender, panel.webContents);
    const valid = normalizeHttpUrl(url);
    store.set("lampaUrl", valid);
    navigation.open(valid);
  });

  navigation.open(bad);
  await until(async () => (await panelState())?.error === true, "Bad server did not show error");
  assert.equal(history.filter(x => x === bad).length, 1);
  assert.equal(failure, 1);
  const firstPanelId = panel.id;
  console.log("PASS: connection refused once; same local panel shows error");

  await content(panel, "document.getElementById('retry').click()");
  await until(() => failure === 2, "Retry did not finish");
  assert.equal(history.filter(x => x === bad).length, 2);
  assert.equal(panel.id, firstPanelId);
  console.log("PASS: Retry uses same panel and exactly one new network request");

  // HTTP status alone must be inspected. An error document must never be
  // described as Lampa, even though Chromium loaded its HTML successfully.
  for (const status of [404, 503]) {
    const previousFailure = failure;
    const started = Date.now();
    navigation.open(base + "http-" + status);
    await until(async () => failure > previousFailure && (await panelState())?.error,
      "HTTP " + status + " was incorrectly treated as a working Lampa page");
    assert.ok(Date.now() - started < 1700, "HTTP " + status + " was not rejected promptly");
    assert.match((await panelState()).message, new RegExp("HTTP " + status));
    assert.equal(browser.isVisible(), false);
    console.log("PASS: HTTP " + status + " fails immediately on the same recovery panel");
  }

  // A completely unrelated site can return HTTP 200 and run JavaScript.
  // It still must not be treated as a Lampa instance.
  const beforeUnrelated = failure;
  const unrelatedStarted = Date.now();
  navigation.open(base + "unrelated-script");
  await until(async () => failure > beforeUnrelated && (await panelState())?.error,
    "Unrelated HTML/JS webpage was treated as Lampa", 2400);
  assert.ok(Date.now() - unrelatedStarted < 1800);
  assert.match((await panelState()).message, /это не Lampa/);
  console.log("PASS: HTTP 200 unrelated JavaScript page is rejected promptly");

  await content(panel, `document.getElementById("url").value = ${JSON.stringify(base + "slow-script")}; document.querySelector("#recovery-form").requestSubmit()`);
  await until(async () => (await panelState())?.message?.startsWith("Страница получена"),
    "HTML arrival was not distinguished from slow script initialization");
  assert.equal(browser.isVisible(), false);
  assert.equal(panel.isVisible(), true);
  await until(() => success === 1, "Slow but valid site incorrectly timed out", 3500);
  assert.equal(browser.isVisible(), true);
  assert.equal(panel.isVisible(), false);
  console.log("PASS: local panel persists while slow Lampa initializes after fast HTML");

  navigation.open(base + "blank");
  await until(async () => (await panelState())?.error === true, "Empty site not rejected", 4000);
  assert.equal(panel.id, firstPanelId);
  console.log("PASS: blank HTML fails after render grace with no new window");

  await content(panel, "document.getElementById('default').click()");
  // User default points to public Lampa, which is not deterministic here.
  await until(async () => (await panelState())?.message?.includes("Пробуем открыть сервер"),
    "Default button did not initiate a user-controlled load");
  navigation.open(base + "language");
  await until(() => success === 2, "Real language picker was rejected");
  assert.equal(panel.isVisible(), false);
  console.log("PASS: first-run Lampa selector accepted and panel hidden");

  const oldCount = history.length;
  navigation.open("notaurl");
  await until(async () => (await panelState())?.error === true,
    "Malformed URL did not preserve local panel");
  assert.equal(history.length, oldCount);
  console.log("PASS: invalid syntax gives immediate error without navigating");
  clearTimeout(watchdog);
  browser.destroy();
  panel.destroy();
  server.close();
  app.exit(0);
}).catch(error => {
  console.error(error);
  clearTimeout(watchdog);
  if (browser && !browser.isDestroyed()) browser.destroy();
  if (panel && !panel.isDestroyed()) panel.destroy();
  if (server) server.close();
  app.exit(1);
});
