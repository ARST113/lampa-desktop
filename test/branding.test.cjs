const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const plugin = fs.readFileSync(path.join(root, "src/plugin.js"), "utf8");
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");

test("Donation controls and payment links are absent", () => {
  assert.doesNotMatch(
    plugin,
    /app_settings_donate|donate_(?:btn|modal|support)/,
  );
  assert.doesNotMatch(plugin, /robokassa|donate-link|donate-qr-container/i);
});

test("About uses fork and prerelease-compatible API", () => {
  assert.match(plugin, /github\.com\/ARST113\/lampa-desktop/);
  assert.match(plugin, /ARST113\/lampa-desktop\/releases\?per_page=1/);
  assert.doesNotMatch(plugin, /github\.com\/Kolovatoff\/lampa-desktop/);
  assert.match(plugin, /app_settings_about/);
});

test("Package metadata and license are consistent with the fork", () => {
  assert.equal(metadata.author.name, "ARST113");
  assert.equal(metadata.build.linux.vendor, "ARST113");
  assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
});
