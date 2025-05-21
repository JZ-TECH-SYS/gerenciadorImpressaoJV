const fs = require('fs');
const path = require('path');
const os = require('os');
const { contextBridge, ipcRenderer } = require('electron');

const LOG_DIR = path.join(os.tmpdir(), 'jv-printer', 'logs');

contextBridge.exposeInMainWorld('api', {
  listLogs: () => {
    try {
      return fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
    } catch {
      return [];
    }
  },
  readLogFile: (filename) => {
    try {
      return fs.readFileSync(path.join(LOG_DIR, filename), 'utf8');
    } catch {
      return 'Erro ao carregar log.';
    }
  }
});
