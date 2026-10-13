// Regression test for an uncaught Node 24 Undici parser assertion.
// Test the actual Electron runtime, not the CI host's Node.js binary.
const { app } = require("electron");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

app.setPath(
  "userData",
  path.join(__dirname, "..", ".cache", "undici-regression-profile"),
);

const server = http.createServer((req, res) => {
  if (req.url === "/upload" && req.method === "POST") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(JSON.parse(Buffer.concat(chunks).toString())));
    });
  } else if (req.url === "/echo") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("MatriX.142.2");
  } else if (req.url === "/gst/echo") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        gst_discoverer: { works: true },
        gstreamer: { works: true, version: "1.0" },
      }),
    );
  } else if (req.url === "/large") {
    // A peer closing after a 64KiB+ body can hit assert(!this.paused)
    // in Node's global fetch when the response is not consumed.
    const body = Buffer.alloc(256 * 1024, 0x61);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": body.length,
      Connection: "close",
    });
    res.end(body);
  } else {
    res.writeHead(404);
    res.end();
  }
});
const timeout = setTimeout(() => {
  console.error("Electron network regression test timed out");
  app.exit(2);
}, 15000);

app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const { electronNetFetch } = require("../src/modules/electronNetFetch");
    const torrServerManager = require("../src/modules/torrServerManager");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("Node.js global fetch must not be used in main process");
    };
    try {
      assert.equal(await torrServerManager.getVersion(port), "142.2");
      const gst = await torrServerManager.checkGstSupport(port);
      assert.equal(gst.supported, true);
      assert.equal(gst.gstreamerVersion, "1.0");

      const response = await electronNetFetch(`http://127.0.0.1:${port}/large`);
      assert.equal(response.status, 200);
      // The socket closes while its response body is still unread.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await response.body?.cancel();

      // JSON uploads/downloads used by cloud settings must also avoid Undici.
      const uploaded = await electronNetFetch(
        `http://127.0.0.1:${port}/upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: "encrypted-payload" }),
        },
      );
      assert.deepEqual(await uploaded.json(), { data: "encrypted-payload" });

      // Confirm subsequent requests still work after that FIN.
      const echo = await electronNetFetch(`http://127.0.0.1:${port}/echo`);
      assert.equal(await echo.text(), "MatriX.142.2");
      console.log(
        "PASS: TorrServer checks and delayed large HTTP response use Electron net.fetch without Node Undici",
      );
    } finally {
      globalThis.fetch = originalFetch;
      clearTimeout(timeout);
      server.close();
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    server.close();
    app.exit(1);
  });
