# Native GStreamer DTS experiment

This branch implements a standalone Node-API GStreamer DTS-to-PCM decoder. It does not require a second TorrServer, FFmpeg for decoding, a local HTTP listener, or custom Electron builds.

Build prerequisites: GStreamer development libraries, gstreamer-app-1.0, matroskademux and an installed DTS decoder plugin (for example avdec_dca).

Public API: start(source, audioOrdinal, pcmCallback, channels=2); pause(bool); seek(seconds); stats(); stop().

Input: local absolute MKV or remote HTTP(S) MKV. The GStreamer caps enforce DTS-only processing. PCM output is 48 kHz floating point, interleaved (F32LE), with a choice of 2 or 6 channels. JS receives buffers asynchronously.

GitHub Actions compiles a real native module and decodes generated DTS stereo and DTS 5.1 fixtures to non-silent PCM on Linux x64 and Linux arm64. The test confirms decoding and teardown, not yet playback inside the HTML5 video element.

Not yet implemented: automatic activation from Lampa.PlayerVideo, audio/video synchronization, HDR/Dolby Vision validation, cross-platform packaging/bundling of GStreamer and codecs, audio track mapping, and reliable seek tests. Existing Lampa playback remains unchanged.

Licenses of the GStreamer plugins, particularly any libdca/GPL codecs, must be reviewed before distribution.

## Windows and macOS CI

An additional GitHub Actions workflow runs the same real DTS stereo/5.1 native decoding tests on Windows x64 (MSVC/GStreamer 1.26.11), macOS x64 and macOS arm64. It does not recompile Electron.

The Windows job uses official GStreamer MSVC runtime/development installers with SHA256 verification. macOS jobs use Homebrew packages and compile for the local runner architecture. These jobs validate a native Node-API decoder against the host Node runtime, **not yet packaging inside Electron**.

For a production package, bundle the correct native GStreamer libraries/plugins, honor dynamic library search-path and code-signing constraints, build the Node-API module per target, then validate the actual Electron loading and A/V integration.
