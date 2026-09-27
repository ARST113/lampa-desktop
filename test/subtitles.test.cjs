const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateRequest } = require("../src/modules/subtitleExtractor");
const { VttParser, subtitleStreams } = require("../src/subtitleBridge");

test("parses streamed UTF-8 WebVTT with absolute seek offsets", () => {
  const parser = new VttParser(120);
  assert.deepEqual(parser.push("WEBVTT\n\n00:02.000 --> 00:05.000\nПри"), []);
  assert.deepEqual(parser.push("вет\nмир\n\n"), [
    { start: 122, end: 125, text: "Привет\nмир" },
  ]);
});
test("parses hours, CRLF, cue identifiers and a final unterminated cue", () => {
  const parser = new VttParser(0);
  parser.push(
    "WEBVTT\r\n\r\nmy-cue\r\n01:02:03.500 --> 01:02:05.000 align:start\r\nHello",
  );
  assert.deepEqual(parser.finish(), [
    { start: 3723.5, end: 3725, text: "Hello" },
  ]);
});
test("ignores malformed cues and empty intervals", () => {
  const parser = new VttParser(0);
  assert.deepEqual(
    parser.push("NOTE skip\n\n00:10.000 --> 00:01.000\nNo\n\n"),
    [],
  );
});
test("subtitle stream indices are original FFmpeg stream indices, not list offsets", () => {
  const streams = subtitleStreams([
    { index: 0, codec_type: "video" },
    {
      index: 3,
      codec_type: "subtitle",
      codec_name: "subrip",
      tags: { language: "rus", title: "Full" },
    },
    { index: 5, codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle" },
  ]);
  assert.equal(streams[0].streamIndex, 3);
  assert.equal(streams[0].supported, true);
  assert.equal(streams[0].language, "rus");
  assert.equal(streams[1].supported, false);
});
test("accepts only bounded HTTP extraction requests", () => {
  assert.doesNotThrow(() =>
    validateRequest({
      id: "test-1",
      url: "http://127.0.0.1:8090/stream/movie.mkv",
      streamIndex: 3,
      start: 100,
    }),
  );
  for (const patch of [
    { url: "file:///C:/private.mkv" },
    { url: "concat:http://a|http://b" },
    { start: -1 },
    { start: Infinity },
    { streamIndex: "0 -x" },
    { streamIndex: 256 },
    { id: "bad\nrequest" },
  ]) {
    assert.throws(() =>
      validateRequest({
        id: "test-1",
        url: "https://example.org/film.mkv",
        streamIndex: 3,
        start: 0,
        ...patch,
      }),
    );
  }
});
