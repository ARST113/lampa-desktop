const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { gzipSync } = require("node:zlib");

app.setPath(
  "userData",
  path.join(__dirname, "..", ".cache", "torrserver-cancellation-profile"),
);

const streams = new Set();
const waiting = new Set();
const payload = Buffer.alloc(64 * 1024);
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/stream/")) {
    streams.add(res);
    res.writeHead(200, { "Content-Type": "video/x-matroska" });
    res.write(payload);
    const timer = setInterval(() => {
      if (!res.writableNeedDrain) res.write(payload);
    }, 30);
    res.once("close", () => {
      clearInterval(timer);
      streams.delete(res);
    });
  } else if (req.url === "/waiting") {
    waiting.add(res);
    res.once("close", () => waiting.delete(res));
  } else if (req.url === "/gzip") {
    const data = gzipSync('{"server":"available"}');
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      "Content-Length": data.length,
    });
    res.end(data);
  } else if (req.url === "/empty") {
    res.writeHead(204);
    res.end();
  } else if (req.url === "/echo") {
    res.end("MatriX.test");
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>TorrServer cancellation regression</title>");
  }
});

const timeout = setTimeout(() => {
  console.error("TorrServer cancellation regression timed out");
  app.exit(2);
}, 50000);

app.whenReady().then(async () => {
  try {
    require("../src/modules/playerOptionsInterceptor").initialize();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const window = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
    const ordinary = await window.webContents.executeJavaScript(`(async () => {
      const gzip = await (await fetch('/gzip')).json();
      const head = await fetch('/echo', { method: 'HEAD' });
      const empty = await fetch('/empty');
      return { gzip, headStatus: head.status, headBody: await head.text(),
        emptyStatus: empty.status, emptyBody: await empty.text() };
    })()`);
    assert.deepEqual(ordinary, {
      gzip: { server: "available" },
      headStatus: 200,
      headBody: "",
      emptyStatus: 204,
      emptyBody: "",
    });
    for (let i = 0; i < 8; i++) {
      const result = await window.webContents.executeJavaScript(`(async () => {
        let stage = 'headers';
        try {
          const response = await fetch('/stream/movie-${i}.mkv', {
            signal: AbortSignal.timeout(1500)
          });
          const reader = response.body.getReader();
          stage = 'body';
          await reader.read();
          stage = 'cancel';
          await reader.cancel();
          return { cancelled: true };
        } catch (error) {
          return { stage, error: error.message, name: error.name };
        }
      })()`);
      assert.equal(
        result.cancelled,
        true,
        `Movie ${i} could not start/cancel (${streams.size} upstream streams remain): ${JSON.stringify(result)}`,
      );
    }
    const deadline = Date.now() + 1500;
    while (streams.size && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      streams.size,
      0,
      "Cancelled MKV streams must close upstream connections",
    );
    const echo = await window.webContents.executeJavaScript(`(async () => {
      const response = await fetch('/echo', { signal: AbortSignal.timeout(1500) });
      return response.text();
    })()`);
    assert.equal(echo, "MatriX.test");
    console.log(
      "PASS: cancelled MKV streams release sockets; TorrServer echo remains available after eight switches.",
    );
    await window.webContents.executeJavaScript(`(async () => {
      const response = await fetch('/stream/long.mkv');
      window.longStreamReader = response.body.getReader();
      await longStreamReader.read();
    })()`);
    const longStarted = Date.now();
    await window.webContents.executeJavaScript(`(() => {
      window.waitingController = new AbortController();
      window.waitingFetch = fetch('/waiting', {
        signal: waitingController.signal
      }).catch(error => error.name);
    })()`);
    const arrivalDeadline = Date.now() + 2000;
    while (!waiting.size && Date.now() < arrivalDeadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      waiting.size,
      1,
      "The no-headers request must reach the server before it is cancelled",
    );
    await window.webContents.executeJavaScript(`(async () => {
      waitingController.abort();
      return waitingFetch;
    })()`);
    const headersDeadline = Date.now() + 33000;
    while (
      (waiting.size || Date.now() - longStarted < 31000) &&
      Date.now() < headersDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      waiting.size,
      0,
      "An abandoned request that never receives headers must release its upstream connection within 33 seconds",
    );
    assert.equal(
      streams.size,
      1,
      "The headers deadline must not interrupt an established video stream",
    );
    const longBody = await window.webContents.executeJavaScript(`(async () => {
      const next = await longStreamReader.read();
      await longStreamReader.cancel();
      return next.value.length;
    })()`);
    assert.ok(
      longBody > 0,
      "Video bytes must remain readable after the headers deadline",
    );
    console.log(
      "PASS: early-cancelled requests with no response headers are bounded; gzip, HEAD and 204 responses remain intact.",
    );
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    clearTimeout(timeout);
    for (const response of streams) response.destroy();
    for (const response of waiting) response.destroy();
    server.close();
  }
});
