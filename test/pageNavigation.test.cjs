const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_LAMPA_URL,
  normalizeHttpUrl,
  isInternalNavigation,
  createLoadFailureHtml,
  createLoadFailureUrl,
} = require("../src/modules/pageNavigation");

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

test("error screen escapes untrusted error content", () => {
  const html = createLoadFailureHtml({
    url: 'https://invalid.example/?x="><script>alert(1)</script>',
    code: -105,
    description: "<bad network>",
  });
  assert.match(html, /Не удалось загрузить Lampa/);
  assert.match(html, /Ошибка: -105/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /window\.electronAPI\.loadUrl/);
  const target = createLoadFailureUrl({ code: -105 });
  assert.ok(target.startsWith("data:text/html;charset=utf-8,"));
  assert.match(decodeURIComponent(target.split(",")[1]), /<!doctype html>/);
});

test("error recovery hooks are wired to IPC", () => {
  const root = path.join(__dirname, "..", "src");
  const manager = fs.readFileSync(
    path.join(root, "modules", "windowManager.js"),
    "utf8",
  );
  const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
  const ipc = fs.readFileSync(
    path.join(root, "modules", "ipcHandlers", "windowHandlers.js"),
    "utf8",
  );

  assert.match(manager, /did-fail-load/);
  assert.match(manager, /isInternalNavigation/);
  assert.doesNotMatch(manager, /document\.write\(/);
  assert.match(preload, /ipcRenderer\.send\("reload-page", url\)/);
  assert.match(ipc, /ipcMain\.on\("reload-page"/);
  assert.match(ipc, /store\.set\("lampaUrl", target\)/);
});
