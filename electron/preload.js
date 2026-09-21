const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  notifyReady: () => ipcRenderer.send('panels-ready'),
});
