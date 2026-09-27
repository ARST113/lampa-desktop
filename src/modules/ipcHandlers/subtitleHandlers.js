const { app, ipcMain } = require("electron");
const path = require("node:path");
const { extractSubtitles, probeSubtitles } = require("../subtitleExtractor");
const { stream } = require("../subtitleStream");

function registerSubtitleHandlers(getMainWindow) {
  const sessions = new Map();
  const watched = new WeakSet();
  const subscriptions = new Map();
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
  function stopWatching(contents) {
    subscriptions.get(contents.id)?.stop();
    subscriptions.delete(contents.id);
  }
  function watchLifecycle(contents) {
    if (watched.has(contents)) return;
    watched.add(contents);
    const clean = () => {
      cancel(contents);
      stopWatching(contents);
    };
    contents.once("destroyed", clean);
    contents.on(
      "did-start-navigation",
      (_event, _url, isInPlace, isMainFrame) => {
        // Lampa changes history/hash while the same player keeps running.
        // Only a new document invalidates its subtitle subscription.
        if (isMainFrame && !isInPlace) clean();
      },
    );
  }
  ipcMain.handle("desktop-subtitles-watch", (event, url) => {
    const contents = owner(event);
    stopWatching(contents);
    watchLifecycle(contents);
    const subscription = stream.watch(url, (packet) => {
      if (!contents.isDestroyed())
        contents.send("desktop-subtitles-stream", packet);
    });
    subscriptions.set(contents.id, subscription);
    return subscription.snapshot;
  });
  ipcMain.handle("desktop-subtitles-unwatch", (event) =>
    stopWatching(owner(event)),
  );
  ipcMain.handle("desktop-subtitles-seek", (event, time) =>
    subscriptions.get(owner(event).id)?.seek(time),
  );
  ipcMain.handle("desktop-subtitles-cancel", (event, id) =>
    cancel(owner(event), id),
  );
  async function run(event, request, probing = false) {
    const contents = owner(event);
    cancel(contents);
    watchLifecycle(contents);
    const executable = app.isPackaged
      ? path.join(
          process.resourcesPath,
          "subtitle-tools",
          probing ? "ffprobe.exe" : "ffmpeg.exe",
        )
      : path.join(
          app.getAppPath(),
          ".cache",
          "subtitle-tools",
          probing ? "ffprobe.exe" : "ffmpeg.exe",
        );
    try {
      const session = probing
        ? probeSubtitles(executable, request)
        : extractSubtitles(executable, request, (text) => {
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
  }
  ipcMain.handle("desktop-subtitles-extract", (event, request) =>
    run(event, request),
  );
  ipcMain.handle("desktop-subtitles-probe", (event, request) =>
    run(event, request, true),
  );
  app.on("before-quit", () => {
    for (const subscription of subscriptions.values()) subscription.stop();
    subscriptions.clear();
    for (const session of sessions.values()) session.cancel();
    sessions.clear();
  });
}
module.exports = registerSubtitleHandlers;
