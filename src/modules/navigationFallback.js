const { DEFAULT_LAMPA_URL, normalizeHttpUrl } = require("./pageNavigation");

const STARTUP_TIMEOUT_MS = 30000;
const READINESS_POLL_MS = 250;
const EMERGENCY_LAMPA_URL = "https://cf.lampa.mx/";

const LAMPA_RENDERED_SCRIPT = `(() => {
  const root = document.getElementById("app");
  const shell = root?.querySelector(".wrap");
  const head = root?.querySelector(".head");
  const content = root?.querySelector(".wrap__content");
  // Hidden BrowserWindow may report zero layout width on Windows.
  // The app is ready when Lampa creates its real interface. Some forks
  // render the shell before (or without) setting window.appready.
  return Boolean(window.Lampa && head && shell && content);
})()`;

function createNavigationFallback(
  window,
  store,
  {
    defaultUrl = DEFAULT_LAMPA_URL,
    timeoutMs = STARTUP_TIMEOUT_MS,
    pollMs = READINESS_POLL_MS,
    onReady = () => {},
    onUnavailable = () => {},
  } = {},
) {
  const fallbackUrl = normalizeHttpUrl(defaultUrl);
  // Alternative official HTTPS host is used only for the actual default,
  // never for tests or independently configured fallbacks.
  const backupUrl =
    fallbackUrl === normalizeHttpUrl(DEFAULT_LAMPA_URL)
      ? EMERGENCY_LAMPA_URL
      : null;
  let current = null;
  let attemptNumber = 0;
  let timeout = null;
  let poll = null;

  function clearTimers() {
    if (timeout !== null) clearTimeout(timeout);
    if (poll !== null) clearTimeout(poll);
    timeout = null;
    poll = null;
  }

  function isCurrent(id) {
    return (
      current !== null &&
      current.id === id &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed()
    );
  }

  function handleFailure(id, reason) {
    if (!isCurrent(id)) return;

    const failed = current.url;
    clearTimers();
    current = null;
    console.error("Не удалось запустить Lampa:", failed, reason);

    if (failed !== fallbackUrl && failed !== backupUrl) {
      // Failed custom settings must not persist across restarts.
      store.set("lampaUrl", fallbackUrl);
      open(fallbackUrl);
      return;
    }

    if (failed === fallbackUrl && backupUrl) {
      console.warn("Основной адрес Lampa недоступен, пробуем резервный:", backupUrl);
      store.set("lampaUrl", backupUrl);
      open(backupUrl);
      return;
    }

    // No infinite retry loop when all available entry points fail.
    onUnavailable(reason);
  }

  async function checkReady(id) {
    if (!isCurrent(id)) return;

    // A global Lampa object exists long before the interface is drawn.
    // Check the actual interface, without tying readiness to a hidden
    // BrowserWindow's geometry or fork-dependent appready timing.
    if (!isSameNavigation(window.webContents.getURL(), current.url)) return;

    const ready = await window.webContents
      .executeJavaScript(LAMPA_RENDERED_SCRIPT, true)
      .catch(() => false);
    if (!isCurrent(id)) return;

    if (ready) {
      console.info("Lampa interface ready:", window.webContents.getURL());
      clearTimers();
      current = null;
      onReady();
      return;
    }

    poll = setTimeout(() => {
      void checkReady(id);
    }, pollMs);
  }

  function open(value) {
    let target;
    try {
      target = normalizeHttpUrl(value);
    } catch (error) {
      console.warn("Неверный адрес Lampa:", value, error.message);
      store.set("lampaUrl", fallbackUrl);
      target = fallbackUrl;
    }

    clearTimers();
    console.info("Lampa navigation started:", target);
    // Never expose an Electron error page or an empty renderer during
    // recovery. Background throttling must be disabled on the window
    // so that Lampa's JavaScript keeps running while it is hidden.
    if (!window.isDestroyed() && window.isVisible()) window.hide();
    const id = ++attemptNumber;
    current = { id, url: target };
    timeout = setTimeout(() => {
      handleFailure(id, new Error("Время загрузки Lampa истекло."));
    }, timeoutMs);

    try {
      Promise.resolve(window.loadURL(target)).catch((error) => {
        handleFailure(id, error);
      });
    } catch (error) {
      handleFailure(id, error);
    }
  }

  window.webContents.on("did-finish-load", () => {
    if (current !== null) void checkReady(current.id);
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, description, url, isMainFrame) => {
      // -3 / ERR_ABORTED is normal for redirects and interrupted requests.
      // Never interpret an iframe's failure as a failed Lampa document.
      if (isMainFrame === false || errorCode === -3 || !current) return;

      // Ignore a delayed failure from a previous navigation.
      if (url && !isSameNavigation(url, current.url)) return;
      handleFailure(
        current.id,
        new Error(`HTTP navigation error ${errorCode}: ${description}`),
      );
    },
  );

  window.on("closed", () => {
    clearTimers();
    current = null;
  });

  return { open };
}

function isSameNavigation(actual, expected) {
  try {
    const a = new URL(actual);
    const b = new URL(expected);
    if (a.hostname === b.hostname && a.port === b.port) return true;
    // The official HTTP entry point can redirect to the HTTPS mirror.
    const official = new Set(["lampa.mx", "cf.lampa.mx"]);
    return (
      !a.port &&
      !b.port &&
      official.has(a.hostname) &&
      official.has(b.hostname)
    );
  } catch {
    return false;
  }
}

module.exports = {
  createNavigationFallback,
  isSameNavigation,
  STARTUP_TIMEOUT_MS,
  EMERGENCY_LAMPA_URL,
  LAMPA_RENDERED_SCRIPT,
};
