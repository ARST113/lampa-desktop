const test = require("node:test");
const assert = require("node:assert/strict");
const { deflateSync } = require("node:zlib");
const { SubtitleStream } = require("../src/modules/subtitleStream");
const {
  MatroskaReader,
  createState,
} = require("../src/modules/matroskaSubtitles");

function size(n) {
  for (let width = 1; width < 8; width++) {
    if (n < 2 ** (width * 7) - 1) {
      const b = Buffer.alloc(width);
      b.writeUIntBE(n, 0, width);
      b[0] |= 1 << (8 - width);
      return b;
    }
  }
  throw Error("too large");
}
const uint = (n) =>
  n < 256 ? Buffer.from([n]) : Buffer.from([n >> 8, n & 255]);
const element = (id, data) =>
  Buffer.concat([Buffer.from(id, "hex"), size(data.length), data]);
const master = (id, ...items) => element(id, Buffer.concat(items));
const field = (id, value) =>
  element(id, typeof value === "number" ? uint(value) : Buffer.from(value));
const track = (number, codec, extra = []) =>
  master(
    "ae",
    field("d7", number),
    field("83", 17),
    field("86", codec),
    field("22b59c", "rus"),
    field("536e", "Russian"),
    ...extra,
  );
const block = (number, time, text) => {
  const timing = Buffer.alloc(3);
  timing.writeInt16BE(time); // flags: no lacing
  return element(
    "a1",
    Buffer.concat([
      size(number),
      timing,
      Buffer.isBuffer(text) ? text : Buffer.from(text),
    ]),
  );
};
const cue = (number, time, text, duration = 2000) =>
  master("a0", block(number, time, text), field("9b", duration));
const cluster = (time, ...items) =>
  master("1f43b675", field("e7", time), ...items);
const prefix = (...tracks) =>
  Buffer.concat([
    Buffer.from("1853806701ffffffffffffff", "hex"),
    master("1654ae6b", ...tracks),
  ]);
function read(bytes, width = 1, state = createState(), offset = 0) {
  const events = [];
  const reader = new MatroskaReader(
    state,
    (event) => events.push(event),
    offset,
  );
  for (let i = 0; i < bytes.length; i += width)
    reader.push(bytes.subarray(i, i + width));
  return { events, state, reader };
}
test("reads all text tracks from split video bytes with exact block times", () => {
  const data = Buffer.concat([
    prefix(track(3, "S_TEXT/UTF8"), track(4, "S_TEXT/ASS")),
    cluster(
      10000,
      cue(3, -500, "Привет"),
      cue(4, 0, "0,0,Default,,0,0,0,,Hello\\Nworld"),
    ),
  ]);
  for (const width of [1, 7, 65536]) {
    const { events, state } = read(data, width);
    assert.equal(state.tracks.length, 2);
    assert.deepEqual(
      events.filter((e) => e.type === "cue").map((e) => e.cue),
      [
        { trackNumber: 3, start: 9.5, end: 11.5, text: "Привет" },
        { trackNumber: 4, start: 10, end: 12, text: "Hello\nworld" },
      ],
    );
  }
});
test("range seek reuses header and finds the next cluster without fetching again", () => {
  const { state } = read(prefix(track(3, "S_TEXT/UTF8")));
  const { events } = read(
    Buffer.concat([
      Buffer.alloc(30, 99),
      cluster(25000, cue(3, 2, "After seek")),
    ]),
    3,
    state,
    900000,
  );
  assert.equal(events.find((e) => e.type === "cue").cue.start, 25.002);
});
test("skips large video blocks and false cluster signatures inside their payload", () => {
  const fake = cluster(100, cue(3, 0, "FAKE"));
  const data = Buffer.concat([
    prefix(track(3, "S_TEXT/UTF8")),
    cluster(
      1000,
      element(
        "a3",
        Buffer.concat([
          Buffer.from([0x81, 0, 0, 0]),
          fake,
          Buffer.alloc(2 * 1024 * 1024),
        ]),
      ),
      cue(3, 0, "Real"),
    ),
  ]);
  const { events, reader } = read(data, 65536);
  assert.deepEqual(
    events.filter((e) => e.type === "cue").map((e) => e.cue.text),
    ["Real"],
  );
  assert.ok(reader.buffer.length < 1024);
});
test("supports zlib and header-stripped subtitle blocks", () => {
  const encoding = (algorithm, settings = Buffer.alloc(0)) =>
    master(
      "6d80",
      master(
        "6240",
        master("5034", field("4254", algorithm), element("4255", settings)),
      ),
    );
  const { events } = read(
    Buffer.concat([
      prefix(
        track(3, "S_TEXT/UTF8", [encoding(0)]),
        track(4, "S_TEXT/UTF8", [encoding(3, Buffer.from("Hello "))]),
      ),
      cluster(
        0,
        cue(3, 0, deflateSync(Buffer.from("Compressed"))),
        cue(4, 0, "world"),
      ),
    ]),
    13,
  );
  assert.deepEqual(
    events.filter((e) => e.type === "cue").map((e) => e.cue.text),
    ["Compressed", "Hello world"],
  );
});
test("marks bitmap and encrypted subtitles unsupported; malformed input is bounded", () => {
  const { state } = read(
    prefix(
      track(3, "S_HDMV/PGS"),
      track(4, "S_TEXT/UTF8", [
        master("6d80", master("6240", field("5033", 1))),
      ]),
    ),
  );
  assert.ok(state.tracks.every((t) => !t.supported));
  const { reader } = read(Buffer.alloc(100000, 0), 65536);
  assert.ok(reader.buffer.length < 1024);
});
test("does not guess a duration when subtitle timing is missing", () => {
  const { events } = read(
    Buffer.concat([
      prefix(track(3, "S_TEXT/UTF8")),
      cluster(0, master("a0", block(3, 0, "No duration"))),
    ]),
  );
  assert.equal(events.filter((e) => e.type === "cue").length, 0);
});

