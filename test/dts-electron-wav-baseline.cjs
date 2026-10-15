// Separate WAV control: determine whether the GitHub Windows runner exposes decoded sound to Web Audio.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const out = path.resolve(__dirname, "../.cache/dts-windows-test");
const mediaName = process.env.MEDIA_FIXTURE || "reference.wav";
const wav = fs.readFileSync(path.join(out, mediaName));
const reportName = mediaName.endsWith(".wav") ? "electron-wav-baseline" : "electron-ac3-stereo";
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const profile = path.join(out, "wav-profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
const server = http.createServer((req,res) => {
  if(req.url === "/" + mediaName) {
    res.writeHead(200, {"Content-Type":mediaName.endsWith(".wav") ? "audio/wav" : "video/x-matroska","Content-Length":wav.length,"Accept-Ranges":"bytes"});
    res.end(wav);
  } else {
    res.writeHead(200,{"Content-Type":"text/html"});
    const tag = mediaName.endsWith(".wav") ? "audio" : "video";
    res.end('<!doctype html><' + tag + ' id="a" src="/' + mediaName + '" preload="auto"></' + tag + '>');
  }
});
const watchdog = setTimeout(() => {console.error("WAV control timed out");app.exit(3);}, 15000);
let window;
app.whenReady().then(async () => {
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  window = new BrowserWindow({show:false,width:640,height:360,webPreferences:{backgroundThrottling:false,sandbox:false}});
  await window.loadURL("http://127.0.0.1:" + server.address().port);
  console.log("Electron baseline opened:",mediaName);
  const result = await window.webContents.executeJavaScript(`(async()=>{
    const audio=document.getElementById("a");
    const ctx=new AudioContext();
    const src=ctx.createMediaElementSource(audio);
    const analyser=ctx.createAnalyser();
    analyser.fftSize=2048;
    src.connect(analyser);analyser.connect(ctx.destination);
    await ctx.resume();await audio.play();
    const t=performance.now();let maxRms=0;
    while(performance.now()-t<1750) {
      await new Promise(r=>setTimeout(r,70));
      const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
      let sum=0;for(const v of values)sum+=v*v;
      maxRms=Math.max(maxRms,Math.sqrt(sum/values.length));
    }
    return {maxRms,time:audio.currentTime,duration:audio.duration,readyState:audio.readyState,contextState:ctx.state,error:audio.error?.message||null};
  })()`);
  console.log("Electron baseline result:",mediaName,JSON.stringify(result));
  fs.writeFileSync(path.join(out,reportName+".json"),JSON.stringify(result,null,2));
  assert.equal(result.error,null);
  assert(result.time>0.5,"WAV baseline did not advance");
  if(result.maxRms===0 && mediaName.endsWith(".wav")) console.log("INCONCLUSIVE: baseline WAV has no decoded audio");
  else if(result.maxRms===0) throw new Error("AC3 2.0 failed: audio frames are silent despite earlier WAV reference signal");
  else console.log("PASS: nonzero decoded audio for",mediaName);
  clearTimeout(watchdog);server.close();app.exit(0);
}).catch(error=>{
  console.error("WAV control error:",String(error?.stack||error));
  fs.writeFileSync(path.join(out,reportName+"-error.txt"),String(error?.stack||error));
  clearTimeout(watchdog);server.close();app.exit(1);
});
