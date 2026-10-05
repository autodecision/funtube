const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('funtube', {
  channels: () => ipcRenderer.invoke('funtube:channels'),
  feed: (ids) => ipcRenderer.invoke('funtube:feed', ids),
  settings: () => ipcRenderer.invoke('funtube:settings'),
  saveKeys: (keys) => ipcRenderer.invoke('funtube:save-keys', keys),
  allChannels: () => ipcRenderer.invoke('funtube:all-channels'),
  addChannel: (input) => ipcRenderer.invoke('funtube:add-channel', input),
  updateChannel: (input) => ipcRenderer.invoke('funtube:update-channel', input),
  removeChannel: (id) => ipcRenderer.invoke('funtube:remove-channel', id),
});
