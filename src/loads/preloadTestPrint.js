// src/loads/preloadTestPrint.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('testPrint', {
  getPrinters: () => ipcRenderer.invoke('testPrint:getPrinters'),
  getDefaultPrinter: () => ipcRenderer.invoke('testPrint:getDefaultPrinter'),
  print: (printer, content) => ipcRenderer.invoke('testPrint:print', { printer, content })
});
