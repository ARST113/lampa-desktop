const { BrowserWindow, screen } = require("electron");
const path = require("node:path");
const store = require("./storeManager");
const { setupPluginHandler } = require("./pluginHandler");
const { setupDevTools } = require("./devTools");
const {
  DEFAULT_LAMPA_URL,
  normalizeHttpUrl,
  isInternalNavigation,
  createLoadFailureUrl,
} = require("./pageNavigation");

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

  setupNavigationHandlers(mainWindow);
  setupErrorHandler(mainWindow);
  setupWindowOpenHandler(mainWindow);
  setupPluginHandler(mainWindow);

  const lampaUrl = store.get("lampaUrl", DEFAULT_LAMPA_URL);
  try {
    mainWindow.loadURL(normalizeHttpUrl(lampaUrl)).catch((error) => {
      console.error("Ошибка открытия Lampa:", error);
    });
  } catch (error) {
    console.error("Недопустимый сохранённый адрес Lampa:", error);
    mainWindow
      .loadURL(
        createLoadFailureUrl({
          url: lampaUrl,
          code: "INVALID_URL",
          description: error.message,
        }),
      )
      .catch((navigationError) => {
        console.error("Ошибка открытия экрана восстановления:", navigationError);
      });
  }

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

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

function setupNavigationHandlers(window) {
  const { shell } = require("electron");
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(navigationUrl);
    } catch {
      event.preventDefault();
      return;
    }

    // External player protocols should launch in the operating system,
    // not replace the embedded Lampa document.
    if (["mpv:", "iina:", "infuse:", "senplayer:"].includes(parsedUrl.protocol)) {
      event.preventDefault();
      shell.openExternal(navigationUrl).catch((error) => {
        console.error("Ошибка открытия внешнего плеера:", error);
      });
      return;
    }

    if (
      isInternalNavigation(
        navigationUrl,
        window.webContents.getURL(),
        store.get("lampaUrl", DEFAULT_LAMPA_URL),
      )
    ) {
      return;
    }

    // Arbitrary cross-site navigation is not allowed in the privileged
    // window. Open external links via the existing window-open handler.
    event.preventDefault();
  });
}

function setupErrorHandler(window) {
  let recoveryShown = false;

  window.webContents.on("did-start-navigation", (_event, url, _inPlace, isMainFrame) => {
    if (isMainFrame && /^https?:\\/\\//i.test(url)) {
      recoveryShown = false;
    }
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // ERR_ABORTED happens during redirects, navigation changes, and reloads.
      // An iframe failure must not replace the whole desktop application.
      if (
        isMainFrame === false ||
        errorCode === -3 ||
        recoveryShown ||
        window.isDestroyed() ||
        window.webContents.isDestroyed()
      ) {
        return;
      }

      recoveryShown = true;
      console.error("Не удалось загрузить Lampa:", {
        errorCode,
        errorDescription,
        validatedURL,
      });

      const failurePage = createLoadFailureUrl({
        url: validatedURL || store.get("lampaUrl", DEFAULT_LAMPA_URL),
        code: errorCode,
        description: errorDescription,
      });

      // Navigating to a real HTML document works even when the original
      // navigation failed before any DOM could be created.
      window.webContents.loadURL(failurePage).catch((error) => {
        console.error("Не удалось отобразить экран восстановления:", error);
      });
      if (!window.isVisible()) window.show();
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
