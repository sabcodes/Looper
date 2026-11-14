const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('beats', {
  info: () => ipcRenderer.invoke('beats:info'),
  preview: (request) => ipcRenderer.invoke('beats:preview', request),
  suggest: (request) => ipcRenderer.invoke('beats:suggest', request),
  generate: (request) => ipcRenderer.invoke('beats:generate', request),
  inspectScore: (source) => ipcRenderer.invoke('beats:inspect-score', { source }),
  audition: (request) => ipcRenderer.invoke('beats:audition', request),
  renderEdit: (request) => ipcRenderer.invoke('beats:render-edit', request),
  library: () => ipcRenderer.invoke('beats:library'),
  reveal: (name) => ipcRenderer.invoke('beats:reveal', name),
  onStage: (callback) => {
    const listener = (_event, stage) => callback(stage);
    ipcRenderer.on('beats:stage', listener);
    return () => ipcRenderer.removeListener('beats:stage', listener);
  },
});
