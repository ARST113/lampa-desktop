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

The Windows job builds a genuine Windows x64 Node-API binary using the MSYS2 UCRT64 GStreamer packages and MSYS2 Node.js (the upstream MSVC MSI download was unreliable in GitHub Actions). macOS jobs use Homebrew's merged GStreamer formula and compile for the local Intel or Apple Silicon runner architecture. These tests validate decoding under each job's native Node environment, **not yet loading the module in Electron or bundling it with the app**. The MSYS2 Windows binary links against its own libnode.dll; stock Electron compatibility requires a separate build/load test.

For a production package, bundle the correct native GStreamer libraries/plugins, honor dynamic library search-path and code-signing constraints, build the Node-API module per target, then validate the actual Electron loading and A/V integration.
