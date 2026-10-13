const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(relativePath, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8"),
    {
      module,
      exports: module.exports,
      require: (name) =>
        Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
      console: { log() {}, error() {}, warn() {} },
      process,
      Buffer,
      URL,
      AbortSignal,
      fetch: () => {
        throw new Error("Node Undici fetch must not be used in main process");
      },
    },
    { filename: relativePath },
  );
  return module.exports;
}

test("TorrServer probes use Electron transport, including HTTP 404 bodies", async () => {
  const seen = [];
  let cancelled = 0;
  const net = {
    fetch: async (url) => {
      seen.push(url);
      if (url.includes("api.github.com")) {
        return {
          ok: true,
          json: async () => ({ tag_name: "MatriX.test", assets: [] }),
        };
      }
      if (url.endsWith("/gst/echo")) {
        return {
          status: 404,
          body: {
            cancel: async () => {
              cancelled++;
            },
          },
        };
      }
      if (url.endsWith("/echo")) {
        return { ok: true, text: async () => "MatriX.142.2" };
      }
      throw new Error("Unexpected URL: " + url);
    },
  };
  const manager = load("src/modules/torrServerManager.js", {
    electron: { app: { getPath: () => "/tmp/lampa-test" }, net },
    "./storeManager": { get: () => false },
    "./portablePaths": { resolvePortableRoot: () => null },
  });
  const release = await manager.getLatestRelease();
  assert.equal(release.version, "MatriX.test");
  assert.equal(await manager.getVersion(8090), "142.2");
  const gst = await manager.checkGstSupport(8090);
  assert.equal(gst.supported, false);
  assert.equal(cancelled, 1);
  assert.equal(seen.length, 3);
});

test("cloud import and export never invoke Node Undici fetch", async () => {
  const handlers = new Map();
  const requests = [];
  let imported = false;
  const net = {
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/ei/upload")) {
        return { json: async () => ({ id: "example-id" }) };
      }
      return {
        json: async () => ({ success: true, data: "encrypted-payload" }),
      };
    },
  };
  const ipcMain = {
    handle: (name, handler) => handlers.set(name, handler),
  };
  const window = {
    webContents: {
      executeJavaScript: async () => ({ language: "ru" }),
    },
  };
  const register = load("src/modules/ipcHandlers/cloudHandlers.js", {
    electron: { ipcMain, net, app: { getVersion: () => "test" } },
    "../utils/encryption": {
      generatePin: () => 1234,
      encryptJson: () => "encrypted-payload",
      decryptJson: () => ({ app: {}, lampa: {} }),
    },
    "./settingsHandlers": {
      importSettings: async () => {
        imported = true;
      },
    },
  });
  register({ get: () => ({}) }, () => window, () => {});
  const uploaded = await handlers.get("export-settings-to-cloud")();
  assert.equal(uploaded.success, true);
  const downloaded = await handlers.get("import-settings-from-cloud")(
    null,
    "example-id",
    1234,
  );
  assert.equal(downloaded.success, true);
  assert.equal(imported, true);
  assert.equal(requests.length, 2);
});

test("subtitle range reader does not retain a Node.js fetch fallback", async () => {
  const { SubtitleStream } = load("src/modules/subtitleStream.js", {});
  const stream = new SubtitleStream();
  await assert.rejects(stream.fetchRange("http://localhost/test.mkv"));
});
