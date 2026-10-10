const { readFileSync } = require("fs");
const path = require("node:path");
const lampaInitializer = require("./lampaInitializer");

function isHttpPage(url) {
  return url.startsWith("http://") || url.startsWith("https://");
}

function setupPluginHandler(mainWindow) {
  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      // Do not attempt to inject into the data: recovery screen.
      if (!isHttpPage(mainWindow.webContents.getURL())) return;

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
  // Failed loads and non-Lampa sites cannot poll the renderer forever.
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isDestroyed() ||
      !isHttpPage(mainWindow.webContents.getURL())
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
