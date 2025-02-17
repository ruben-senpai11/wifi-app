// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  receive: (channel, callback) => {
    ipcRenderer.on(channel, (event, data) => callback(data));
  },
});
