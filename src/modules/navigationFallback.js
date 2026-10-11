const { normalizeHttpUrl } = require("./pageNavigation");

// A single URL is attempted once. Any failure immediately returns control
// to the local URL editor; there is no automatic fallback or mirror cascade.
const STARTUP_TIMEOUT_MS = 3000;
const READINESS_POLL_MS = 200;

const LAMPA_RENDERED_SCRIPT = `(() => {
  const root = document.getElementById("app");
  const shell = root?.querySelector(".wrap");
  const head = root?.querySelector(".head");
  const content = root?.querySelector(".wrap__content");
  const languageChoice = document.querySelector(
    "body > .lang .lang__selector-item[data-code]",
  );
  return Boolean(window.Lampa && ((head && shell && content) || languageChoice));
})()`;

function isSameNavigation(actual, expected) {
  try {
    const a = new URL(actual);
    const b = new URL(expected);
    if (a.hostname === b.hostname && a.port === b.port) return true;
    const official = new Set(["lampa.mx", "cf.lampa.mx"]);
    return !a.port && !b.port && official.has(a.hostname) && official.has(b.hostname);
  } catch {
    return false;
  }
}

function createNavigationFallback(
  window,
  _store,
  {
    timeoutMs = STARTUP_TIMEOUT_MS,
    pollMs = READINESS_POLL_MS,
    onReady = () => {},
    onUnavailable = () => {},
  } = {},
) {
  let current = null;
  let sequence = 0;
  let lastTarget = null;
  let timeout = null;
  let poll = null;

  function clearTimers() {
    if (timeout !== null) clearTimeout(timeout);
    if (poll !== null) clearTimeout(poll);
    timeout = null;
    poll = null;
  }

  function isCurrent(id) {
    return current?.id === id &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed();
  }

  function fail(id, error) {
    if (!isCurrent(id)) return;
    const failedUrl = current.url;
    clearTimers();
    current = null;
    console.warn("Lampa URL недоступен:", failedUrl, error);
    // Crucially, do not rewrite lampaUrl and do not load a different host.
    // Let the user edit the exact attempted URL or choose lampa.mx explicitly.
    onUnavailable(error, failedUrl);
  }

  async function checkReady(id) {
    if (!isCurrent(id)) return;
    if (!isSameNavigation(window.webContents.getURL(), current.url)) return;

    const ready = await window.webContents
      .executeJavaScript(LAMPA_RENDERED_SCRIPT, true)
      .catch(() => false);
    if (!isCurrent(id)) return;

    if (ready) {
      const loadMs = Date.now() - current.startedAt;
      clearTimers();
      current = null;
      console.info("Lampa URL открыт:", window.webContents.getURL(), "за", loadMs, "мс");
      onReady();
      return;
    }
    poll = setTimeout(() => void checkReady(id), pollMs);
  }

  function open(value) {
    let target;
    try {
      target = normalizeHttpUrl(value);
    } catch {
      clearTimers();
      current = null;
      lastTarget = String(value ?? "");
      onUnavailable(new Error("Укажите полный HTTP или HTTPS адрес."), lastTarget);
      return;
    }

    // Settings IPC and an external config.json watcher may report the same
    // update concurrently. A duplicate must not restart an in-flight load.
    if (current?.url === target) return;

    // Each explicit attempt replaces the previous one; callbacks from old
    // loadURL promises, old timeouts and cancelled navigations are ignored.
    clearTimers();
    lastTarget = target;
    const id = ++sequence;
    current = { id, url: target, startedAt: Date.now() };
    window.setTitle?.("Lampa — подключение: " + target);
    window.setProgressBar?.(0.2);
    timeout = setTimeout(() => {
      fail(id, new Error("Сайт не ответил или не запустил интерфейс за 3 секунды."));
    }, timeoutMs);

    try {
      Promise.resolve(window.loadURL(target)).catch((error) => fail(id, error));
    } catch (error) {
      fail(id, error);
    }
  }

  window.webContents.on("did-finish-load", () => {
    if (current) void checkReady(current.id);
  });

  window.webContents.on(
    "did-fail-load",
    (_event, code, description, url, isMainFrame) => {
      if (isMainFrame === false || code === -3 || !current) return;
      if (url && !isSameNavigation(url, current.url)) return;
      fail(current.id, new Error("Ошибка соединения " + code + ": " + description));
    },
  );

  window.on("closed", () => {
    clearTimers();
    current = null;
  });

  return {
    open,
    getTarget: () => current?.url || lastTarget,
    getState: () => (current ? "loading" : "idle"),
  };
}

module.exports = {
  createNavigationFallback,
  isSameNavigation,
  STARTUP_TIMEOUT_MS,
  LAMPA_RENDERED_SCRIPT,
};
