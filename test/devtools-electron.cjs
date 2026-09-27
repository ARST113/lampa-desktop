const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
app.setPath("userData", path.join(root, ".cache/devtools-test"));
setTimeout(() => app.exit(2), 15000);
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(root, "src/preload.js"),
        sandbox: false,
        contextIsolation: true,
      },
    });
    require("../src/modules/devTools").setupDevTools(window);
    require("../src/modules/ipcHandlers/windowHandlers")(() => window);
    await window.loadURL("data:text/html,<h1>Console test</h1>");
    const opened = new Promise((resolve) =>
      window.webContents.once("devtools-opened", resolve),
    );
    await window.webContents.executeJavaScript("electronAPI.openDevTools()");
    await opened;
    assert.equal(window.webContents.isDevToolsOpened(), true);
    const key = (key, extra = {}) => {
      let prevented = false;
      window.webContents.emit(
        "before-input-event",
        {
          preventDefault() {
            prevented = true;
          },
        },
        { type: "keyDown", key, ...extra },
      );
      assert.equal(prevented, true);
    };
    key("F12");
    assert.equal(window.webContents.isDevToolsOpened(), false);
    const reopened = new Promise((resolve) =>
      window.webContents.once("devtools-opened", resolve),
    );
    key("I", { control: true, shift: true });
    await reopened;
    key("F12", { isAutoRepeat: true });
    assert.equal(window.webContents.isDevToolsOpened(), true);
    key("F12");
    assert.equal(window.webContents.isDevToolsOpened(), false);
    console.log(
      "PASS: Console button, F12, Ctrl+Shift+I and key repeat handling.",
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
