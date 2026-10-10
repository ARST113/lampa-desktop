const { BrowserWindow, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const store = require("./storeManager");
const { setupPluginHandler } = require("./pluginHandler");
const { setupDevTools } = require("./devTools");
const {
  DEFAULT_LAMPA_URL,
  isInternalNavigation,
  normalizeHttpUrl,
} = require("./pageNavigation");
const { createNavigationFallback } = require("./navigationFallback");

let mainWindow = null;
const navigationControllers = new WeakMap();

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
      // Lampa must execute scripts and produce its UI while the window is hidden.
      backgroundThrottling: false,
    },
    show: false,
    backgroundColor: "#14161b",
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

  const showReadyWindow = () => {
    if (mainWindow.isDestroyed() || mainWindow.isVisible()) return;
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
  };

  setupNavigationHandlers(mainWindow);
  const navigation = setupErrorHandler(mainWindow, {
    onReady: showReadyWindow,
  });
  navigationControllers.set(mainWindow, navigation);
  setupWindowOpenHandler(mainWindow);
  setupPluginHandler(mainWindow);

  navigation.open(store.get("lampaUrl", DEFAULT_LAMPA_URL));
  watchConfiguredUrl(mainWindow, navigation);

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
    if (
      ["mpv:", "iina:", "infuse:", "senplayer:"].includes(parsedUrl.protocol)
    ) {
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

// Portable users can edit LampaData/config.json while the application is
// running. Read the actual file: electron-store's in-memory snapshot is not a
// reliable notification mechanism for external edits and atomic file writes.
function watchConfiguredUrl(window, navigation) {
  const filename = store.path;
  let observed = store.get("lampaUrl", DEFAULT_LAMPA_URL);

  function changed() {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    let configured;
    try {
      configured = JSON.parse(fs.readFileSync(filename, "utf8")).lampaUrl;
    } catch {
      // An editor can temporarily truncate the file during an atomic save.
      return;
    }
    if (typeof configured !== "string" || configured === observed) return;
    observed = configured;
    let url;
    try {
      url = normalizeHttpUrl(configured);
    } catch (error) {
      console.warn("Недопустимый URL в config.json:", error.message);
      return;
    }
    if (url !== navigation.getTarget()) {
      console.info("Применён адрес из config.json:", url);
      navigation.open(url);
    }
  }

  fs.watchFile(filename, { persistent: false, interval: 500 }, changed);
  window.once("closed", () => fs.unwatchFile(filename, changed));
}

function setupErrorHandler(window, { onReady = () => window.show() } = {}) {
  let navigation;

  navigation = createNavigationFallback(window, store, {
    onReady,
    onUnavailable(error) {
      console.error("Стандартный сервер Lampa тоже недоступен:", error);
      if (window.isDestroyed()) return;

      // Do not leave a hidden or unusable window after two failed hosts.
      // The local recovery screen accepts any valid address, even while
      // offline, and is not dependent on the remote Lampa renderer.
      void window
        .loadFile(path.join(__dirname, "..", "recovery.html"))
        .then(() => {
          if (!window.isDestroyed()) window.show();
        })
        .catch((recoveryError) => {
          console.error("Не удалось открыть экран восстановления:", recoveryError);
          if (!window.isDestroyed()) window.show();
        });
    },
  });

  return navigation;
}

function openLampaUrl(window, url) {
  const navigation = navigationControllers.get(window);
  if (!navigation)
    throw new Error("Lampa navigation has not been initialized.");
  navigation.open(url);
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
  setupNavigationHandlers,
  setupErrorHandler,
  openLampaUrl,
};
