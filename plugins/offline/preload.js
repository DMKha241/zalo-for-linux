// Copied into preload-render.js by patch-offline-startup.js.
(() => {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('__zaloOfflineStorage', {
    read: () => ipcRenderer.invoke('linux-offline:read'),
    write: record => ipcRenderer.invoke('linux-offline:write', record),
    clear: () => ipcRenderer.invoke('linux-offline:clear'),
    refresh: () => ipcRenderer.invoke('linux-offline:refresh')
  });
})();
