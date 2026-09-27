(function (factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else factory().install(window.Lampa, window.electronAPI);
})(function () {
  const textCodecs = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "text"]);
  function subtitleStreams(probe) {
    const streams = Array.isArray(probe) ? probe : probe?.streams;
    return (Array.isArray(streams) ? streams : [])
      .filter((s) => s.codec_type === "subtitle" && Number.isInteger(s.index))
      .map((s) => ({
        streamIndex: s.index,
        language: s.tags?.language || "und",
        label: s.tags?.title || s.codec_name || "Субтитры",
        supported: textCodecs.has(s.codec_name),
        codec: s.codec_name,
      }));
  }
  function timestamp(value) {
    const fields = value.split(":").map(Number);
    return fields.reduce((total, part) => total * 60 + part, 0);
  }
  class VttParser {
    constructor(offset) {
      this.offset = offset;
      this.buffer = "";
    }
    push(text) {
      this.buffer += text.replace(/\r/g, "");
      const blocks = this.buffer.split("\n\n");
      this.buffer = blocks.pop();
      return blocks.flatMap((block) => {
        const lines = block.split("\n");
        const index = lines.findIndex((line) => line.includes(" --> "));
        if (index < 0) return [];
        const match = lines[index].match(
          /^((?:\d+:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d+:)?\d{2}:\d{2}\.\d{3})(?:\s.*)?$/,
        );
        if (!match) return [];
        const start = timestamp(match[1]) + this.offset;
        const end = timestamp(match[2]) + this.offset;
        const cueText = lines.slice(index + 1).join("\n");
        return Number.isFinite(start) && end > start && cueText
          ? [{ start, end, text: cueText }]
          : [];
      });
    }
    finish() {
      return this.push("\n\n");
    }
  }

  function attachVideo(video, streams, api, notify = () => {}) {
    let disposed = false;
    let selected = -1;
    let pending = null;
    let range = null;
    let serial = 0;
    let failed = false;
    const originalSubs = video.customSubs;
    const source = video.currentSrc || video.src;
    const elements = [];
    const previousCues = new Map();
    const entries = streams.map((stream, index) => {
      const element = video.ownerDocument.createElement("track");
      element.kind = "subtitles";
      element.label = stream.label;
      element.srclang = stream.language;
      if (stream.supported) video.appendChild(element);
      elements.push(element);
      const entry = {
        index,
        language: stream.language,
        label: stream.supported
          ? stream.label
          : `${stream.label} (${stream.codec}: нужен внешний плеер)`,
        ghost: !stream.supported,
        noenter: !stream.supported,
        selected: false,
        ready: true,
      };
      Object.defineProperty(entry, "mode", {
        get: () => (selected === index ? "showing" : "disabled"),
        set: (mode) => {
          if (disposed) return;
          if (mode !== "showing") {
            if (selected === index) stop();
            return;
          }
          if (!stream.supported) return;
          stop();
          selected = index;
          failed = false;
          entry.selected = true;
          element.track.mode = "showing";
          notify("Загрузка субтитров…");
          load();
        },
      });
      return entry;
    });
    video.customSubs = entries;

    function stop() {
      if (pending) api.cancel(pending.id).catch(() => {});
      pending = null;
      range = null;
      selected = -1;
      previousCues.clear();
      elements.forEach((element, index) => {
        if (streams[index].supported) {
          element.track.mode = "disabled";
          for (const cue of Array.from(element.track.cues || []))
            element.track.removeCue(cue);
        }
        entries[index].selected = false;
      });
    }
    function addCues(operation, cues) {
      if (disposed || pending !== operation || selected !== operation.index)
        return;
      const track = elements[selected].track;
      for (const cue of cues) {
        const key = `${cue.end.toFixed(3)}:${cue.text}`;
        const previous = previousCues.get(key);
        if (previous && previous.startTime <= cue.start) continue;
        if (previous) track.removeCue(previous);
        const native = new video.ownerDocument.defaultView.VTTCue(
          cue.start,
          cue.end,
          cue.text,
        );
        track.addCue(native);
        previousCues.set(key, native);
      }
      for (const [key, cue] of previousCues) {
        // Keep every cue in the advertised window so backward seeks can reuse it.
        if (cue.endTime < operation.start - 10) {
          track.removeCue(cue);
          previousCues.delete(key);
        }
      }
    }
    const unsubscribe = api.onData((event) => {
      if (pending?.id === event.id)
        addCues(pending, pending.parser.push(event.text));
    });
    async function load() {
      if (disposed || selected < 0 || failed) return;
      if ((video.currentSrc || video.src) !== source) {
        dispose();
        return;
      }
      const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      if (pending && time >= pending.start && time < pending.start + 90) return;
      if (range && time >= range.start && time < range.end - 15) return;
      const start = Math.max(0, Math.floor(time) - 10);
      if (pending) api.cancel(pending.id).catch(() => {});
      const operation = {
        id: `${Date.now()}-${++serial}`,
        index: selected,
        start,
        parser: new VttParser(start),
      };
      pending = operation;
      range = null;
      try {
        const result = await api.extract({
          id: operation.id,
          url: source,
          streamIndex: streams[selected].streamIndex,
          start,
        });
        if (pending !== operation || disposed) return;
        addCues(operation, operation.parser.finish());
        pending = null;
        if (result.success) range = { start: result.start, end: result.end };
        else if (!result.cancelled) {
          failed = true;
          notify(result.message || "Не удалось загрузить субтитры.");
        }
      } catch {
        if (pending === operation) {
          pending = null;
          failed = true;
          notify("Не удалось загрузить субтитры. Повторно выберите дорожку.");
        }
      }
    }
    function dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      unsubscribe();
      video.removeEventListener("timeupdate", load);
      video.removeEventListener("seeked", load);
      elements.forEach((element) => element.remove());
      if (video.customSubs === entries) video.customSubs = originalSubs;
    }
    video.addEventListener("timeupdate", load);
    video.addEventListener("seeked", load);
    return { entries, dispose };
  }

  function attachStream(video, api, changed, notify) {
    const entries = [];
    const tracks = new Map();
    const cues = new Map();
    const originalSubs = video.customSubs;
    let bytes = 0;
    let disposed = false;
    let streamId = null;
    let queued = [];
    let selected = null;
    const seek = () => {
      if (!disposed) api.seek(video.currentTime).catch(() => {});
    };
    video.addEventListener("seeked", seek);
    function publish() {
      // Lampa inserts its "Off" item into menu arrays. Never expose the array
      // used for track ownership and cleanup to that mutation.
      video.customSubs = entries.slice();
      changed(entries.slice());
    }
    function metadata(streams) {
      for (const stream of streams) {
        if (tracks.has(stream.trackNumber)) continue;
        const element = video.ownerDocument.createElement("track");
        element.kind = "subtitles";
        element.label = stream.label;
        element.srclang = stream.language;
        const item = { stream, element, loaded: false, entry: null };
        element.addEventListener("load", () => {
          if (disposed) return;
          item.loaded = true;
          for (const cue of cues.values()) {
            if (cue.track === element.track && !cue.added) {
              element.track.addCue(cue.native);
              cue.added = true;
            }
          }
        });
        if (stream.supported) {
          // Track loading resets its cue list asynchronously. Finish loading an
          // empty local VTT before inserting container cues, including snapshots.
          element.src = "data:text/vtt,WEBVTT%0A%0A";
          video.appendChild(element);
          element.track.mode = "hidden";
        }
        const entry = {
          index: entries.length,
          language: stream.language,
          label: stream.supported
            ? stream.label
            : `${stream.label} (${stream.codec}: формат не поддерживается)`,
          ghost: !stream.supported,
          noenter: !stream.supported,
          selected: false,
          ready: true,
        };
        Object.defineProperty(entry, "mode", {
          get: () => (selected === stream.trackNumber ? "showing" : "disabled"),
          set: (mode) => {
            if (disposed || !stream.supported) return;
            if (mode !== "showing") {
              element.track.mode = "hidden";
              entry.selected = false;
              if (selected === stream.trackNumber) selected = null;
              return;
            }
            for (const item of tracks.values()) {
              if (item.stream.supported) item.element.track.mode = "hidden";
              item.entry.selected = false;
            }
            selected = stream.trackNumber;
            entry.selected = true;
            element.track.mode = "showing";
          },
        });
        item.entry = entry;
        tracks.set(stream.trackNumber, item);
        entries.push(entry);
      }
      publish();
    }
    function add(cue) {
      const item = tracks.get(cue.trackNumber);
      if (!item?.stream.supported) return;
      const key = `${cue.trackNumber}:${cue.start}:${cue.end}:${cue.text}`;
      if (cues.has(key)) return;
      const native = new video.ownerDocument.defaultView.VTTCue(
        cue.start,
        cue.end,
        cue.text,
      );
      if (item.loaded) item.element.track.addCue(native);
      cues.set(key, { native, track: item.element.track, added: item.loaded });
      bytes += cue.text.length * 2 + 128;
      while (cues.size > 20000 || bytes > 4 * 1024 * 1024) {
        const [oldKey, old] = cues.entries().next().value;
        if (old.added) old.track.removeCue(old.native);
        bytes -= old.native.text.length * 2 + 128;
        cues.delete(oldKey);
      }
    }
    function receive(packet) {
      if (disposed) return;
      if (!streamId) {
        queued.push(packet);
        return;
      }
      if (packet.id !== streamId) return;
      for (const event of packet.events) {
        if (event.type === "tracks") metadata(event.tracks);
        else if (event.type === "cue") add(event.cue);
        else if (event.type === "index") seek();
      }
    }
    const unsubscribe = api.onStream(receive);
    api
      .watch(video.currentSrc || video.src)
      .then((snapshot) => {
        if (disposed) return;
        streamId = snapshot.id;
        metadata(snapshot.tracks);
        snapshot.cues.forEach(add);
        seek();
        queued.forEach(receive);
        queued = [];
      })
      .catch(() => {
        if (!disposed)
          notify("Не удалось подключить чтение встроенных субтитров.");
      });
    return {
      entries,
      dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        video.removeEventListener("seeked", seek);
        api.unwatch().catch(() => {});
        queued = [];
        tracks.forEach((item) => item.element.remove());
        cues.clear();
        video.customSubs = originalSubs;
      },
    };
  }

  function install(Lampa, electronAPI) {
    if (
      !Lampa?.Player?.listener ||
      !electronAPI?.subtitles ||
      window.desktopSubtitlesInstalled
    )
      return;
    window.desktopSubtitlesInstalled = true;
    let session = null;
    let generation = 0;
    let probeId = null;
    // Metadata plugins may replace the menu with entries that only toggle empty
    // native tracks. Keep the working controls while this session owns subtitles.
    const originalSetSubs = Lampa.PlayerPanel?.setSubs;
    if (originalSetSubs) {
      Lampa.PlayerPanel.setSubs = function (subs) {
        return originalSetSubs.call(
          this,
          session ? session.entries.slice() : subs,
        );
      };
    }
    const clean = () => {
      generation++;
      if (probeId) electronAPI.subtitles.cancel(probeId).catch(() => {});
      probeId = null;
      session?.dispose();
      session = null;
    };
    Lampa.Player.listener.follow("destroy", clean);
    Lampa.PlayerVideo.listener.follow("destroy", clean);
    Lampa.Player.listener.follow("ready", async (data) => {
      clean();
      const currentGeneration = generation;
      const video = Lampa.PlayerVideo.video();
      const source = video?.currentSrc || video?.src || "";
      if (
        !video?.addTextTrack ||
        (Array.isArray(data.subtitles) &&
          data.subtitles.some(
            (sub) => typeof sub?.url === "string" && sub.url,
          )) ||
        !/^https?:/.test(source) ||
        /\.m3u8(?:[?#]|$)/i.test(source)
      )
        return;
      if (!data.torrent_hash && !/\.mkv(?:[?#]|$)/i.test(source)) return;
      if (video.textTracks?.length) return;
      if (electronAPI.subtitles.watch) {
        session = attachStream(
          video,
          electronAPI.subtitles,
          (subs) => Lampa.PlayerVideo.listener.send("subs", { subs }),
          (message) => Lampa.Noty.show(message),
        );
        return;
      }
      let streams = subtitleStreams(data.ffprobe);
      if (!data.ffprobe) {
        probeId = `${Date.now()}-probe-${generation}`;
        try {
          const result = await electronAPI.subtitles.probe({
            id: probeId,
            url: source,
          });
          if (
            generation !== currentGeneration ||
            video !== Lampa.PlayerVideo.video()
          )
            return;
          probeId = null;
          if (!result.success) {
            if (!result.cancelled) Lampa.Noty.show(result.message);
            return;
          }
          streams = subtitleStreams(result.streams);
        } catch {
          if (generation === currentGeneration)
            Lampa.Noty.show("Не удалось определить встроенные субтитры.");
          return;
        }
      }
      if (!streams.length) return;
      session = attachVideo(video, streams, electronAPI.subtitles, (message) =>
        Lampa.Noty.show(message),
      );
      Lampa.PlayerVideo.listener.send("subs", { subs: session.entries });
    });
  }
  return { install, attachVideo, attachStream, VttParser, subtitleStreams };
});
