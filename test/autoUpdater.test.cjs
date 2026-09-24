const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture({ enabled = true, packaged = true } = {}) {
  const updater = new EventEmitter();
  const timers = [];
  const dialogs = [];
  const installs = [];
  let checks = 0;
  let response = 1;
  updater.checkForUpdates = async () => {
    checks++;
    updater.emit("update-not-available", { version: "1.6.0-ac3.2" });
    return {};
  };
  updater.quitAndInstall = (...args) => installs.push(args);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../src/modules/autoUpdater.js"),
      "utf8",
    ),
    {
      module,
      require: (name) =>
        ({
          "electron-updater": { autoUpdater: updater },
          electron: {
            app: { isPackaged: packaged },
            dialog: {
              showMessageBox: async (options) => {
                dialogs.push(options);
                return { response };
              },
            },
            shell: { openExternal: async () => {} },
          },
          "./storeManager": { get: () => enabled },
        })[name],
      console: { log() {}, error() {} },
      setTimeout: (callback) => timers.push(callback),
      setInterval: (callback) => timers.push(callback),
    },
  );
  module.exports.setupAutoUpdater();
  return {
    ...module.exports,
    updater,
    timers,
    dialogs,
    installs,
    get checks() {
      return checks;
    },
    setResponse(value) {
      response = value;
    },
  };
}

test("manual check reports up-to-date even when automatic checks are disabled", async () => {
  const f = fixture({ enabled: false });
  for (const timer of f.timers) await timer();
  assert.equal(f.checks, 0);
  const result = await f.checkForAppUpdates();
  assert.equal(f.checks, 1);
  assert.equal(result.status, "up-to-date");
});

test("checks on startup and periodically, pins AC3 channel and prevents downgrades", async () => {
  const f = fixture();
  assert.equal(f.updater.channel, "ac3");
  assert.equal(f.updater.allowPrerelease, true);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.timers.length, 2);
  for (const timer of f.timers) await timer();
  assert.equal(f.checks, 2);
});

test("concurrent manual checks share the current request", async () => {
  const f = fixture();
  let finish;
  let calls = 0;
  f.updater.checkForUpdates = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const a = f.checkForAppUpdates();
  const b = f.checkForAppUpdates();
  await Promise.resolve();
  assert.equal(calls, 1);
  f.updater.emit("update-not-available", {});
  finish({});
  assert.equal((await a).status, "up-to-date");
  assert.equal((await b).status, "up-to-date");
});

test("manual click reports current download progress instead of starting another", async () => {
  const f = fixture();
  f.updater.emit("update-available", { version: "1.6.0-ac3.3" });
  f.updater.emit("download-progress", { percent: 42.3 });
  const result = await f.checkForAppUpdates();
  assert.equal(result.status, "downloading");
  assert.match(result.message, /42%/);
  assert.equal(f.checks, 0);
});

test("deferred installation can be opened again and restarts only after confirmation", async () => {
  const f = fixture();
  f.updater.emit("update-downloaded", { version: "1.6.0-ac3.3" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.installs.length, 0);
  assert.equal(f.dialogs[0].cancelId, 1);
  f.setResponse(0);
  await f.checkForAppUpdates();
  assert.equal(f.dialogs.length, 2);
  assert.deepEqual(f.installs, [[false, true]]);
});

test("network errors are reported and a later check can retry", async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => {
    throw new Error("offline");
  };
  const failed = await f.checkForAppUpdates();
  assert.equal(failed.status, "error");
  f.updater.checkForUpdates = async () => {
    f.updater.emit("update-not-available", {});
    return {};
  };
  assert.equal((await f.checkForAppUpdates()).status, "up-to-date");
});

test("development builds do not try to download an installer", async () => {
  const f = fixture({ packaged: false });
  assert.equal((await f.checkForAppUpdates()).status, "unavailable");
  assert.equal(f.checks, 0);
});

test("download failures are handled after the version check has completed", async () => {
  const f = fixture();
  let rejectDownload;
  f.updater.checkForUpdates = async () => {
    f.updater.emit("update-available", { version: "1.6.0-ac3.3" });
    return {
      downloadPromise: new Promise((_, reject) => {
        rejectDownload = reject;
      }),
    };
  };
  assert.equal((await f.checkForAppUpdates()).status, "downloading");
  rejectDownload(new Error("download interrupted"));
  await new Promise((resolve) => setImmediate(resolve));
  f.updater.checkForUpdates = async () => {
    f.updater.emit("update-not-available", {});
    return {};
  };
  assert.equal((await f.checkForAppUpdates()).status, "up-to-date");
});
