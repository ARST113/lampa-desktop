// Electron's Chromium network stack avoids the Node.js bundled Undici parser.
// Node 24's global fetch can crash the main process on a paused HTTP/1 parser
// when a peer closes its connection (nodejs/undici#5360).
const { app, net } = require("electron");

function electronNetFetch(input, options = {}) {
  if (!app.isReady()) {
    throw new Error("Electron network requests require app.whenReady()");
  }
  // Keep the custom http(s) handler (subtitle observation and OPTIONS)
  // out of control-plane requests, preventing recursive interception.
  return net.fetch(input, {
    ...options,
    bypassCustomProtocolHandlers: true,
  });
}

module.exports = { electronNetFetch };
