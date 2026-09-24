const { ipcMain } = require("electron");

function registerOtherHandlers() {
  ipcMain.handle("app-check-updates", (event) => {
    const { getMainWindow } = require("../windowManager");
    const contents = getMainWindow()?.webContents;
    if (
      !contents ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    ) {
      throw new Error(
        "Update checks are only available from the application window.",
      );
    }
    return require("../autoUpdater").checkForAppUpdates();
  });
  ipcMain.handle("get-app-version", () => {
    const { app } = require("electron");
    return app.getVersion();
  });
}

module.exports = registerOtherHandlers;
