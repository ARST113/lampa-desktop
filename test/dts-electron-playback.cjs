// Direct playback smoke test against the pinned custom Electron runtime.
// Tests a 4-second synthetic AC3 5.1 Matroska converted from DTS 5.1.
// A positive WebAudio signal is evidence that Chromium is actually decoding audio.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".cache", "dts-windows-test");
const media = fs.readFileSync(path.join(output, "converted51.mkv"));
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-background-timer-throttling");
fs.mkdirSync(path.join(output, "electron-profile"), { recursive: true });
app.setPath("userData", path.join(output, "electron-profile"));
const server = http.createServer((req, res) => {
  if (req.url !== "/converted51.mkv") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<!doctype html><html><body><video id="v" preload="auto" src="/converted51.mkv"></video></body></html>');
    return;
  }
  const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  let start = match ? Number(match[1]) : 0;
  let end = match && match[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1;
  if (start >= media.length || end < start) { res.writeHead(416); res.end(); return; }
  res.writeHead(match ? 206 : 200, {
    "Content-Type": "video/x-matroska",
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    ...(match ? { "Content-Range": "bytes " + start + "-" + end + "/" + media.length } : {}),
  });
  res.end(media.subarray(start, end + 1));
});
let window;
const timeout = setTimeout(() => { console.error("FAIL Electron playback timed out"); app.exit(2); }, 30000);
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  window = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: { backgroundThrottling: false, sandbox: false } });
  await window.loadURL("http://127.0.0.1:" + server.address().port);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const video=document.getElementById("v");
    const context=new AudioContext();
    const source=context.createMediaElementSource(video);
    const analyser=context.createAnalyser();
    analyser.fftSize=2048;
    source.connect(analyser);analyser.connect(context.destination);
    await context.resume();
    await video.play();
    let maxRms=0;
    const started=performance.now();
    while(performance.now()-started<2500) {
      await new Promise(r=>setTimeout(r,80));
      const values=new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      let power=0;for(const v of values)power+=v*v;
      maxRms=Math.max(maxRms,Math.sqrt(power/values.length));
    }
    return { time:video.currentTime, duration:video.duration, readyState:video.readyState, error:video.error?.message||null, audioContextState:context.state, maxRms };
  })()`);
  fs.writeFileSync(path.join(output, "electron-playback.json"), JSON.stringify(result, null, 2));
  console.log("Electron playback:", JSON.stringify(result));
  assert.equal(result.error, null, "Media element has an error");
  assert(result.time > 0.5, "The video did not advance");
  assert(result.maxRms > 0.001, "No decoded audio samples in Web Audio; possible unsupported AC3 or runner has no sound backend");
  console.log("PASS: pinned Electron played DTS-to-AC3 MKV with nonzero decoded audio");
  clearTimeout(timeout);
  server.close();
  app.exit(0);
}).catch(error => {
  console.error("FAIL: ", error?.stack || error);
  fs.writeFileSync(path.join(output, "electron-playback-error.txt"), String(error?.stack || error));
  clearTimeout(timeout);
  server.close();
  app.exit(1);
});
