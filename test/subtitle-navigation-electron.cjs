const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".cache/subtitle-test");
const media = fs.readFileSync(path.join(output, "fixture.mkv"));
app.setPath("userData", path.join(output, "navigation-profile"));
let window;
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/fixture.mkv")) {
    res.writeHead(200, { "Content-Type": "video/x-matroska" });
    res.end(media);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>Subtitle navigation regression</title>");
  }
});
const timeout = setTimeout(() => app.exit(2), 30000);
app
  .whenReady()
  .then(async () => {
    require("../src/modules/playerOptionsInterceptor").initialize();
    require("../src/modules/ipcHandlers/subtitleHandlers")(() => window);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(root, "src/preload.js"),
        sandbox: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    const page = `http://127.0.0.1:${server.address().port}/`;
    await window.loadURL(page);
    const received = await window.webContents.executeJavaScript(`(async () => {
    const packets = [];
    electronAPI.subtitles.onStream(packet => packets.push(packet));
    const url = new URL('/fixture.mkv', location.href).href;
    await electronAPI.subtitles.watch(url);
    history.pushState({}, '', '?card=1');
    history.replaceState({}, '', '?card=1&select=open');
    location.hash = 'player';
    await new Promise(resolve => setTimeout(resolve, 100));
    await (await fetch(url)).arrayBuffer();
    const end = Date.now() + 3000;
    while (!packets.some(p => p.events.some(e => e.type === 'cue')) && Date.now() < end)
      await new Promise(resolve => setTimeout(resolve, 25));
    return packets.flatMap(p => p.events).filter(e => e.type === 'cue').map(e => e.cue.text);
  })()`);
    assert.ok(
      received.some((text) => text.includes("первая")),
      "Subtitle text must continue arriving after Lampa changes its in-page route",
    );

    // A real document navigation must still release the previous subscription.
    const { stream } = require("../src/modules/subtitleStream");
    assert.equal([...stream.media.values()][0].listeners.size, 1);
    await window.loadURL(`${page}?new-document=1`);
    assert.equal([...stream.media.values()][0].listeners.size, 0);
    console.log(
      "PASS: subtitles survive history/hash navigation; document navigation releases the subscription.",
    );
    clearTimeout(timeout);
    server.close();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
