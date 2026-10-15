// Live TorrServer DTS stream diagnostic. The URL is injected as a GitHub Actions
// secret (LIVE_DTS_URL); never commit it to the repository or print it in logs.
// Performs only a short range read, stream metadata probe and 1-second audio decode.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const root = path.resolve(__dirname, "..");
const out = path.join(root, ".cache", "dts-windows-test");
const ffmpeg = path.join(root, ".cache", "subtitle-tools", "ffmpeg.exe");
const ffprobe = path.join(root, ".cache", "subtitle-tools", "ffprobe.exe");
const url = process.env.LIVE_DTS_URL;
if (!url || !/^https?:\/\//.test(url)) {
  console.log("SKIP: no LIVE_DTS_URL configured in GitHub Actions secrets");
  process.exit(0);
}
const parsed = new URL(url);
const sanitize = text => String(text || "").split(url).join("[STREAM URL]")
  .split(parsed.origin).join("[SERVER]")
  .replace(/(?:https?:\/\/[^\s"']+\?link=)[^\s"']+/gi, "[STREAM URL]");
const result = { test:"user supplied real TorrServer MKV", streamUrl:"[REDACTED]", checkedAt:new Date().toISOString(), checks:[], audio:[] };
fs.mkdirSync(out, {recursive:true});
const processTool=(bin,args,maxMs=90000)=>{
  const r=spawnSync(bin,args,{encoding:"utf8",windowsHide:true,timeout:maxMs,maxBuffer:2*1024*1024});
  if(r.error || r.status!==0) throw Error(sanitize(r.error?.message || r.stderr || "exit status "+r.status).slice(-2000));
  return r.stdout;
};
async function fetchHeader() {
  return new Promise((resolve,reject)=>{
    const module=parsed.protocol==="https:"?https:http;
    const req=module.get(url,{headers:{"Range":"bytes=0-65535","Accept-Encoding":"identity"},timeout:16000},res=>{
      const chunks=[];let total=0;let finished=false;
      const finish=(error)=>{
        if(finished)return;
        finished=true;
        res.destroy();req.destroy();
        if(error)reject(error);else resolve({status:res.statusCode,contentRange:res.headers["content-range"]||null,contentType:res.headers["content-type"]||null,bytes:total,firstBytes:Buffer.concat(chunks).subarray(0,4).toString("hex")});
      };
      res.on("data",chunk=>{
        if(total>=65536)return;
        const piece=chunk.subarray(0,65536-total);
        chunks.push(piece);total+=piece.length;
        if(total===65536) finish();
      });
      res.on("end",()=>finish());
      res.on("error",err=>finish(err));
    });
    req.on("timeout",()=>req.destroy(Error("Range request timed out")));
    req.on("error",err=>reject(Error(sanitize(err.message))));
  });
}
async function main() {
  try {
    const range = await fetchHeader();
    assert([200,206].includes(range.status),"HTTP status "+range.status);
    assert(range.bytes > 8, "Empty stream response");
    assert.equal(range.firstBytes,"1a45dfa3","Not a Matroska EBML header");
    result.checks.push({name:"HTTP Matroska header",status:"PASS",...range});
    console.log("PASS TorrServer HTTP",range.status,"range",range.contentRange?"supported":"not confirmed","MKV header",range.firstBytes);
    const text=processTool(ffprobe,["-v","error","-rw_timeout","15000000","-probesize","5000000","-analyzeduration","3000000","-show_entries","stream=index,codec_type,codec_name,channels,channel_layout:stream_tags=language,title","-of","json",url],90000);
    const streams=JSON.parse(text).streams || [];
    result.audio=streams.filter(s=>s.codec_type==="audio").map(s=>({index:s.index,codec:s.codec_name,channels:s.channels,channel_layout:s.channel_layout,language:s.tags?.language||"",title:s.tags?.title||""}));
    result.checks.push({name:"Track discovery",status:"PASS",audioTrackCount:result.audio.length});
    console.log("Audio tracks:",JSON.stringify(result.audio));
    const dts=result.audio.filter(s=>s.codec==="dts");
    assert(dts.length>0,"No DTS audio tracks in the supplied MKV");
    for(const track of dts.slice(0,2)) {
      const began=Date.now();
      processTool(ffmpeg,["-nostdin","-hide_banner","-loglevel","error","-rw_timeout","15000000","-ss","30","-i",url,"-map","0:"+track.index,"-t","1","-vn","-sn","-dn","-c:a","ac3","-b:a","448k","-f","null","NUL"],90000);
      result.checks.push({name:"DTS to AC3 stream "+track.index+" at 30 seconds",status:"PASS",elapsedMs:Date.now()-began});
      console.log("PASS DTS track",track.index,"-> AC3 in",Date.now()-began,"ms");
    }
  } catch(error) {
    result.checks.push({name:"Real stream check",status:"FAIL",error:sanitize(error.stack||error.message)});
    console.error("FAIL:",sanitize(error.message));
    process.exitCode=1;
  } finally {
    fs.writeFileSync(path.join(out,"real-torrserver-dts.json"),JSON.stringify(result,null,2));
  }
}
main();
