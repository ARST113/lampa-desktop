// A bounded observer of the bytes already requested by the media element.
// Container layout: https://www.matroska.org/technical/subtitles.html
const { inflateSync } = require("node:zlib");
const CLUSTER = Buffer.from("1f43b675", "hex");
const MAX_METADATA = 512 * 1024;
const MAX_BLOCK = 128 * 1024;
const codecs = new Set([
  "S_TEXT/UTF8",
  "S_TEXT/ASS",
  "S_TEXT/SSA",
  "S_TEXT/WEBVTT",
]);

function vint(buffer, offset = 0, identifier = false) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  let width = 1;
  while (width <= 8 && !(first & (1 << (8 - width)))) width++;
  if (width > 8 || (identifier && width > 4))
    throw Error("Invalid EBML integer");
  if (buffer.length < offset + width) return null;
  let value = identifier ? first : first & ((1 << (8 - width)) - 1);
  let unknown = !identifier && value === (1 << (8 - width)) - 1;
  for (let i = 1; i < width; i++) {
    value = value * 256 + buffer[offset + i];
    unknown = unknown && buffer[offset + i] === 255;
  }
  if (!unknown && !Number.isSafeInteger(value))
    throw Error("Oversized EBML integer");
  return { width, value: unknown ? Infinity : value };
}
function header(buffer, offset = 0) {
  const id = vint(buffer, offset, true);
  if (!id) return null;
  const size = vint(buffer, offset + id.width);
  return (
    size && { id: id.value, size: size.value, width: id.width + size.width }
  );
}
function children(buffer) {
  const result = [];
  for (let offset = 0; offset < buffer.length;) {
    const h = header(buffer, offset);
    if (
      !h ||
      !Number.isFinite(h.size) ||
      offset + h.width + h.size > buffer.length
    )
      throw Error("Incomplete EBML element");
    offset += h.width;
    result.push({ id: h.id, data: buffer.subarray(offset, offset + h.size) });
    offset += h.size;
  }
  return result;
}
const number = (b) => {
  let value = 0;
  if (!b || b.length > 8) return 0;
  for (const byte of b) value = value * 256 + byte;
  return Number.isSafeInteger(value) ? value : 0;
};
const string = (b) => b?.toString("utf8").replace(/\0+$/, "") || "";
function fields(buffer) {
  return new Map(children(buffer).map((e) => [e.id, e.data]));
}
function createState() {
  return {
    scale: 0.001,
    tracks: [],
    segmentOffset: 0,
    anchors: new Map(),
    cuePoints: [],
    clusterHeaders: new Map(),
  };
}
function readTracks(buffer) {
  return children(buffer)
    .filter((e) => e.id === 0xae)
    .slice(0, 64)
    .map((e) => {
      const f = fields(e.data);
      if (number(f.get(0x83)) !== 17) return null;
      const codec = string(f.get(0x86));
      const encodings = f.has(0x6d80)
        ? children(f.get(0x6d80)).filter((x) => x.id === 0x6240)
        : [];
      let compression = null,
        supported = codecs.has(codec);
      if (encodings.length > 1) supported = false;
      for (const encoding of encodings) {
        const ef = fields(encoding.data);
        if (
          number(ef.get(0x5033)) !== 0 ||
          (ef.has(0x5032) && number(ef.get(0x5032)) !== 1)
        )
          supported = false;
        if (ef.has(0x5034)) {
          const cf = fields(ef.get(0x5034));
          compression = {
            algorithm: number(cf.get(0x4254)),
            settings: cf.get(0x4255) || Buffer.alloc(0),
          };
          if (![0, 3].includes(compression.algorithm)) supported = false;
        }
      }
      // Non-default track time scaling needs a dedicated renderer; do not show
      // incorrectly timed cues as supported.
      if (f.has(0x23314f)) {
        const b = f.get(0x23314f);
        const scale =
          b.length === 4
            ? b.readFloatBE()
            : b.length === 8
              ? b.readDoubleBE()
              : 0;
        if (scale !== 1) supported = false;
      }
      return {
        trackNumber: number(f.get(0xd7)),
        codec,
        language: string(f.get(0x22b59d)) || string(f.get(0x22b59c)) || "und",
        label: string(f.get(0x536e)) || codec,
        supported,
        compression,
        delay: number(f.get(0x56aa)) / 1e9,
        defaultDuration: number(f.get(0x23e383)) / 1e9,
      };
    })
    .filter(Boolean);
}
function decodeText(data, track) {
  if (track.compression?.algorithm === 0)
    data = inflateSync(data, { maxOutputLength: MAX_BLOCK });
  if (track.compression?.algorithm === 3)
    data = Buffer.concat([track.compression.settings, data]);
  let text = data.toString("utf8").replace(/\0+$/, "").replace(/\r/g, "");
  if (/S_TEXT\/(ASS|SSA)$/.test(track.codec)) {
    const match = text.match(/^(?:[^,]*,){8}([\s\S]*)$/);
    if (!match) return "";
    // Drawing commands are not dialogue. Ordinary ASS is rendered as text;
    // authored positioning/fonts/karaoke are intentionally not interpreted.
    let drawing = false;
    text = match[1]
      .split(/(\{[^}]*\})/g)
      .map((part) => {
        if (part.startsWith("{")) {
          const mode = part.match(/\\p(\d+)/);
          if (mode) drawing = Number(mode[1]) !== 0;
          return "";
        }
        return drawing ? "" : part;
      })
      .join("")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, "\u00a0");
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }
  return text;
}

