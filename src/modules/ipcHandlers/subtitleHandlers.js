const { app, ipcMain } = require("electron");
const path = require("node:path");
const { extractSubtitles } = require("../subtitleExtractor");

function registerSubtitleHandlers(getMainWindow) {
  const sessions = new Map();
  const watched = new WeakSet();
  function owner(event) {
    const contents = getMainWindow()?.webContents;
    if (
      !contents ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    )
      throw new Error(
        "Subtitles are only available from the application window.",
      );
    return contents;
  }
  function cancel(contents, id) {
    const session = sessions.get(contents.id);
    if (session && (!id || id === session.id)) {
      session.cancel();
      sessions.delete(contents.id);
    }
  }
  ipcMain.handle("desktop-subtitles-cancel", (event, id) =>
    cancel(owner(event), id),
  );
  ipcMain.handle("desktop-subtitles-extract", async (event, request) => {
    const contents = owner(event);
    cancel(contents);
    if (!watched.has(contents)) {
      watched.add(contents);
      contents.once("destroyed", () => cancel(contents));
      contents.on(
        "did-start-navigation",
        (_event, _url, _inPlace, isMainFrame) => {
          if (isMainFrame) cancel(contents);
        },
      );
    }
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, "subtitle-tools", "ffmpeg.exe")
      : path.join(app.getAppPath(), ".cache", "subtitle-tools", "ffmpeg.exe");
    try {
      const session = extractSubtitles(executable, request, (text) => {
        if (!contents.isDestroyed())
          contents.send("desktop-subtitles-data", { id: request.id, text });
      });
      session.id = request.id;
      sessions.set(contents.id, session);
      const result = await session.promise;
      if (sessions.get(contents.id) === session) sessions.delete(contents.id);
      return result;
    } catch {
      return {
        success: false,
        message: "Не удалось запустить обработку субтитров для этого видео.",
      };
    }
  });
}
module.exports = registerSubtitleHandlers;
