const { spawn } = require("node:child_process");

const WINDOW_SECONDS = 90;

function validateRequest(request) {
  if (
    !request ||
    typeof request.url !== "string" ||
    request.url.length > 8192 ||
    /[\r\n\0]/.test(request.url)
  )
    throw new Error("Invalid subtitle URL");
  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only HTTP media is supported");
  if (
    !Number.isInteger(request.streamIndex) ||
    request.streamIndex < 0 ||
    request.streamIndex > 255
  )
    throw new Error("Invalid subtitle stream");
  if (
    !Number.isFinite(request.start) ||
    request.start < 0 ||
    request.start > 604800
  )
    throw new Error("Invalid subtitle timestamp");
  if (
    typeof request.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,96}$/.test(request.id)
  )
    throw new Error("Invalid subtitle request ID");
}

function extractSubtitles(executable, request, onData) {
  validateRequest(request);
  const child = spawn(
    executable,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-protocol_whitelist",
      "http,https,tcp,tls",
      "-rw_timeout",
      "15000000",
      "-ss",
      String(request.start),
      // Limit the input to Matroska/WebM; never follow playlists or local files.
      "-f",
      "matroska",
      "-i",
      request.url,
      "-t",
      String(WINDOW_SECONDS),
      "-map",
      `0:${request.streamIndex}`,
      "-vn",
      "-an",
      "-c:s",
      "webvtt",
      "-flush_packets",
      "1",
      "-f",
      "webvtt",
      "pipe:1",
    ],
    { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
  let cancelled = false;
  let failure = null;
  let outputBytes = 0;
  const stop = (message) => {
    failure = message;
    child.kill();
  };
  const timer = setTimeout(
    () => stop("Субтитры не загрузились вовремя. Повторно выберите дорожку."),
    120000,
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    outputBytes += Buffer.byteLength(text);
    if (outputBytes > 2 * 1024 * 1024) stop("Слишком большой объём субтитров.");
    else if (!cancelled && !failure) onData(text);
  });
  // Drain stderr, but do not log URLs that may contain server credentials.
  child.stderr.resume();
  const promise = new Promise((resolve) => {
    child.once("error", () => {
      failure = "Не удалось запустить обработку субтитров.";
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        success: !cancelled && !failure && code === 0,
        cancelled,
        start: request.start,
        end: request.start + WINDOW_SECONDS,
        message:
          failure ||
          (code !== 0 && !cancelled
            ? "Не удалось прочитать текстовые субтитры из MKV. Повторно выберите дорожку."
            : ""),
      });
    });
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      child.kill();
    },
  };
}

module.exports = { extractSubtitles, validateRequest };
