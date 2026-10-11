const { app } = require("electron");
const { record, fatal } = require("./modules/startupDiagnostics");
const path = require("node:path");
const { configurePortableProfile } = require("./modules/portablePaths");

// Resolve portable profile before loading modules which initialize electron-store.
try {
  const profile = configurePortableProfile(app);
  record("profile", profile ? "portable: " + profile : "installed: " + app.getPath("userData"));
} catch (error) {
  fatal("Не удалось создать профиль приложения. Проверьте права на папку Portable и свободную память.", error);
  process.exit(1);
}

const { setupAppLifecycle, gotTheLock } = require("./modules/appLifecycle");
const { createWindow } = require("./modules/windowManager");
const { setupAutoUpdater } = require("./modules/autoUpdater");
const { registerIpcHandlers } = require("./modules/ipcHandlers");
const torrServerManager = require("./modules/torrServerManager");
const autoStartManager = require("./modules/autoStartManager");
const PlayerOptionsInterceptor = require("./modules/playerOptionsInterceptor");
setupAppLifecycle();

// Меняем расположение кеша и т.п. для разработки, чтобы не мешало установленной версии
if (process.argv.includes("--dev") || process.env.NODE_ENV === "development") {
  // Для Windows: C:\Users\%USERNAME%\AppData\Roaming\Lampa-Dev
  // Для macOS: ~/Library/Application Support/Lampa-Dev
  // Для Linux: ~/.config/Lampa-Dev
  const devAppName = `${app.getName()}-Dev`;
  const originalUserData = app.getPath("userData");
  const devUserData = path.join(path.dirname(originalUserData), devAppName);
  app.setPath("userData", devUserData);
  console.log(`🔧 Режим разработки: ${devUserData}`);
}

registerIpcHandlers();

app.whenReady().then(async () => {
  if (!gotTheLock) return;

  PlayerOptionsInterceptor.initialize();

  try {
    record("creating BrowserWindow");
    createWindow();
    record("BrowserWindow created");
  } catch (error) {
    fatal("Не удалось создать окно Lampa.", error);
    app.exit(1);
    return;
  }

  setTimeout(async () => {
    try {
      await autoStartManager.initialize();
    } catch (error) {
      console.error("Ошибка при автозапуске TorrServer:", error);
    }
  }, 3000);

  app.on("activate", () => {
    const { BrowserWindow } = require("electron");
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  setupAutoUpdater();
  record("startup setup complete");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

process.on("uncaughtException", (error) => {
  fatal("Необработанная ошибка основного процесса.", error);
  app.exit(1);
});
process.on("unhandledRejection", (error) => {
  record("unhandledRejection", error);
});

let isQuitting = false;

app.on("will-quit", async (event) => {
  if (isQuitting) return;
  if (!torrServerManager.process) {
    record("normal application exit (no TorrServer child)");
    return;
  }

  // Предотвращаем немедленный выход
  event.preventDefault();
  isQuitting = true;

  console.log("🔄 Завершение работы приложения...");

  try {
    console.log("🛑 Остановка TorrServer...");

    const stopResult = await Promise.race([
      torrServerManager.stop(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout stopping TorrServer")),
          2000,
        ),
      ),
    ]);

    console.log("✅ TorrServer остановлен:", stopResult);
  } catch (error) {
    console.error("❌ Ошибка при остановке TorrServer:", error);

    // Принудительное завершение, если процесс все еще существует
    if (torrServerManager.process) {
      try {
        torrServerManager.process.kill("SIGKILL");
        console.log("⚠️ TorrServer принудительно завершен");
      } catch (killError) {
        console.error(
          "❌ Не удалось принудительно завершить TorrServer:",
          killError,
        );
      }
    }
  }

  console.log("👋 Завершение приложения");
  app.exit(0);
});

// Дополнительный обработчик на случай, если will-quit не сработает
app.on("before-quit", () => {
  if (torrServerManager.process && !isQuitting) {
    console.log("⚠️ Принудительное завершение TorrServer перед выходом");
    try {
      torrServerManager.process.kill("SIGKILL");
    } catch {
      /* empty */
    }
  }
});
