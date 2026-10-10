const { readFileSync } = require("fs");
const path = require("node:path");
const lampaInitializer = require("./lampaInitializer");

function setupPluginHandler(mainWindow) {
  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      // The data: recovery screen and unrelated websites must not start a
      // permanent Lampa readiness polling loop.
      const currentUrl = mainWindow.webContents.getURL();
      (!mainWindow.webContents.getURL().startsWith("http://") &&
        !mainWindow.webContents.getURL().startsWith("https://"))

      const ready = await waitForLampaReady(mainWindow);
      if (!ready) {
        console.log("Lampa API was not detected on this page.");
        return;
      }

      await lampaInitializer.initialize(mainWindow);
      injectPlugin(mainWindow);
    } catch (err) {
      console.error("Ошибка при перезагрузке:", err);
    }
  });
}

async function waitForLampaReady(mainWindow) {
  // A bad URL or a non-Lampa page must not poll the renderer forever.
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isDestroyed() ||
      !/^https?:\\/\\//i.test(mainWindow.webContents.getURL())
    ) {
      return false;
    }

    const isReady = await mainWindow.webContents
      .executeJavaScript("Boolean(window.Lampa)", true)
      .catch(() => false);
    if (isReady) return true;

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function injectPlugin(mainWindow) {
  const pluginCode = readFileSync(
    path.join(__dirname, "..", "plugin.js"),
    "utf-8",
  );
  mainWindow.webContents
    .executeJavaScript(
      pluginCode +
        "\n" +
        readFileSync(path.join(__dirname, "..", "subtitleBridge.js"), "utf-8"),
    )
    .then(() => {
      console.log("Плагин успешно внедрён");
    })
    .catch((err) => {
      console.error("Ошибка внедрения плагина:", err);
    });
}

module.exports = {
  setupPluginHandler,
  injectPlugin,
};
