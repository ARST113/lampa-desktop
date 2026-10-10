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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createLoadFailureHtml({ url, code, description } = {}) {
  const errorUrl = escapeHtml(url || "");
  const errorDescription = escapeHtml(
    description || "Не удалось открыть страницу.",
  );
  const errorCode = escapeHtml(code ?? "неизвестен");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Ошибка загрузки — Lampa Desktop</title>
<style>
  html,body{margin:0;min-height:100%;background:#14161b;color:#f0f1f4;font-family:Arial,sans-serif}
  body{display:grid;place-items:center;padding:24px;box-sizing:border-box}
  main{width:min(100%,540px);background:#20232b;border:1px solid #363a45;border-radius:16px;padding:28px;box-sizing:border-box}
  h1{font-size:24px;margin:0 0 12px}p{line-height:1.5;color:#c3c6d0}
  .details{font-size:13px;overflow-wrap:anywhere;color:#aeb2bf;background:#181a20;padding:12px;border-radius:8px}
  label{display:block;margin:22px 0 8px}input{box-sizing:border-box;width:100%;background:#14161b;border:1px solid #535968;color:white;border-radius:8px;padding:12px;font:inherit}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
  button{background:#4269da;border:0;border-radius:8px;padding:12px 16px;color:white;cursor:pointer;font:inherit}
  button.secondary{background:#414651}
  #status{min-height:20px;color:#ffaba5;font-size:13px}
</style>
</head>
<body>
<main>
<h1>Не удалось загрузить Lampa</h1>
<p>Адрес может быть временно недоступен или заблокирован сетью. Настройки и данные приложения не удалены.</p>
<div class="details">Ошибка: ${errorCode} — ${errorDescription}<p>Адрес: ${errorUrl}</p></div>
<label for="url">Адрес Lampa</label>
<input id="url" type="url" spellcheck="false" autocomplete="off" value="${errorUrl}">
<div class="actions">
<button id="retry">Повторить</button>
<button class="secondary" id="default">Открыть стандартную Lampa</button>
</div>
<p id="status" role="alert"></p>
</main>
<script>
(function () {
  const input = document.getElementById("url");
  const status = document.getElementById("status");
  function openTarget(value) {
    let target;
    try {
      target = new URL(value.trim());
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error("Нужен адрес с http:// или https://.");
      }
    } catch (error) {
      status.textContent = error.message || "Неверный адрес.";
      return;
    }
    if (!window.electronAPI || !window.electronAPI.loadUrl) {
      status.textContent = "Не удалось вызвать загрузчик приложения.";
      return;
    }
    status.textContent = "Загрузка...";
    window.electronAPI.loadUrl(target.href);
  }
  document.getElementById("retry").addEventListener("click", function () {
    openTarget(input.value);
  });
  document.getElementById("default").addEventListener("click", function () {
    openTarget(${JSON.stringify(DEFAULT_LAMPA_URL)});
  });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") openTarget(input.value);
  });
})();
</script>
</body>
</html>`;
}

function createLoadFailureUrl(details) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    createLoadFailureHtml(details),
  )}`;
}

module.exports = {
  DEFAULT_LAMPA_URL,
  normalizeHttpUrl,
  isInternalNavigation,
  createLoadFailureHtml,
  createLoadFailureUrl,
};
