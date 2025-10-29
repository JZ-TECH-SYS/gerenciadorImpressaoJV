// core/windows/testPrint.js
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const imprimirHTML = require('../impressora/imprimirHtml');
const listarImpressoras = require('../impressora/listarImpressoras');

const store = new Store();
let testPrintWindow = null;

function createTestPrint() {
  if (testPrintWindow && !testPrintWindow.isDestroyed()) {
    testPrintWindow.focus();
    return;
  }

  testPrintWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Teste de Impressão - JV-Printer',
    icon: path.join(__dirname, '../../assets/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../../src/loads/preloadTestPrint.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  testPrintWindow.loadFile(path.join(__dirname, '../../assets/html/testePrint.html'));

  testPrintWindow.on('closed', () => {
    testPrintWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('testPrint:getPrinters', async () => {
  try {
    const result = await listarImpressoras();
    // listarImpressoras retorna { status, acao, data: [] }
    if (result.status === 'success' && Array.isArray(result.data)) {
      return result.data;
    }
    return [];
  } catch (error) {
    console.error('Erro ao listar impressoras:', error);
    return [];
  }
});

ipcMain.handle('testPrint:getDefaultPrinter', () => {
  return store.get('printer') || '';
});

ipcMain.handle('testPrint:print', async (_event, { printer, content }) => {
  try {
    const result = await imprimirHTML({
      msg: content,
      printerName: printer,
      silent: true
    });
    
    return {
      success: true,
      jobId: result.jobId,
      source: result.source
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

module.exports = { createTestPrint };
