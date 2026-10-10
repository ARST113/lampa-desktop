const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_LAMPA_URL,
  normalizeHttpUrl,
  isInternalNavigation,
} = require("../src/modules/pageNavigation");
const { isSameNavigation } = require("../src/modules/navigationFallback");

test("accepts any full HTTP or HTTPS URL", () => {
  assert.equal(normalizeHttpUrl(" http://lampac.fun/ "), "http://lampac.fun/");
  assert.equal(normalizeHttpUrl("https://lampac.fun/"), "https://lampac.fun/");
  assert.equal(
    normalizeHttpUrl("https://example.net:8443/app?card=12#player"),
    "https://example.net:8443/app?card=12#player",
  );
  assert.equal(DEFAULT_LAMPA_URL, "http://lampa.mx");
});

test("rejects unsupported protocols and malformed URLs", () => {
  for (const value of [
    "",
    "lampac.fun",
    "javascript:alert(1)",
    "file:///tmp/a",
    "data:text/html,x",
  ]) {
    assert.throws(() => normalizeHttpUrl(value), TypeError);
  }
});

test("permits same-site navigation and HTTP to HTTPS upgrade", () => {
  assert.equal(
    isInternalNavigation(
      "https://lampac.fun/catalog/123",
      "http://lampac.fun/",
      "http://lampac.fun/",
    ),
    true,
  );
  assert.equal(
    isInternalNavigation(
      "https://custom.example.org/library",
      "about:blank",
      "https://custom.example.org/",
    ),
    true,
  );
  assert.equal(
    isInternalNavigation(
      "https://unrelated.example.org/",
      "https://lampac.fun/",
      "https://lampac.fun/",
    ),
    false,
  );
  assert.equal(
    isInternalNavigation("javascript:alert(1)", "http://lampac.fun/"),
    false,
  );
});

test("fallback matches redirects but ignores obsolete failure events", () => {
  assert.equal(
    isSameNavigation("https://lampac.fun/home", "http://lampac.fun/"),
    true,
  );
  assert.equal(
    isSameNavigation("https://another.example/", "http://lampac.fun/"),
    false,
  );
  assert.equal(
    isSameNavigation("http://127.0.0.1:8800/", "http://127.0.0.1:8801/"),
    false,
  );
});

test("failed URL handling never displays a recovery HTML page", () => {
  const root = path.join(__dirname, "..", "src");
  const manager = fs.readFileSync(
    path.join(root, "modules", "windowManager.js"),
    "utf8",
  );
  const fallback = fs.readFileSync(
    path.join(root, "modules", "navigationFallback.js"),
    "utf8",
  );
  assert.match(manager, /createNavigationFallback/);
  assert.match(manager, /onReady: showReadyWindow/);
  assert.match(fallback, /store\.set\("lampaUrl", fallbackUrl\)/);
  assert.doesNotMatch(manager + fallback, /createLoadFailureUrl|document\.write/);
});

test("manual URL changes go through the fallback controller", () => {
  const root = path.join(__dirname, "..", "src");
  const ipc = fs.readFileSync(
    path.join(root, "modules", "ipcHandlers", "windowHandlers.js"),
    "utf8",
  );
  assert.match(ipc, /openLampaUrl\(mainWindow, target\)/);
});