class MatroskaReader {
  constructor(state, emit, offset = 0) {
    this.state = state;
    this.emit = emit;
    this.buffer = Buffer.alloc(0);
    this.skip = 0;
    this.synced = offset === 0;
    this.clusterTime = null;
    this.offset = offset;
  }
  push(chunk) {
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, chunk])
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let offset = 0;
    while (offset < this.buffer.length) {
      if (this.skip) {
        const count = Math.min(this.skip, this.buffer.length - offset);
        offset += count;
        this.skip -= count;
        continue;
      }
      if (!this.synced) {
        let index = this.buffer.indexOf(CLUSTER, offset);
        const anchor = [...this.state.anchors.keys()]
          .filter(
            (p) =>
              p >= this.offset + offset && p < this.offset + this.buffer.length,
          )
          .sort((a, b) => a - b)[0];
        if (
          anchor !== undefined &&
          (index < 0 || anchor - this.offset < index)
        ) {
          offset = anchor - this.offset;
          this.synced = true;
          continue;
        }
        if (index < 0) {
          offset = Math.max(offset, this.buffer.length - 3);
          break;
        }
        offset = index;
        // A range can begin in a video block. Validate a candidate cluster by
        // its first child (timestamp, CRC, position or previous-cluster size).
        try {
          const h = header(this.buffer, offset);
          if (!h || this.buffer.length <= offset + h.width) break;
          const child = header(this.buffer, offset + h.width);
          if (!child) break;
          if (![0xe7, 0xbf, 0xa7, 0xab].includes(child.id) || child.size > 8) {
            offset++;
            continue;
          }
        } catch {
          offset++;
          continue;
        }
        this.synced = true;
      }
      let h;
      try {
        h = header(this.buffer, offset);
      } catch {
        this.synced = false;
        this.clusterTime = null;
        offset++;
        continue;
      }
      if (!h) break;
      if (h.id === 0x18538067 || h.id === 0x1f43b675) {
        if (h.id === 0x18538067)
          this.state.segmentOffset = this.offset + offset + h.width;
        if (h.id === 0x1f43b675) {
          this.clusterTime = null;
          this.state.clusterHeaders.set(this.offset + offset, h.width);
          if (this.state.clusterHeaders.size > 512)
            this.state.clusterHeaders.delete(
              this.state.clusterHeaders.keys().next().value,
            );
        }
        offset += h.width;
        continue;
      }
      if (!Number.isFinite(h.size)) {
        this.synced = false;
        offset += h.width;
        continue;
      }
      const metadata = [
        0x1549a966, 0x1654ae6b, 0x114d9b74, 0x1c53bb6b,
      ].includes(h.id);
      let collect = metadata || h.id === 0xe7 || h.id === 0xa0;
      if (h.id === 0xa3 && h.size <= MAX_BLOCK) {
        let track;
        try {
          track = vint(this.buffer, offset + h.width);
        } catch {
          /* skip malformed block */
        }
        if (!track && this.buffer.length < offset + h.width + 8) break;
        collect = this.state.tracks.some(
          (t) => t.trackNumber === track?.value && t.supported,
        );
      }
      if (
        h.size >
        (h.id === 0x1c53bb6b
          ? 4 * 1024 * 1024
          : metadata
            ? MAX_METADATA
            : MAX_BLOCK)
      )
        collect = false;
      if (!collect) {
        offset += h.width;
        this.skip = h.size;
        continue;
      }
      if (this.buffer.length < offset + h.width + h.size) break;
      const data = this.buffer.subarray(
        offset + h.width,
        offset + h.width + h.size,
      );
      try {
        this.element(h.id, data);
      } catch {
        /* A malformed subtitle must never interrupt video. */
      }
      offset += h.width + h.size;
    }
    // Copy only a bounded incomplete element, never retain a video response.
    this.buffer = Buffer.from(this.buffer.subarray(offset));
    this.offset += offset;
  }
  element(id, data) {
    if (id === 0x114d9b74) {
      for (const seek of children(data).filter((e) => e.id === 0x4dbb)) {
        const f = fields(seek.data);
        const target = number(f.get(0x53ab));
        if ([0x1549a966, 0x1654ae6b, 0x1c53bb6b].includes(target))
          this.state.anchors.set(
            this.state.segmentOffset + number(f.get(0x53ac)),
            target,
          );
      }
    } else if (id === 0x1c53bb6b) {
      const points = [];
      for (const point of children(data)) {
        if (point.id !== 0xbb) continue;
        const entries = children(point.data);
        const time = number(entries.find((e) => e.id === 0xb3)?.data);
        for (const position of entries.filter((e) => e.id === 0xb7)) {
          const f = fields(position.data);
          if (!f.has(0xf0) || !f.has(0xb2)) continue;
          const trackNumber = number(f.get(0xf7));
          if (
            !this.state.tracks.some(
              (t) => t.trackNumber === trackNumber && t.supported,
            )
          )
            continue;
          points.push({
            trackNumber,
            time,
            duration: number(f.get(0xb2)),
            cluster: this.state.segmentOffset + number(f.get(0xf1)),
            relative: number(f.get(0xf0)),
          });
          if (points.length >= 50000) break;
        }
        if (points.length >= 50000) break;
      }
      this.state.cuePoints = points;
      this.emit({ type: "index" });
    } else if (id === 0x1549a966) {
      const value = number(fields(data).get(0x2ad7b1));
      if (value > 0) this.state.scale = value / 1e9;
    } else if (id === 0x1654ae6b) {
      this.state.tracks = readTracks(data);
      this.emit({ type: "tracks", tracks: this.state.tracks });
    } else if (id === 0xe7) this.clusterTime = number(data);
    else if (id === 0xa0) {
      const f = fields(data);
      if (f.has(0xa1))
        this.block(
          f.get(0xa1),
          f.has(0x9b) ? number(f.get(0x9b)) * this.state.scale : null,
        );
    } else if (id === 0xa3) this.block(data, null);
  }
  indexedBlock(data, point) {
    const h = header(data);
    if (!h || h.id !== 0xa0 || data.length < h.width + h.size) return;
    const group = data.subarray(h.width, h.width + h.size);
    const block = fields(group).get(0xa1);
    if (!block) return;
    const v = vint(block);
    if (!v || v.value !== point.trackNumber || block.length < v.width + 3)
      return;
    this.clusterTime = point.time - block.readInt16BE(v.width);
    this.element(0xa0, group);
  }
  block(data, duration) {
    if (this.clusterTime === null) return;
    const v = vint(data);
    if (!v || data.length < v.width + 3) return;
    const track = this.state.tracks.find(
      (t) => t.trackNumber === v.value && t.supported,
    );
    if (!track || data[v.width + 2] & 6) return; // Subtitle lacing is not supported.
    const start =
      (this.clusterTime + data.readInt16BE(v.width)) * this.state.scale -
      track.delay;
    const end = start + (duration ?? track.defaultDuration);
    const text = decodeText(data.subarray(v.width + 3), track);
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > Math.max(0, start) &&
      text
    )
      this.emit({
        type: "cue",
        cue: {
          trackNumber: track.trackNumber,
          start: Math.max(0, start),
          end,
          text,
        },
      });
  }
}
module.exports = { MatroskaReader, createState, header };
