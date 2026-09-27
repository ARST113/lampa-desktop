function openConsole(window) {
  if (!window || window.isDestroyed()) return;
  const contents = window.webContents;
  if (!contents.isDevToolsOpened()) contents.openDevTools({ mode: "detach" });
}

function setupDevTools(window) {
  window.webContents.on("before-input-event", (event, input) => {
    const shortcut =
      input.key === "F12" ||
      ((input.control || input.meta) &&
        input.shift &&
        input.key.toLowerCase() === "i");
    if (!shortcut || input.alt) return;
    event.preventDefault();
    if (input.type !== "keyDown" || input.isAutoRepeat) return;
    if (window.webContents.isDevToolsOpened())
      window.webContents.closeDevTools();
    else openConsole(window);
  });
}

module.exports = { openConsole, setupDevTools };
