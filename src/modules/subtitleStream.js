const { MatroskaReader, createState, header } = require("./matroskaSubtitles");
const MAX_CUES = 20000;
const MAX_BYTES = 4 * 1024 * 1024;
const publicTracks = (tracks) =>
  tracks.map(({ trackNumber, codec, language, label, supported }) => ({
    trackNumber,
    codec,
    language,
    label,
    supported,
  }));

class SubtitleStream {
  constructor() {
    this.media = new Map();
    this.serial = 0;
    this.fetchRange = fetch;
  }
  get(url) {
    let media = this.media.get(url);
    if (!media) {
      media = {
        id: String(++this.serial),
        state: createState(),
        cues: new Map(),
        bytes: 0,
        listeners: new Set(),
        closed: false,
      };
      this.media.set(url, media);
      while (this.media.size > 3) {
        const [oldUrl, old] = this.media.entries().next().value;
        old.closed = true;
        old.listeners.clear();
        this.media.delete(oldUrl);
      }
    }
    return media;
  }
  watch(url, listener) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || url.length > 16384)
      throw Error("Invalid media URL");
    parsed.hash = "";
    const media = this.get(parsed.href);
    media.listeners.add(listener);
    let controller = null;
    return {
      snapshot: {
        id: media.id,
        tracks: publicTracks(media.state.tracks),
        cues: [...media.cues.values()],
      },
      stop: () => {
        controller?.abort();
        media.listeners.delete(listener);
      },
      seek: async (time) => {
        if (!Number.isFinite(time) || time < 0) return;
        controller?.abort();
        controller = new AbortController();
        try {
          await this.seek(parsed.href, media, time, controller.signal);
        } catch {
          /* Ordinary playback continues if an optional seek lookup fails. */
        }
      },
    };
  }
  accept(media, event) {
    if (event.type === "index") return event;
    if (event.type === "tracks")
      return { type: "tracks", tracks: publicTracks(event.tracks) };
    const cue = event.cue;
    const key = `${cue.trackNumber}:${cue.start}:${cue.end}:${cue.text}`;
    if (media.cues.has(key)) return null;
    media.cues.set(key, cue);
    media.bytes += cue.text.length * 2 + 128;
    while (media.cues.size > MAX_CUES || media.bytes > MAX_BYTES) {
      const [oldKey, old] = media.cues.entries().next().value;
      media.bytes -= old.text.length * 2 + 128;
      media.cues.delete(oldKey);
    }
    return event;
  }
  async range(url, start, end, signal) {
    const response = await this.fetchRange(url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    const actual = response.headers
      .get("content-range")
      ?.match(/^bytes (\d+)-/);
    if (response.status !== 206 || Number(actual?.[1]) !== start) {
      await response.body?.cancel();
      throw Error("Range not supported");
    }
    const reader = response.body.getReader(),
      chunks = [];
    let length = 0;
    try {
      while (length < end - start + 1) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value).subarray(0, end - start + 1 - length);
        chunks.push(chunk);
        length += chunk.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
  }
  async seek(url, media, time, signal) {
    // Seeking can land AFTER a long caption's packet. Read just the preceding
    // subtitle blocks identified by MKV Cues, never rescan a video time window.
    const cached = [...media.cues.values()];
    const points = media.state.cuePoints
      .filter(
        (p) =>
          p.time * media.state.scale <= time &&
          (p.time + p.duration) * media.state.scale > time &&
          !cached.some(
            (c) =>
              c.trackNumber === p.trackNumber &&
              Math.abs(c.start - p.time * media.state.scale) < 0.01,
          ),
      )
      .slice(0, 128);
    const clusters = new Map();
    for (const point of points) {
      if (!clusters.has(point.cluster)) clusters.set(point.cluster, []);
      clusters.get(point.cluster).push(point);
    }
    for (const [position, items] of clusters) {
      if (signal.aborted || media.closed) return;
      let width = media.state.clusterHeaders.get(position);
      if (!width) {
        const h = header(
          await this.range(url, position, position + 11, signal),
        );
        if (!h || h.id !== 0x1f43b675) continue;
        width = h.width;
      }
      items.sort((a, b) => a.relative - b.relative);
      while (items.length) {
        const first = items[0].relative;
        const group = items.filter((p) => p.relative - first < 128 * 1024);
        items.splice(0, group.length);
        const data = await this.range(
          url,
          position + width + first,
          position + width + group[group.length - 1].relative + 128 * 1024 - 1,
          signal,
        );
        if (signal.aborted || media.closed) return;
        const events = [];
        const parser = new MatroskaReader(media.state, (e) => {
          const accepted = this.accept(media, e);
          if (accepted) events.push(accepted);
        });
        for (const point of group)
          parser.indexedBlock(data.subarray(point.relative - first), point);
        if (events.length)
          for (const listener of media.listeners)
            listener({ id: media.id, events });
      }
    }
  }
  observe(request, response) {
    const type = response.headers.get("content-type") || "";
    if (
      request.method !== "GET" ||
      ![200, 206].includes(response.status) ||
      !response.body ||
      (!this.media.has(request.url) &&
        !/matroska/i.test(type) &&
        !/\.mkv(?:[?#]|$)/i.test(request.url))
    )
      return response;
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding !== "identity") return response;
    const range = response.headers
      .get("content-range")
      ?.match(/^bytes (\d+)-\d+\/(?:\d+|\*)$/);
    if (response.status === 206 && !range) return response;
    const media = this.get(request.url);
    let events = [];
    const reader = new MatroskaReader(
      media.state,
      (event) => {
        const accepted = this.accept(media, event);
        if (accepted) events.push(accepted);
      },
      range ? Number(range[1]) : 0,
    );
    const body = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          if (!media.closed) {
            try {
              reader.push(chunk);
            } catch {
              /* Preserve playback even if a container is malformed. */
            }
            if (events.length) {
              const packet = { id: media.id, events };
              for (const listener of media.listeners) listener(packet);
              events = [];
            }
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}
const stream = new SubtitleStream();
module.exports = { SubtitleStream, stream };