test("observer preserves response bytes, range and headers; watch replays cached cues", async () => {
  const stream = new SubtitleStream();
  const bytes = Buffer.concat([
    prefix(track(3, "S_TEXT/UTF8")),
    cluster(0, cue(3, 100, "Same response")),
  ]);
  const request = new Request("http://localhost/movie.mkv");
  const original = new Response(bytes, {
    status: 206,
    headers: {
      "Content-Type": "video/x-matroska",
      "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(bytes.length),
    },
  });
  const observed = stream.observe(request, original);
  assert.equal(observed.status, 206);
  assert.equal(
    observed.headers.get("content-range"),
    original.headers.get("content-range"),
  );
  assert.deepEqual(Buffer.from(await observed.arrayBuffer()), bytes);
  const watched = stream.watch(request.url, () => {});
  assert.equal(watched.snapshot.tracks.length, 1);
  assert.equal(watched.snapshot.cues[0].text, "Same response");
  watched.stop();
  assert.equal(stream.media.get(request.url).listeners.size, 0);
});

test("observer obeys video backpressure and forwards cancellation", async () => {
  let reads = 0,
    cancelled = false;
  const stream = new SubtitleStream();
  const source = new ReadableStream(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(65536));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const response = stream.observe(
    new Request("http://localhost/movie.mkv"),
    new Response(source),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(reads <= 1, "must not download ahead of video");
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("ordinary responses are untouched and media cache count stays bounded", () => {
  const stream = new SubtitleStream();
  const response = new Response("page");
  assert.equal(
    stream.observe(new Request("https://localhost/page"), response),
    response,
  );
  for (let i = 0; i < 20; i++)
    stream.watch(`http://localhost/${i}.mkv`, () => {}).stop();
  assert.equal(stream.media.size, 3);
});

test("uses the container timestamp scale for WebVTT text and duration", () => {
  const data = Buffer.concat([
    prefix(track(3, "S_TEXT/WEBVTT")),
    master("1549a966", field("2ad7b1", Buffer.from("1e8480", "hex"))),
    cluster(1000, cue(3, 500, "<b>Text</b>", 250)),
  ]);
  const events = read(data, 3).events.filter((e) => e.type === "cue");
  assert.deepEqual(events[0].cue, {
    trackNumber: 3,
    start: 3,
    end: 3.5,
    text: "<b>Text</b>",
  });
});

test("seek lookup refuses a server that ignores Range without reading the movie", async () => {
  const stream = new SubtitleStream();
  let cancelled = false,
    read = 0;
  stream.fetchRange = async () =>
    new Response(
      new ReadableStream(
        {
          pull() {
            read++;
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      { status: 200 },
    );
  await assert.rejects(
    stream.range(
      "http://localhost/movie",
      100,
      200,
      new AbortController().signal,
    ),
    /Range not supported/,
  );
  assert.equal(cancelled, true);
  assert.equal(read, 0);
});

test("caption cache is bounded and repeated blocks are deduplicated", () => {
  const stream = new SubtitleStream(),
    media = stream.get("http://localhost/movie");
  for (let i = 0; i < 25000; i++)
    stream.accept(media, {
      type: "cue",
      cue: { trackNumber: 1, start: i, end: i + 1, text: "Caption" },
    });
  assert.equal(media.cues.size, 20000);
  assert.equal(
    stream.accept(media, {
      type: "cue",
      cue: { trackNumber: 1, start: 24999, end: 25000, text: "Caption" },
    }),
    null,
  );
  assert.ok(media.bytes <= 4 * 1024 * 1024);
});
