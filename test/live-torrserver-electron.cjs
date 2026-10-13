// Live regression test on the real TorrServer streams supplied for Mutiny (2026).
// Runs under the project's pinned Electron 44.4.4, not the host Node.js runtime.
// Limits downloads to short ranges; makes no claim about video rendering or audio output.
const { app } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { electronNetFetch } = require("../src/modules/electronNetFetch");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".cache", "live-torrserver");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));

const streams = [
  { label: "Mutiny 2160p HDR Master5", url: process.env.LIVE_MUTINY_MASTER5 },
  { label: "Mutiny 2160p HDR AC3", url: process.env.LIVE_MUTINY_AC3 },
];
const results = {
  runtime: "Electron " + process.versions.electron,
  node: process.versions.node,
  observedAt: new Date().toISOString(),
  limits: { maxBytesPerRequest: 512 * 1024, perRequestTimeoutMs: 25000 },
  streams: [],
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readRange(url, start, maxBytes, prematureClose = false) {
  const end = start + maxBytes - 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let response;
  let reader;
  try {
    response = await electronNetFetch(url, {
      method: "GET",
      headers: { Range: `bytes=${start}-${end}` },
      signal: controller.signal,
    });
    const status = response.status;
    const rangeHeader = response.headers.get("content-range");
    const type = response.headers.get("content-type");
    const rangeMatch = rangeHeader?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
    if (status !== 206 || !rangeMatch || Number(rangeMatch[1]) !== start) {
      throw Error(
        `Expected HTTP 206 and matching Content-Range, got HTTP ${status} range=${rangeHeader || "(none)"}`,
      );
    }
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    const limit = prematureClose ? Math.min(maxBytes, 64 * 1024) : maxBytes;
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const used = Buffer.from(value).subarray(0, limit - length);
      chunks.push(used);
      length += used.length;
      if (prematureClose) break;
    }
    if (length === 0) throw Error("HTTP 206 returned no bytes");
    return {
      status,
      start,
      requested: maxBytes,
      received: length,
      contentRange: rangeHeader,
      contentType: type,
      total: rangeMatch[3] === "*" ? null : Number(rangeMatch[3]),
      buffer: Buffer.concat(chunks),
      cancelledEarly: prematureClose,
    };
  } finally {
    controller.abort();
    // Do not wait for complete video responses or download the movie.
    if (reader) await Promise.race([reader.cancel().catch(() => {}), sleep(1000)]);
    else if (response?.body) {
      await Promise.race([response.body.cancel().catch(() => {}), sleep(1000)]);
    }
    clearTimeout(timeout);
  }
}

async function verifyStream(label, url) {
  const result = { label, checks: [], passed: false };
  try {
    assert.ok(url, "Stream URL was not supplied");
    const parsed = new URL(url);
    assert.ok(["http:", "https:"].includes(parsed.protocol));
    assert.equal(parsed.pathname.endsWith(".mkv"), true);
    // Avoid recording the torrent hash and query parameters in CI artifacts.
    result.address = parsed.origin + parsed.pathname;
    const begin = await readRange(url, 0, 512 * 1024);
    const ebml = begin.buffer.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"));
    const codecs = ["A_AC3", "A_EAC3", "A_TRUEHD", "A_DTS", "A_AAC"].filter((codec) =>
      begin.buffer.includes(Buffer.from(codec, "ascii")),
    );
    result.checks.push({
      test: "metadata-range",
      status: begin.status,
      bytes: begin.received,
      totalBytes: begin.total,
      isMatroskaEbml: ebml,
      audioCodecMarkersInFirst512KiB: codecs,
    });
    assert.ok(ebml, "Stream did not begin with a Matroska EBML header");
    // A codec marker indicates metadata presence, not successful audio decoding.
    if (label.includes("AC3")) {
      result.ac3MarkerPresent = codecs.includes("A_AC3") || codecs.includes("A_EAC3");
    }

    const total = begin.total;
    const seeks = [
      8 * 1024 * 1024,
      Number.isFinite(total) && total > 2 * 1024 * 1024
        ? Math.floor(total / 2)
        : 32 * 1024 * 1024,
    ];
    for (const offset of seeks) {
      if (total && offset + 131072 >= total) continue;
      const part = await readRange(url, offset, 131072);
      result.checks.push({
        test: "random-seek-range",
        offset,
        status: part.status,
        bytes: part.received,
        contentRange: part.contentRange,
      });
    }

    // Repeatedly start then abandon a media response, reproducing the
    // network lifecycle that previously hit Node Undici Parser.finish.
    for (let i = 0; i < 3; i++) {
      const abandoned = await readRange(url, 1024 * 1024 * (i + 1), 512 * 1024, true);
      result.checks.push({
        test: "interrupted-range-" + (i + 1),
        bytes: abandoned.received,
        status: abandoned.status,
        cancelledEarly: abandoned.cancelledEarly,
      });
      await sleep(200);
    }
    // After several cancelled responses the same URL must still work.
    const last = await readRange(url, 0, 65536);
    result.checks.push({ test: "reconnect-after-cancel", bytes: last.received, status: last.status });
    result.passed = true;
  } catch (error) {
    result.error = String(error?.stack || error);
  }
  return result;
}

let ended = false;
const watchdog = setTimeout(() => {
  if (ended) return;
  results.timeout = "Global live test timeout (210s)";
  save();
  app.exit(2);
}, 210000);

function save() {
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(results, null, 2),
  );
}

app.whenReady().then(async () => {
  const previousFetch = globalThis.fetch;
  // Every request must use Chromium's net.fetch, including range retries.
  globalThis.fetch = () => {
    throw Error("Regression: Node/Undici global fetch was called");
  };
  try {
    for (const item of streams) {
      const result = await verifyStream(item.label, item.url);
      results.streams.push(result);
      console.log(
        `${result.passed ? "PASS" : "FAIL"}: ${item.label}: ${result.checks.length} checks` +
          (result.error ? ` — ${result.error.split("\n")[0]}` : ""),
      );
      save();
    }
  } finally {
    globalThis.fetch = previousFetch;
    ended = true;
    clearTimeout(watchdog);
    save();
  }
  const ok = results.streams.length === streams.length &&
    results.streams.every((item) => item.passed);
  console.log("Report: " + path.join(output, "report.json"));
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  results.unexpectedError = String(error?.stack || error);
  ended = true;
  clearTimeout(watchdog);
  save();
  console.error(error);
  app.exit(1);
});
