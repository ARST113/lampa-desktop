// Smoke-test a genuine packaged Electron window through Chromium DevTools Protocol.
// Runs only in GitHub Actions. No application source is modified for test URLs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const executable = path.resolve(process.argv[2] || "dist/win-unpacked/Lampa.exe");
const packageDir = path.dirname(executable);
const marker = path.join(packageDir, "portable.flag");
const dataDir = path.join(packageDir, "LampaData");
const config = path.join(dataDir, "config.json");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`DevTools HTTP ${response.status}`);
  return (await response.json()).filter((x) => x.type === "page");
}

async function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("CDP Runtime.evaluate timeout"));
    }, 10000);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: false },
        }),
      );
    });
    ws.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.id !== 1) return;
      clearTimeout(timeout);
      ws.close();
      if (data.error || data.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(data.error || data.result.exceptionDetails)));
      } else {
        resolve(data.result?.result?.value);
      }
    });
    ws.addEventListener("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function probe(port, desiredOrigin, seconds = 22) {
  const expression = `JSON.stringify({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    lampaReady: !!window.Lampa,
    bodyText: document.body?.innerText?.slice(0, 180) || "",
    bodyChildren: document.body?.children?.length || 0,
    bodyBackground: document.body ? getComputedStyle(document.body).backgroundColor : "",
    documentBackground: getComputedStyle(document.documentElement).backgroundColor
  })`;
  let last = null;
  for (let i = 0; i < seconds; i++) {
    try {
      const pages = await getTargets(port);
      const target = pages.find((x) => x.url.startsWith(desiredOrigin)) || pages[0];
      if (target) {
        const raw = await evaluate(target, expression);
        if (raw) {
          last = JSON.parse(raw);
          if (last.readyState === "complete" && last.url.startsWith(desiredOrigin)) {
            if (desiredOrigin.includes("127.0.0.1") || last.lampaReady) break;
          }
        }
      }
    } catch (error) {
      last = { probeError: String(error) };
    }
    await wait(1000);
  }
  return last;
}

function stopTree(child) {
  if (!child?.pid) return;
  try {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 15000,
    });
  } catch {
    child.kill();
  }
}

async function runApp({ url, port, origin, required }) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({ lampaUrl: url, autoUpdate: false, tsAutoStart: false }, null, 2),
  );
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    cwd: packageDir,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      // Avoid existing Chrome debugging variables from the runner.
    },
  });
  const stderr = [];
  child.stderr.on("data", (data) => stderr.push(String(data).slice(0, 5000)));
  child.stdout.on("data", (data) => stderr.push(String(data).slice(0, 5000)));
  let result;
  try {
    result = await probe(port, origin, required ? 20 : 35);
    console.log(JSON.stringify({ url, result, logs: stderr.join("").slice(-3500) }));
    if (required) {
      assert.ok(result, "Packaged Electron didn't expose a page");
      assert.equal(result.url, url, "Lampa window loaded an unexpected URL");
      assert.equal(result.readyState, "complete", "Lampa fixture did not load");
      assert.match(result.bodyText, /Portable window smoke test/);
      assert.ok(fs.existsSync(path.join(dataDir, "Session")));
    }
  } finally {
    stopTree(child);
    await wait(1200);
  }
  return result;
}

async function main() {
  if (!fs.existsSync(executable)) throw new Error(`Missing ${executable}`);
  const fixture = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><html><head><title>Lampa test</title></head>" +
        "<body style='background:#111;color:white'><main>Portable window smoke test</main></body></html>",
    );
  });
  fixture.listen(0, "127.0.0.1");
  await new Promise((resolve) => fixture.once("listening", resolve));
  fs.writeFileSync(marker, "portable");
  const address = fixture.address();
  const fixtureUrl = `http://127.0.0.1:${address.port}/`;
  try {
    await runApp({ url: fixtureUrl, port: 9444, origin: fixtureUrl, required: true });
    // Real-site diagnostics: log failures without failing the deterministic fixture test.
    await runApp({
      url: "http://lampa.mx",
      port: 9445,
      origin: "http://lampa.mx",
      required: false,
    });
    await runApp({
      url: "https://cf.lampa.mx",
      port: 9446,
      origin: "https://cf.lampa.mx",
      required: false,
    });
    await runApp({
      url: "https://lampac.fun/",
      port: 9447,
      origin: "https://lampac.fun/",
      required: false,
    });
    await runApp({
      url: "http://lampac.fun/",
      port: 9448,
      origin: "https://lampac.fun/",
      required: false,
    });
  } finally {
    fixture.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(marker, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
