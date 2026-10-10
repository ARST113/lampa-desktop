const { BrowserWindow, screen } = require("electron");
const path = require("node:path");
const store = require("./storeManager");
const { setupPluginHandler } = require("./pluginHandler");
const { setupDevTools } = require("./devTools");

let mainWindow = null;

function getFullscreenConfig() {
  const mode = store.get("fullscreenMode", "last");
  const savedWindowState = store.get("windowState", {});

  switch (mode) {
    case "always":
      return { fullscreen: true, shouldShowFullscreen: true };
    case "never":
      return { fullscreen: false, shouldShowFullscreen: false };
    case "last":
      return {
        fullscreen: savedWindowState.fullscreen || false,
        shouldShowFullscreen: savedWindowState.fullscreen || false,
      };
    default:
      return { fullscreen: false, shouldShowFullscreen: false };
  }
}

function getMainWindow() {
  return mainWindow;
}

function saveWindowState(state) {
  store.set("windowState", state);
}

function loadWindowState() {
  const state = store.get("windowState");

  if (
    state &&
    typeof state === "object" &&
    "x" in state &&
    "y" in state &&
    "width" in state &&
    "height" in state
  ) {
    return state;
  }

  return null;
}

function createWindow() {
  const savedState = loadWindowState();
  const fullscreenConfig = getFullscreenConfig();
  const displays = screen.getAllDisplays();

  if (process.argv.includes("--dev")) {
    console.log("List displays:", displays);
  }

  let windowOptions = {
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      // Lampa switches embedded audio tracks through HTMLMediaElement.audioTracks.
      enableBlinkFeatures: "AudioVideoTracks",
      enableRemoteModule: false,
      sandbox: false,
      contextMenu: false,
      webSecurity: Boolean(store.get("webSecurity")),
    },
    show: false,
    titleBarStyle: "default",
    icon: path.join(__dirname, "../build/icon.png"),
    fullscreen: fullscreenConfig.fullscreen,
  };

  let targetDisplay;
  if (savedState && savedState.displayId) {
    targetDisplay = displays.find((d) => d.id === savedState.displayId);
  }
  if (!targetDisplay) {
    targetDisplay = displays[0];
  }

  const displayBounds = targetDisplay.bounds;

  if (savedState && savedState.width && savedState.height) {
    const maxX = displayBounds.x + displayBounds.width - savedState.width;
    const maxY = displayBounds.y + displayBounds.height - savedState.height;

    windowOptions.x = Math.max(
      displayBounds.x,
      Math.min(savedState.x || 0, maxX),
    );
    windowOptions.y = Math.max(
      displayBounds.y,
      Math.min(savedState.y || 0, maxY),
    );
    windowOptions.width = savedState.width;
    windowOptions.height = savedState.height;
  } else {
    windowOptions.width = 1200;
    windowOptions.height = 800;
    windowOptions.x = displayBounds.x;
    windowOptions.y = displayBounds.y;
  }

  mainWindow = new BrowserWindow(windowOptions);
  setupDevTools(mainWindow);

  mainWindow.setMenu(null);

  mainWindow.once("ready-to-show", () => {
    if (savedState && !fullscreenConfig.shouldShowFullscreen) {
      try {
        mainWindow.setBounds({
          x: windowOptions.x,
          y: windowOptions.y,
          width: windowOptions.width,
          height: windowOptions.height,
        });
      } catch (error) {
        console.error("Ошибка при установке границ окна:", error);
        mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
      }
    }

    mainWindow.show();

    if (process.platform === "darwin") {
      mainWindow.focus();
    }
  });

  setupPluginHandler(mainWindow);

  const saveState = () => {
    if (
      !mainWindow.isDestroyed() &&
      !mainWindow.isMaximized() &&
      !mainWindow.isMinimized() &&
      !mainWindow.isFullScreen()
    ) {
      const bounds = mainWindow.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const isFullscreen = mainWindow.isFullScreen();

      const windowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        displayId: display.id,
        maximized: mainWindow.isMaximized(),
        fullscreen: isFullscreen,
      };

      saveWindowState(windowState);
    }
  };

  mainWindow.on("move", saveState);
  mainWindow.on("resize", saveState);

  mainWindow.on("close", () => {
    if (!mainWindow.isDestroyed()) {
      const bounds = mainWindow.getNormalBounds
        ? mainWindow.getNormalBounds()
        : mainWindow.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const isFullscreen = mainWindow.isFullScreen();

      const windowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        displayId: display.id,
        maximized: mainWindow.isMaximized(),
        fullscreen: isFullscreen,
      };

      saveWindowState(windowState);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  setupNavigationHandlers(mainWindow);
  setupErrorHandler(mainWindow);
  setupWindowOpenHandler(mainWindow);

  // Register all navigation and failure handlers before the initial request.
  const lampaUrl = store.get("lampaUrl");
  mainWindow.loadURL(lampaUrl).catch((error) => {
    console.error("Не удалось открыть адрес Lampa:", lampaUrl, error);
  });

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

function setupNavigationHandlers(mainWindow) {
  let isReloadingFromHandler = false;

  mainWindow.webContents.on(
    "did-start-navigation",
    (event, url, isInPlace, isMainFrame) => {
      const currentUrl = mainWindow.webContents.getURL();

      if (isMainFrame && url === currentUrl) {
        console.log("Reload request detected");

        if (!isReloadingFromHandler && event.initiator) {
          console.log("Preventing default reload and using Electron reload");
          event.preventDefault();

          isReloadingFromHandler = true;
          setTimeout(() => {
            mainWindow.webContents.reload();
            setTimeout(() => {
              isReloadingFromHandler = false;
            }, 100);
          }, 10);
        }
      }
    },
  );

  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(navigationUrl);
    } catch {
      event.preventDefault();
      return;
    }

    // Self-hosted Lampa instances can redirect between arbitrary HTTP(S) domains.
    // Do not constrain navigation to a particular catalog server or protocol.
    const allowedProtocols = [
      "http:",
      "https:",
      "mpv:",
      "iina:",
      "infuse:",
      "senplayer:",
    ];
    if (allowedProtocols.includes(parsedUrl.protocol)) return;

    event.preventDefault();
  });
}

function setupErrorHandler(mainWindow) {
  let showingFailurePage = false;

  mainWindow.webContents.on(
    "did-start-navigation",
    (_event, url, _isInPlace, isMainFrame) => {
      if (
        isMainFrame &&
        (url.startsWith("http://") || url.startsWith("https://"))
      ) {
        showingFailurePage = false;
      }
    },
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED (normal when redirecting or changing addresses).
      if (!isMainFrame || errorCode === -3 || showingFailurePage) return;
      showingFailurePage = true;

      console.error("Ошибка загрузки страницы Lampa", {
        errorCode,
        errorDescription,
        validatedURL,
      });

      // Display a local error page even if the external site cannot run JS.
      // Never overwrite the user's selected catalog server with lampa.mx.
      mainWindow
        .loadFile(path.join(__dirname, "..", "loadError.html"), {
          query: {
            url: validatedURL || store.get("lampaUrl") || "",
            code: String(errorCode),
            message: errorDescription,
          },
        })
        .catch((error) => {
          console.error("Не удалось открыть страницу ошибки:", error);
        });
    },
  );
}

function setupWindowOpenHandler(mainWindow) {
  const { shell } = require("electron");

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

module.exports = {
  createWindow,
  getMainWindow,
};
