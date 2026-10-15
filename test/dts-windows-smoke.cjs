// Windows smoke tests for the exact ffmpeg.exe/ffprobe.exe shipped with Lampa Desktop.
// Generates synthetic DTS locally. Does not require real media, torrent accounts or paid APIs.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = path.join(root, ".cache", "dts-windows-test");
const ffmpeg = path.join(root, ".cache", "subtitle-tools", "ffmpeg.exe");
const ffprobe = path.join(root, ".cache", "subtitle-tools", "ffprobe.exe");
fs.mkdirSync(out, { recursive: true });
const result = { platform: process.platform, ffmpeg, checks: [], limitations: ["DTS-ES 6.1 requires an independently verified DTS-ES test sample", "HLS output inspection does not establish playback in Lampa or Chromium"] };
function run(bin, args, timeout = 45000) {
  const p = spawnSync(bin, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 });
  if (p.error || p.status !== 0) throw new Error((p.error?.message || p.stderr || p.stdout || "exit " + p.status).slice(-1800) + "\nCOMMAND: " + path.basename(bin) + " " + args.join(" "));
  return p.stdout;
}
function check(name, fn) {
  try { const detail = fn(); result.checks.push({ name, status: "PASS", ...(detail ? { detail } : {}) }); console.log("PASS " + name + (detail ? " — " + detail : "")); }
  catch (error) { result.checks.push({ name, status: "FAIL", error: String(error?.stack || error) }); console.error("FAIL " + name + ": " + error.message); }
}
function file(name) { return path.join(out, name); }
function ff(args) { return run(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args]); }
function probe(name) { return JSON.parse(run(ffprobe, ["-v", "error", "-show_entries", "stream=index,codec_name,codec_type,channels,channel_layout", "-of", "json", name])).streams; }
const surround = file("surround51.dts"), stereo = file("stereo.dts");
const input = file("multi-dts.mkv"), output51 = file("converted51.mkv"), output20 = file("converted20.mkv");
try {
  check("Windows packaged ffmpeg.exe, ffprobe.exe exist", () => { assert(fs.existsSync(ffmpeg)); assert(fs.existsSync(ffprobe)); });
  check("Packaged FFmpeg includes DTS (dca) decoder and AC3 encoder", () => {
    assert.match(run(ffmpeg, ["-hide_banner", "-decoders"]), /\bdca\b/);
    assert.match(run(ffmpeg, ["-hide_banner", "-encoders"]), /\bac3\b/);
  });
  check("Packaged FFmpeg includes synthetic DTS test encoder", () => { assert.match(run(ffmpeg, ["-hide_banner", "-encoders"]), /\bdca\b/); });
  check("Generate genuine six-channel DTS 5.1 bitstream", () => {
    ff(["-f","lavfi","-i","aevalsrc=0|0|sin(2*PI*500*t)|0|0|0:s=48000:d=4:channel_layout=5.1","-c:a","dca","-strict","-2","-b:a","768k","-f","dts",surround]);
    const streams = probe(surround); assert(streams.some(s => s.codec_name === "dts" && s.channels === 6)); return "DTS channels = 6";
  });
  check("Generate DTS stereo", () => {
    ff(["-f","lavfi","-i","aevalsrc=sin(2*PI*400*t)|sin(2*PI*800*t):s=48000:d=4:channel_layout=stereo","-c:a","dca","-strict","-2","-b:a","384k","-f","dts",stereo]);
    assert(probe(stereo).some(s => s.codec_name === "dts" && s.channels === 2));
  });
  check("Decode DTS 5.1 to PCM", () => { ff(["-i",surround,"-map","0:a:0","-c:a","pcm_s16le","-f","null","-"]); });
  check("Decode DTS 2.0 to PCM", () => { ff(["-i",stereo,"-map","0:a:0","-c:a","pcm_s16le","-f","null","-"]); });
  check("Generate baseline WAV to discriminate codec failure from CI audio device failure", () => { ff(["-i",stereo,"-map","0:a:0","-c:a","pcm_s16le",file("reference.wav")]); });
  check("Create Matroska with video plus two DTS audio tracks", () => {
    ff(["-f","lavfi","-i","testsrc2=size=320x180:rate=12:duration=4","-i",surround,"-i",stereo,"-map","0:v:0","-map","1:a:0","-map","2:a:0","-c:v","libvpx","-deadline","realtime","-cpu-used","8","-b:v","200k","-c:a","copy","-shortest",input]);
    const streams = probe(input), audio = streams.filter(s => s.codec_type === "audio");
    assert.equal(audio.length, 2); assert.deepEqual(audio.map(s => s.channels), [6, 2]); return "2 switchable audio tracks";
  });
  check("Audio-only DTS 5.1 -> AC3 5.1, keep video unchanged", () => {
    const start = performance.now();
    ff(["-i",input,"-map","0:v:0","-map","0:a:0","-c:v","copy","-c:a","ac3","-b:a","640k",output51]);
    const streams = probe(output51);
    assert(streams.some(s => s.codec_type === "video" && s.codec_name === "vp8"));
    assert(streams.some(s => s.codec_name === "ac3" && s.channels === 6));
    const ms = Math.round(performance.now() - start); result.conversionMs = ms;
    return "4 s fixture processing time " + ms + " ms (not playback startup latency)";
  });
  check("Switch second DTS track and output AC3 stereo", () => {
    ff(["-i",input,"-map","0:v:0","-map","0:a:1","-c:v","copy","-c:a","ac3","-b:a","192k",output20]);
    assert(probe(output20).some(s => s.codec_name === "ac3" && s.channels === 2));
  });
  check("Confirm video bitstream is bit-for-bit preserved", () => {
    const hash = filename => run(ffmpeg, ["-hide_banner","-loglevel","error","-i",filename,"-map","0:v:0","-c","copy","-f","streamhash","-hash","SHA256","-"]).trim();
    assert.equal(hash(input), hash(output51)); assert.equal(hash(input), hash(output20));
  });
  check("Seek 2 seconds into MKV and decode DTS without errors", () => {
    ff(["-ss","2","-i",input,"-t","1","-map","0:a:0","-f","null","-"]);
  });
  check("Create HLS playlist containing compatible AC3 audio", () => {
    const playlist = file("audio.m3u8");
    ff(["-i",output51,"-map","0:a:0","-c:a","copy","-f","hls","-hls_time","1","-hls_list_size","0","-hls_segment_filename",file("segment-%03d.ts"),playlist]);
    assert.match(fs.readFileSync(playlist,"utf8"), /#EXTM3U/);
    assert(probe(playlist).some(s => s.codec_name === "ac3" && s.channels === 6));
    return "FFmpeg/ffprobe playlist validated; Lampa playback not tested";
  });
} finally {
  result.pass = result.checks.filter(x => x.status === "PASS").length;
  result.fail = result.checks.filter(x => x.status === "FAIL").length;
  fs.writeFileSync(file("result.json"), JSON.stringify(result, null, 2));
  console.log("DTS Windows result:", JSON.stringify({ pass: result.pass, fail: result.fail, conversionMs: result.conversionMs }));
}
if (result.fail) process.exitCode = 1;
