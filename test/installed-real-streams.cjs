// Windows E2E. Launch an INSTALLED release of Lampa.exe, on the real lampa.mx
// frontend. The URLs are handed to Lampa.Player.play, not to a substitute page.
// A hosted runner may lack hardware HEVC/HDR and an AC3 output device.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

if (process.platform !== "win32") throw Error("Windows only");
const exe = process.env.LAMPATEST_EXECUTABLE;
assert.ok(exe && fs.existsSync(exe), "Installed Lampa.exe is missing");
const root = path.resolve(".cache", "installed-real-playback");
fs.mkdirSync(root, { recursive: true });
const configDir = path.join(process.env.APPDATA, "Lampa");
fs.mkdirSync(configDir, { recursive: true });
const configFile = path.join(configDir, "config.json");
const prior = fs.existsSync(configFile) ? fs.readFileSync(configFile) : null;
const targets = [
  { name: "Mutiny HDR Master5", url: process.env.LIVE_MUTINY_MASTER5 },
  { name: "Mutiny HDR AC3", url: process.env.LIVE_MUTINY_AC3 },
];
const report = { installed: path.basename(exe), started: new Date().toISOString(),
  mode: "NSIS-installed Lampa.exe and actual Lampa.Player.play()", streams: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));
function save() { fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2)); }
function redact(s) { return String(s || "").replace(/(\?link=)[^\s&]+/gi, "$1[redacted]"); }
async function freePort() {
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  await new Promise(r => srv.close(r));
  return port;
}
async function cdp(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let done = false;
    const timer = setTimeout(() => finish(Error("CDP timeout: " + method)), 6500);
    function finish(err, data) {
      if (done) return; done = true; clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) reject(err); else resolve(data);
    }
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener("error", () => finish(Error("CDP socket error")));
    ws.addEventListener("message", event => {
      let packet;
      try { packet = JSON.parse(event.data); } catch (err) { return finish(err); }
      if (packet.id !== 1) return;
      if (packet.error) return finish(Error(JSON.stringify(packet.error)));
      finish(null, packet.result);
    });
  });
}
async function activeTab(port) {
  const response = await fetch("http://127.0.0.1:" + port + "/json/list",
    { signal: AbortSignal.timeout(1400) });
  const list = await response.json();
  return list.find(t => t.type === "page" && t.webSocketDebuggerUrl &&
    /^https?:\/\/(?:lampa\.mx|cf\.lampa\.mx)\//.test(t.url));
}
async function evaluate(tab, expression) {
  const r = await cdp(tab.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (r.exceptionDetails) throw Error("Renderer JavaScript error: " + r.exceptionDetails.text);
  return r.result?.value;
}
const getState = [
  "(() => {",
  "const raw = window.Lampa?.PlayerVideo?.video?.();",
  "const v = raw?.jquery ? raw[0] : raw?.tagName === 'VIDEO' ? raw : document.querySelector('video');",
  "const q = v?.getVideoPlaybackQuality?.();",
  "return {lampa:!!window.Lampa, playerApi:typeof window.Lampa?.Player?.play,",
  "shell:!!document.querySelector('#app .head'),languageChoice:!!document.querySelector('body > .lang .lang__selector-item[data-code]'),",
  "url:location.href,bodyLength:document.body?.innerText?.length || 0,video:!!v,count:document.querySelectorAll('video').length,",
  "readyState:v?.readyState ?? null,networkState:v?.networkState ?? null,",
  "src:(v?.currentSrc || v?.src || '').split('?')[0],",
  "error:v?.error ? {code:v.error.code,message:v.error.message} : null,",
  "currentTime:v?.currentTime ?? null, duration:Number.isFinite(v?.duration)?v.duration:null,",
  "paused:v?.paused ?? null, width:v?.videoWidth ?? null,height:v?.videoHeight ?? null,",
  "frames:q?.totalVideoFrames ?? v?.webkitDecodedFrameCount ?? null,",
  "dropped:q?.droppedVideoFrames ?? null,",
  "audioTracks:v?.audioTracks ? Array.from(v.audioTracks,x=>({label:x.label,language:x.language,enabled:x.enabled})) : [],",
  "canPlayAc3:v?.canPlayType?.('audio/mp4; codecs=\"ac-3\"') || '',",
  "canPlayEac3:v?.canPlayType?.('audio/mp4; codecs=\"ec-3\"') || '',",
  "text:(document.body?.innerText || '').slice(-160)};",
  "})()",
].join("\n");
async function shot(tab, name) {
  try {
    const r = await cdp(tab.webSocketDebuggerUrl, "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false });
    if (r.data) fs.writeFileSync(path.join(root, name + ".png"), Buffer.from(r.data, "base64"));
  } catch (err) { console.log("Screenshot failed:", err.message); }
}
function endProcess(p) {
  if (p?.pid) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"],
    { windowsHide: true, timeout: 12000 });
}
async function scenario(target, index) {
  const result = { name: target.name, outcome: "not-started", samples: [] };
  fs.writeFileSync(configFile, JSON.stringify({
    lampaUrl: "http://lampa.mx/", webSecurity: true,
    autoUpdate: false, tsAutoStart: false,
  }));
  const port = await freePort();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  let processApp, tab, state, logs = "";
  try {
    processApp = spawn(exe, [
      "--remote-debugging-port=" + port, "--remote-allow-origins=*",
      "--autoplay-policy=no-user-gesture-required", "--window-size=1280,720",
    ], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [processApp.stdout, processApp.stderr])
      stream.on("data", b => { logs = (logs + b.toString()).slice(-13000); });
    const bootLimit = Date.now() + 65000;
    while (Date.now() < bootLimit) {
      if (processApp.exitCode !== null) throw Error("Installed EXE exited during startup");
      try {
        tab = await activeTab(port);
        if (tab) {
          state = await evaluate(tab, getState);
          if (state.playerApi === "function" && state.shell) break;
          if (state.languageChoice) {
            console.log("FIRST-LAUNCH-LANGUAGE", JSON.stringify({
              url: state.url, shell: state.shell, playerApi: state.playerApi,
            }));
            const selected = await evaluate(tab, [
              "(() => {const ru=document.querySelector('body > .lang .lang__selector-item[data-code=ru]');",
              "const any=document.querySelector('body > .lang .lang__selector-item[data-code]');",
              "const element=ru || any; if(element){element.click();return true;}return false;})()",
            ].join(""));
            if (selected) await delay(1200);
          }
        }
      } catch {}
      await delay(650);
    }
    result.boot = state;
    console.log("BOOT_DIAGNOSTICS", JSON.stringify({
      url: state?.url, shell: state?.shell, languageChoice: state?.languageChoice,
      playerApi: state?.playerApi, lampa: state?.lampa,
      bodyLength: state?.bodyLength, lastLog: redact(logs.slice(-1200)),
    }));
    if (!state?.shell || state.playerApi !== "function")
      throw Error("Live Lampa UI or native Player API did not initialize");

    const invocation = [
      "(() => {try {",
      "Lampa.Player.play({url:" + JSON.stringify(target.url) + ",",
      "title:" + JSON.stringify(target.name) + ",",
      "timeline:{hash:" + JSON.stringify("ci-installed-stream-" + index) + ",title:" + JSON.stringify(target.name) + "}});",
      "return {ok:true};}catch(e){return {ok:false,error:String(e?.stack || e)};}})()",
    ].join("");
    result.api = await evaluate(tab, invocation);
    if (!result.api?.ok) throw Error("Lampa.Player.play threw: " + result.api?.error);

    let metadata = false, progress = false, firstTime = null, last;
    const deadline = Date.now() + 48000;
    while (Date.now() < deadline) {
      if (processApp.exitCode !== null) throw Error("Installed Lampa.exe exited during playback");
      last = await evaluate(tab, getState);
      result.samples.push({ t: Date.now(), ...last, text: undefined });
      if (last.error) break;
      if (last.readyState >= 2 && last.width > 0 && last.height > 0) metadata = true;
      if (metadata && last.currentTime > 0.2 && firstTime === null) firstTime = last.currentTime;
      if (firstTime !== null && last.currentTime > firstTime + 0.9) {
        progress = true; break;
      }
      // Keep native Lampa.PlayerVideo; only request a user gesture to start it.
      if (last.video && last.paused) {
        await evaluate(tab, [
          "(() => {const raw=Lampa?.PlayerVideo?.video?.();",
          "const v=raw?.jquery?raw[0]:raw?.tagName==='VIDEO'?raw:document.querySelector('video');",
          "if(!v)return false;v.muted=true;v.play().catch(()=>{});return true;})()",
        ].join(""));
      }
      await delay(1200);
    }
    result.metadata = metadata;
    result.advanced = progress;
    result.last = last;
    if (metadata && Number.isFinite(last.duration) && last.duration > 80) {
      const seekTo = last.duration > 3800 ? 3700 : Math.floor(last.duration / 2);
      result.seekTarget = seekTo;
      await evaluate(tab, [
        "(() => {const raw=Lampa?.PlayerVideo?.video?.();",
        "const v=raw?.jquery?raw[0]:raw?.tagName==='VIDEO'?raw:document.querySelector('video');",
        "if(!v)return false;v.currentTime=" + seekTo + ";return true;})()",
      ].join(""));
      const seekEnd = Date.now() + 24000;
      while (Date.now() < seekEnd) {
        if (processApp.exitCode !== null) throw Error("Installed Lampa.exe crashed during seek");
        state = await evaluate(tab, getState);
        if (state.error) { result.seekError = state.error; break; }
        if (state.readyState >= 2 && Math.abs(state.currentTime - seekTo) < 4) {
          result.seekSuccess = true; break;
        }
        await delay(1100);
      }
    }
    await shot(tab, "installed-player-" + index);
    result.processAlive = processApp.exitCode === null;
    result.outcome = metadata && progress ? "video-progress-verified" :
      last?.error ? "media-error" : "no-video-progress";
    console.log("RESULT", result.name, result.outcome,
      "resolution", last?.width, "x", last?.height,
      "seek", !!result.seekSuccess, "alive", result.processAlive);
  } catch (e) {
    result.outcome = "error";
    result.error = redact(e.stack || e.message);
    console.error("ERROR", target.name, String(e.message || e));
    if (tab) await shot(tab, "installed-player-error-" + index);
  } finally {
    result.logTail = redact(logs.slice(-3500));
    report.streams.push(result); save();
    endProcess(processApp); await delay(700);
  }
}
async function main() {
  try {
    for (let i = 0; i < targets.length; i++) await scenario(targets[i], i + 1);
    const success = report.streams.length === 2 &&
      report.streams.every(s => s.outcome === "video-progress-verified" && s.processAlive);
    if (!success) process.exitCode = 1;
    console.log("Actual installed Lampa player E2E:", success ? "PASS" : "FAIL/PARTIAL");
  } finally {
    if (prior) fs.writeFileSync(configFile, prior);
    else fs.rmSync(configFile, { force: true });
    save();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; save(); });
