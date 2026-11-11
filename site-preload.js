const { contextBridge, ipcRenderer } = require('electron');

// This preload is attached to every tab, so it must expose nothing to normal
// websites. Only Aeroium's own local start page (file:) gets the small API.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('aeroium', {
    applyTheme: (theme) => ipcRenderer.send('apply-theme', theme),
    showNotification: (message) => ipcRenderer.send('show-notification', message),
    getI18n: () => ipcRenderer.invoke('get-i18n')
  });
}
