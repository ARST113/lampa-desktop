// Electron's Chromium network stack avoids the Node.js bundled Undici parser.
// Node 24's global fetch can crash the main process on a paused HTTP/1 parser
// when a peer closes its connection (nodejs/undici#5360).
const { app, net } = require("electron");

async function electronNetFetch(input, options = {}) {
  if (!app.isReady()) {
    throw new Error("Electron network requests require app.whenReady()");
  }
  // Keep the custom http(s) handler (subtitle observation and OPTIONS)
  // out of control-plane requests, preventing recursive interception.
  const abort = new AbortController();
  // protocol.handle does not report renderer cancellation before headers.
  // Bound that orphaned request without putting a deadline on video playback.
  const headersTimeout = setTimeout(
    () =>
      abort.abort(
        new DOMException("Server response timed out", "TimeoutError"),
      ),
    30000,
  );
  headersTimeout.unref();
  let response;
  try {
    response = await net.fetch(input, {
      ...options,
      signal: AbortSignal.any(
        [abort.signal, input?.signal, options.signal].filter(Boolean),
      ),
      bypassCustomProtocolHandlers: true,
    });
  } finally {
    clearTimeout(headersTimeout);
  }
  if (!response.body) return response;

  // Cancelling Electron's response reader alone destroys the IncomingMessage,
  // but leaves its ClientRequest/socket alive. Abort that request explicitly
  // when protocol.handle's consumer stops playback or cancels a preload.
  const reader = response.body.getReader();
  let finished = false;
  const body = new ReadableStream(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (finished) return;
          if (done) {
            finished = true;
            reader.releaseLock();
            controller.close();
          } else controller.enqueue(value);
        } catch (error) {
          if (!finished) {
            finished = true;
            reader.releaseLock();
            controller.error(error);
          }
          abort.abort(error);
        }
      },
      async cancel(reason) {
        finished = true;
        abort.abort(reason);
        await reader.cancel(reason).catch(() => {});
        reader.releaseLock();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

module.exports = { electronNetFetch };
