const { autoUpdater } = require("electron-updater");
const { app, dialog, shell } = require("electron");
const store = require("./storeManager");

let initialized = false;
let checking = null;
let installDialog = null;
let state = { status: "idle", message: "Обновления ещё не проверялись." };

function updateError(error) {
  console.error("Auto-update error:", error);
  state = {
    status: "error",
    message:
      "Не удалось обновить приложение. Проверьте подключение и повторите проверку.",
  };
  return state;
}

function offerInstall() {
  if (installDialog) return installDialog;
  installDialog = dialog
    .showMessageBox({
      type: "info",
      title: "Обновление готово",
      message: `Lampa ${state.version} загружена. Установить и перезапустить приложение?`,
      buttons: ["Обновить и перезапустить", "Позже", "Список изменений"],
      defaultId: 1,
      cancelId: 1,
    })
    .then(async ({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
      if (response === 2)
        await shell.openExternal(
          "https://github.com/ARST113/lampa-desktop/releases",
        );
    })
    .catch(console.error)
    .finally(() => {
      installDialog = null;
    });
  return installDialog;
}

async function checkForAppUpdates(manual = true) {
  if (!app.isPackaged)
    return {
      status: "unavailable",
      message: "Обновления доступны в установленной версии Lampa.",
    };
  if (state.status === "downloaded") {
    if (manual) await offerInstall();
    return state;
  }
  if (state.status === "downloading") return state;
  if (checking) return checking;
  state = { status: "checking", message: "Проверка обновлений…" };
  checking = Promise.resolve()
    .then(() => autoUpdater.checkForUpdates())
    .then((result) => {
      // Downloads continue after the version check has finished.
      result?.downloadPromise?.catch(updateError);
      return state;
    })
    .catch(updateError)
    .finally(() => {
      checking = null;
    });
  return checking;
}

function setupAutoUpdater() {
  if (initialized) return;
  initialized = true;
  autoUpdater.logger = console;
  autoUpdater.channel = "ac3";
  autoUpdater.allowPrerelease = true;
  // Setting the channel enables downgrades in electron-updater; turn them off.
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    console.log("Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    state = {
      status: "downloading",
      version: info.version,
      message: `Загружается Lampa ${info.version}…`,
    };
  });

  autoUpdater.on("update-not-available", () => {
    state = {
      status: "up-to-date",
      message: "Установлена последняя версия Lampa.",
    };
  });

  autoUpdater.on("error", updateError);

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.max(0, Math.min(100, Math.round(progressObj.percent)));
    state = {
      ...state,
      status: "downloading",
      message: `Загружается обновление: ${percent}%`,
    };
  });

  autoUpdater.on("update-downloaded", (info) => {
    state = {
      status: "downloaded",
      version: info.version,
      message: `Lampa ${info.version} готова к установке.`,
    };
    void offerInstall();
  });

  const checkAutomatically = () => {
    if (store.get("autoUpdate")) return checkForAppUpdates(false);
  };
  setTimeout(checkAutomatically, 5000);
  setInterval(checkAutomatically, 30 * 60 * 1000);
}

module.exports = {
  setupAutoUpdater,
  checkForAppUpdates,
};
