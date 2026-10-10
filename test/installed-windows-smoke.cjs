// Launch the actual installed Lampa.exe with an isolated profile and inspect
// the visible document through the Chromium DevTools Protocol.
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

if (process.platform !== "win32") {
  console.error("This smoke test must run on the Windows runner.");
  process.exit(1);
}

const executable = process.argv[2];
assert.ok(executable && fs.existsSync(executable), "Installed Lampa.exe not found.");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lampa-installed-smoke-"));
const roaming = path.join(scratch, "Roaming");
const local = path.join(scratch, "Local");
const userData = path.join(roaming, "Lampa");
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(local, { recursive: true });

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(
    '<!doctype html><html><head><title>Lampa installer smoke</title></head>' +
      '<body><main id="smoke-ready">Windows installer works</main></body></html>',
  );
});

function listen(port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const port = listener.address().port;
      listener.close(() => resolve(port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getPage(debugPort, address, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Installed Lampa.exe terminated early: ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
        signal: AbortSignal.timeout(1200),
      });
      if (response.ok) {
        const pages = await response.json();
        const tab = pages.find(
          (page) =>
            page.type === "page" &&
            page.url.startsWith(address) &&
            page.webSocketDebuggerUrl,
        );
        if (tab) return tab;
      }
    } catch {
      // The debug endpoint may not be ready until after Chromium starts.
    }
    await delay(150);
  }
  throw new Error("Installed EXE did not open the configured HTTP site.");
}

function evaluate(tab, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    const watchdog = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out evaluating installed renderer document."));
    }, 6000);

    function finish(error, value) {
      clearTimeout(watchdog);
      socket.close();
      if (error) reject(error);
      else resolve(value);
    }

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails) {
          finish(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
          return;
        }
        finish(null, message.result?.result?.value);
      } catch (error) {
        finish(error);
      }
    });
    socket.addEventListener("error", () => {
      finish(new Error("Chromium debugging WebSocket connection failed."));
    });
  });
}

async function main() {
  let child;
  try {
    await listen(0);
    const address = `http://127.0.0.1:${server.address().port}/`;
    const debugPort = await reservePort();

    fs.writeFileSync(
      path.join(userData, "config.json"),
      JSON.stringify({
        lampaUrl: address,
        webSecurity: true,
        autoUpdate: false,
        tsAutoStart: false,
      }),
    );

    const environment = { ...process.env, APPDATA: roaming, LOCALAPPDATA: local };
    delete environment.PORTABLE_EXECUTABLE_DIR;
    delete environment.ELECTRON_RUN_AS_NODE;

    child = spawn(
      executable,
      [
        `--remote-debugging-port=${debugPort}`,
        "--remote-allow-origins=*",
      ],
      {
        env: environment,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    child.stdout.on("data", (data) => {
      output += String(data).slice(0, 1024);
    });
    child.stderr.on("data", (data) => {
      output += String(data).slice(0, 1024);
    });

    let tab;
    try {
      tab = await getPage(debugPort, address, child);
    } catch (error) {
      throw new Error(`${error.message}\nApplication logs: ${output.slice(-3500)}`);
    }

    const content = await evaluate(
      tab,
      "document.querySelector('#smoke-ready')?.textContent || null",
    );
    assert.equal(content, "Windows installer works");
    assert.equal(
      fs.existsSync(path.join(path.dirname(executable), "portable.flag")),
      false,
      "Installed EXE must not contain obsolete ZIP marker.",
    );
    // Installed builds must not use the portable-only LampaData location.
    assert.equal(
      fs.existsSync(path.join(path.dirname(executable), "LampaData")),
      false,
      "Installer unexpectedly created portable data beside Lampa.exe.",
    );
    console.log(
      "PASS: NSIS-installed Lampa.exe launched and rendered configured HTTP content.",
    );
  } finally {
    if (child?.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 7000,
      });
    }
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 4 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
