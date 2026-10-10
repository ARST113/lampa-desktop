const DEFAULT_LAMPA_URL = "http://lampa.mx";

function normalizeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("Укажите адрес сайта.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TypeError(
      "Неверный URL. Нужен полный адрес с http:// или https://.",
    );
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new TypeError("Поддерживаются только адреса http:// и https://.");
  }
  return url.href;
}

function isInternalNavigation(destination, currentUrl, configuredUrl) {
  let target;
  try {
    target = new URL(normalizeHttpUrl(destination));
  } catch {
    return false;
  }

  return [currentUrl, configuredUrl].some((value) => {
    try {
      const url = new URL(normalizeHttpUrl(value));
      return url.hostname === target.hostname && url.port === target.port;
    } catch {
      return false;
    }
  });
}

module.exports = {
  DEFAULT_LAMPA_URL,
  normalizeHttpUrl,
  isInternalNavigation,
};
