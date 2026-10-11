const { BrowserWindow, screen, ipcMain } = require("electron");
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
let recoveryWindow = null;
let recoveryState = null;
let recoveryHandlerRegistered = false;
let stoppingRecovery = false;
const navigationControllers = new WeakMap();

function ensureRecoveryHandler() {
  if (recoveryHandlerRegistered) return;
  recoveryHandlerRegistered = true;
  ipcMain.handle("lampa-recovery-try-url", (event, raw) => {
    if (!recoveryWindow || recoveryWindow.isDestroyed() ||
        event.sender !== recoveryWindow.webContents ||
        event.senderFrame !== recoveryWindow.webContents.mainFrame) {
      throw new Error("Недоступен защищённый редактор адреса Lampa.");
    }
    const url = normalizeHttpUrl(raw);
    const window = mainWindow;
    if (!window || window.isDestroyed()) throw new Error("Окно Lampa закрыто.");
    store.set("lampaUrl", url);
    openLampaUrl(window, url);
    return true;
  });
}

function setRecoveryState(phase, url, error = "") {
  recoveryState = { phase, url, error };
  if (recoveryWindow && !recoveryWindow.isDestroyed() &&
      !recoveryWindow.webContents.isLoadingMainFrame()) {
    recoveryWindow.webContents.send("lampa-recovery-state", recoveryState);
  }
}

function ensureRecoveryWindow() {
  ensureRecoveryHandler();
  if (recoveryWindow && !recoveryWindow.isDestroyed()) return recoveryWindow;
  const panel = new BrowserWindow({
    width: 830, height: 540, minWidth: 680, minHeight: 480,
    show: false, backgroundColor: "#111315", autoHideMenuBar: true,
    title: "Lampa — подключение",
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "..", "recoveryPreload.js"),
      nodeIntegration: false, contextIsolation: true, sandbox: false,
      backgroundThrottling: false,
    },
  });
  recoveryWindow = panel;
  panel.setMenu(null);
  panel.webContents.on("did-finish-load", () => {
    if (panel === recoveryWindow && recoveryState) {
      panel.webContents.send("lampa-recovery-state", recoveryState);
    }
  });
  panel.on("closed", () => {
    if (panel === recoveryWindow) recoveryWindow = null;
    // Closing the visible recovery editor is an explicit Exit action.
    // Never strand a hidden Lampa main process behind a closed panel.
    if (!stoppingRecovery && mainWindow && !mainWindow.isDestroyed() &&
        !mainWindow.isVisible()) mainWindow.close();
  });
  void panel.loadFile(path.join(__dirname, "..", "recovery.html"), {
    query: { url: store.get("lampaUrl", DEFAULT_LAMPA_URL) },
  }).catch((error) => console.error("Не удалось создать окно подключения:", error));
  return panel;
}

function showRecoveryState(phase, url, error = "") {
  const panel = ensureRecoveryWindow();
  setRecoveryState(phase, url, error);
  if (!panel.isDestroyed()) {
    if (panel.isMinimized()) panel.restore();
    panel.show();
    panel.focus();
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.hide();
}

function closeRecoveryPanel() {
  if (recoveryWindow && !recoveryWindow.isDestroyed()) recoveryWindow.hide();
}

function getActiveWindow() {
  if (recoveryWindow && !recoveryWindow.isDestroyed() &&
      recoveryWindow.isVisible()) return recoveryWindow;
  return mainWindow;
}


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
    onLoading: (url) => showRecoveryState("loading", url),
    onDocumentLoaded: (url) => setRecoveryState("rendering", url),
    onReady: () => {
      if (!mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
      showReadyWindow();
      closeRecoveryPanel();
    },
  });
  navigationControllers.set(mainWindow, navigation);
  setupWindowOpenHandler(mainWindow);
  setupPluginHandler(mainWindow);

  // Keep one local visible connection panel while remote Electron navigates
  // in the background. Never replace the panel on failure or retry.
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
    stoppingRecovery = true;
    if (recoveryWindow && !recoveryWindow.isDestroyed()) recoveryWindow.destroy();
    recoveryWindow = null;
    stoppingRecovery = false;
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

function setupErrorHandler(
  window,
  {
    onReady = () => window.show(),
    onLoading = () => {},
    onDocumentLoaded = () => {},
  } = {},
) {
  return createNavigationFallback(window, store, {
    onReady,
    onLoading,
    onDocumentLoaded,
    onUnavailable(error, failedUrl) {
      console.warn("Адрес Lampa не открылся:", failedUrl, error);
      if (!window.isDestroyed()) {
        window.setProgressBar(-1);
        showRecoveryState("error", failedUrl, String(error?.message || error));
      }
    },
  });
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
  getActiveWindow,
  setupNavigationHandlers,
  setupErrorHandler,
  openLampaUrl,
};
