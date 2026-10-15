# Native GStreamer DTS experiment

This branch implements a standalone Node-API GStreamer DTS-to-PCM decoder. It does not require a second TorrServer, FFmpeg for decoding, a local HTTP listener, or custom Electron builds.

Build prerequisites: GStreamer development libraries, gstreamer-app-1.0, matroskademux and an installed DTS decoder plugin (for example avdec_dca).

Public API: start(source, audioOrdinal, pcmCallback); pause(bool); seek(seconds); stats(); stop().

Input: local absolute MKV or remote HTTP(S) MKV. The GStreamer caps enforce DTS-only processing. PCM output is stereo 48 kHz floating point, interleaved (F32LE). JS receives buffers asynchronously.

GitHub Actions compiles a real native module and decodes a generated DTS fixture to non-silent PCM. The test confirms decoding and teardown, not yet playback inside the HTML5 video element.

Not yet implemented: automatic activation from Lampa.PlayerVideo, audio/video synchronization, HDR/Dolby Vision validation, cross-platform packaging/bundling of GStreamer and codecs, audio track mapping, and reliable seek tests. Existing Lampa playback remains unchanged.

Licenses of the GStreamer plugins, particularly any libdca/GPL codecs, must be reviewed before distribution.
