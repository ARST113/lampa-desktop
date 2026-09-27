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

  function install(Lampa, electronAPI) {
    if (
      !Lampa?.Player?.listener ||
      !electronAPI?.subtitles ||
      window.desktopSubtitlesInstalled
    )
      return;
    window.desktopSubtitlesInstalled = true;
    let session = null;
    const clean = () => {
      session?.dispose();
      session = null;
    };
    Lampa.Player.listener.follow("destroy", clean);
    Lampa.PlayerVideo.listener.follow("destroy", clean);
    Lampa.Player.listener.follow("ready", (data) => {
      clean();
      const video = Lampa.PlayerVideo.video();
      const source = video?.currentSrc || video?.src || "";
      const streams = subtitleStreams(data.ffprobe);
      if (
        !video?.addTextTrack ||
        !streams.length ||
        data.subtitles?.length ||
        !/^https?:/.test(source) ||
        /\.m3u8(?:[?#]|$)/i.test(source)
      )
        return;
      if (!data.torrent_hash && !/\.mkv(?:[?#]|$)/i.test(source)) return;
      if (video.textTracks?.length) return;
      session = attachVideo(video, streams, electronAPI.subtitles, (message) =>
        Lampa.Noty.show(message),
      );
      Lampa.PlayerVideo.listener.send("subs", { subs: session.entries });
    });
  }
  return { install, attachVideo, VttParser, subtitleStreams };
});
