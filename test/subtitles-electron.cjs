const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".cache/subtitle-test");
app.setPath("userData", path.join(output, "profile"));
app.getAppPath = () => root;
let window;
let requests = 0;
const media = fs.readFileSync(path.join(output, "fixture.mkv"));
const server = http.createServer((req, res) => {
  if (req.url !== "/fixture.mkv") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      '<!doctype html><style>html,body{margin:0;background:#303030;overflow:hidden}video{width:100vw;height:100vh}video::cue{font-size:24px}</style><video muted src="/fixture.mkv"></video>',
    );
    return;
  }
  requests++;
  const match = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2]
    ? Math.min(Number(match[2]), media.length - 1)
    : media.length - 1;
  res.writeHead(match ? 206 : 200, {
    "Content-Type": "video/x-matroska",
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    ...(match
      ? { "Content-Range": `bytes ${start}-${end}/${media.length}` }
      : {}),
  });
  res.end(media.subarray(start, end + 1));
});
const timeout = setTimeout(() => {
  console.error("Subtitle integration test timed out");
  app.exit(2);
}, 60000);
app
  .whenReady()
  .then(async () => {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    require("../src/modules/ipcHandlers/subtitleHandlers")(() => window);
    window = new BrowserWindow({
      show: false,
      width: 640,
      height: 360,
      webPreferences: {
        preload: path.join(root, "src/preload.js"),
        sandbox: false,
        contextIsolation: true,
        enableBlinkFeatures: "AudioVideoTracks",
        backgroundThrottling: false,
      },
    });
    await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await window.webContents.executeJavaScript(
      `new Promise(resolve=>{const v=document.querySelector('video');if(v.readyState>=1)resolve();else v.onloadedmetadata=resolve;})`,
    );
    const before = await window.webContents.executeJavaScript(
      'document.querySelector("video").textTracks.length',
    );
    assert.equal(
      before,
      0,
      "Chromium must reproduce the missing in-container subtitle tracks",
    );
    await window.webContents.executeJavaScript(
      `window.messages=[];window.menu=[];const bus=()=>({listeners:{},follow(n,f){(this.listeners[n]||=[]).push(f)},send(n,d){for(const f of this.listeners[n]||[])f(d)}});window.Lampa={Player:{listener:bus()},PlayerVideo:{listener:bus(),video:()=>document.querySelector('video')},Noty:{show:m=>messages.push(m)}};Lampa.PlayerVideo.listener.follow('subs',d=>window.menu=d.subs);`,
    );
    await window.webContents.executeJavaScript(
      fs.readFileSync(path.join(root, "src/subtitleBridge.js"), "utf8"),
    );
    const result = await window.webContents.executeJavaScript(`(async()=>{
    const v=document.querySelector('video');
    const until=async fn=>{const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('Timed out: '+messages.join('; '));await new Promise(r=>setTimeout(r,50));}};
    const seek=async time=>{v.currentTime=time;await until(()=>!v.seeking);};
    const active=()=>Array.from(v.textTracks).flatMap(t=>t.mode==='showing'?Array.from(t.activeCues||[],c=>c.text):[]);
    Lampa.Player.listener.send('ready',{torrent_hash:'test',ffprobe:[{index:2,codec_type:'subtitle',codec_name:'subrip',tags:{language:'rus',title:'Russian'}},{index:3,codec_type:'subtitle',codec_name:'ass',tags:{language:'eng',title:'English'}}]});
    if(menu.length!==2)throw Error('Subtitle menu did not receive both tracks');
    await seek(2);menu[0].mode='showing';await until(()=>active().some(t=>t.includes('первая')));
    const russian=active();
    await seek(83);await until(()=>active().some(t=>t.includes('границе')));
    await seek(95);await until(()=>active().some(t=>t.includes('границе')));
    if(active().length!==1)throw Error('Overlapping extraction windows duplicated a cue');
    await seek(172);await until(()=>active().some(t=>t.includes('Финальная')));
    const seekForward=active();
    menu.forEach(t=>t.mode='disabled');menu[1].mode='showing';await until(()=>active().some(t=>t.includes('Final')));
    const english=active();
    await seek(12);await until(()=>active().some(t=>t.includes('Second')));
    const seekBackward=active();
    window.integrationResult={russian,seekForward,english,seekBackward,messages};return window.integrationResult;
  })()`);
    await window.webContents.executeJavaScript(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    fs.writeFileSync(
      path.join(output, "subtitles-visible.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const cleanup = await window.webContents.executeJavaScript(
      `menu.forEach(t=>t.mode='disabled');const hidden=Array.from(document.querySelector('video').textTracks).every(t=>t.mode==='disabled');Lampa.Player.listener.send('destroy',{});({hidden,remaining:document.querySelector('video').textTracks.length})`,
    );
    assert.equal(cleanup.hidden, true);
    assert.equal(cleanup.remaining, 0);
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify({ before, ...result, cleanup, requests }, null, 2),
    );
    console.log(
      "PASS: SRT and ASS rendering, language switching, forward/backward seeking, disabling and cleanup.",
    );
    clearTimeout(timeout);
    server.close();
    app.exit(0);
  })
  .catch((error) => {
    fs.writeFileSync(
      path.join(output, "error.txt"),
      String(error.stack || error),
    );
    console.error(error);
    app.exit(1);
  });
