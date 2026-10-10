const { ipcMain } = require("electron");

function registerStoreHandlers(store) {
  // URL changes must go through the single navigation controller.
  // An old onDidChange listener called BrowserWindow.loadURL directly and
  // raced the fallback controller, leaving the renderer blank.
  ipcMain.handle("store-get", (_event, key) => store.get(key));

  ipcMain.handle("store-set", (event, key, value) => {
    if (key === "lampaUrl") {
      const { getMainWindow, openLampaUrl } = require("../windowManager");
      const mainWindow = getMainWindow();
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame
      ) {
        throw new Error("Only the application window may change Lampa URL.");
      }

      const { normalizeHttpUrl } = require("../pageNavigation");
      const url = normalizeHttpUrl(value);
      store.set("lampaUrl", url);
      openLampaUrl(mainWindow, url);
      return;
    }

    store.set(key, value);
  });

  ipcMain.handle("store-has", (_event, key) => store.has(key));

  ipcMain.handle("store-delete", (_event, key) => {
    if (key === "lampaUrl") {
      throw new Error("The application URL cannot be deleted.");
    }
    if (store.has(key)) {
      store.delete(key);
      return true;
    }
    return false;
  });
}

module.exports = registerStoreHandlers;
