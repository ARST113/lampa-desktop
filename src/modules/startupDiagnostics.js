const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const base = process.env.LOCALAPPDATA || os.tmpdir();
const folder = path.join(base, "Lampa-NextGen", "diagnostics");
const logFile = path.join(folder, "startup.log");

function record(stage, detail = "") {
  const value =
    detail instanceof Error
      ? detail.stack || detail.message
      : String(detail || "");
  const message =
    new Date().toISOString() +
    " [pid=" +
    process.pid +
    "] " +
    stage +
    (value ? " " + value : "");
  console.log("[Lampa Startup]", message);
  try {
    fs.mkdirSync(folder, { recursive: true });
    // Keep this accessible file bounded even after repeated failed attempts.
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) {
      fs.renameSync(logFile, logFile + ".old");
    }
    fs.appendFileSync(logFile, message + "\n", "utf8");
  } catch (error) {
    console.error("[Lampa Startup] Cannot write diagnostics:", error);
  }
}

function fatal(title, error) {
  record("FATAL " + title, error);
  try {
    require("electron").dialog.showErrorBox(
      "Lampa — ошибка запуска",
      title +
        "\n\n" +
        (error?.message || String(error)) +
        "\n\nЖурнал: " +
        logFile,
    );
  } catch (dialogError) {
    record("Error dialog unavailable", dialogError);
  }
}

module.exports = { record, fatal, logFile };
