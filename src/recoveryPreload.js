const { contextBridge, ipcRenderer } = require("electron");

// The recovery window gets only these narrow actions; it is not a remote
// Lampa page and has no privileged general-purpose store bridge.
contextBridge.exposeInMainWorld("recoveryAPI", {
  tryUrl: (url) => ipcRenderer.invoke("lampa-recovery-try-url", url),
  onState: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("lampa-recovery-state", listener);
    return () => ipcRenderer.removeListener("lampa-recovery-state", listener);
  },
});
