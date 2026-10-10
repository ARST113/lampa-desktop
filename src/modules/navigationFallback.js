const { DEFAULT_LAMPA_URL, normalizeHttpUrl } = require("./pageNavigation");

const STARTUP_TIMEOUT_MS = 15000;
const READINESS_POLL_MS = 250;

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

    if (failed !== fallbackUrl) {
      // A bad custom address must never become a persistent white screen.
      store.set("lampaUrl", fallbackUrl);
      open(fallbackUrl);
      return;
    }

    // A broken default URL cannot fall back to itself forever.
    onUnavailable(reason);
  }

  async function checkReady(id) {
    if (!isCurrent(id)) return;

    const ready = await window.webContents
      .executeJavaScript("Boolean(window.Lampa && document.body)", true)
      .catch(() => false);
    if (!isCurrent(id)) return;

    if (ready) {
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
    return a.hostname === b.hostname && a.port === b.port;
  } catch {
    return false;
  }
}

module.exports = {
  createNavigationFallback,
  isSameNavigation,
  STARTUP_TIMEOUT_MS,
};
