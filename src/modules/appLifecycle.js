const { app } = require("electron");
const { record } = require("./startupDiagnostics");

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  record("second instance - forwarding focus to running Lampa");
  app.quit();
  process.exit(0);
}

function setupAppLifecycle() {
  app.on("second-instance", () => {
    const { getMainWindow } = require("./windowManager");
    const mainWindow = getMainWindow();

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      // A failed site could leave the first application hidden.
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else if (app.isReady()) {
      require("./windowManager").createWindow();
    }
  });
}

module.exports = {
  setupAppLifecycle,
  gotTheLock,
};
