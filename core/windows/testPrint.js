// core/windows/testPrint.js
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const imprimirHTML = require('../impressora/imprimirHtml');
const listarImpressoras = require('../impressora/listarImpressoras');
const { info, warn, error } = require('../utils/logger');

const store = new Store();
let testPrintWindow = null;
let handlersRegistered = false;

// Registrar handlers IPC apenas uma vez
function registerHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('testPrint:getPrinters', async () => {
    try {
      info('[TEST-PRINT] Solicitando lista de impressoras', {
        metadata: { area: 'testPrint' }
      });
      const result = await listarImpressoras();
      info('[TEST-PRINT] Resultado listarImpressoras', {
        metadata: { status: result.status, total: result.data?.length ?? 0 }
      });
      
      // listarImpressoras retorna { status, acao, data: [] }
      if (result.status === 'success' && Array.isArray(result.data)) {
        info('[TEST-PRINT] Impressoras encontradas', {
          metadata: { total: result.data.length }
        });
        return result.data;
      }
      
      warn('[TEST-PRINT] Nenhuma impressora encontrada ou erro no formato', {
        metadata: { status: result.status }
      });
      return [];
    } catch (error) {
      error('[TEST-PRINT] Erro ao listar impressoras', {
        metadata: { error }
      });
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
      
      info('[TEST-PRINT] Impressão de teste concluída', {
        metadata: { jobId: result.jobId, fonte: result.source }
      });
      return {
        success: true,
        jobId: result.jobId,
        source: result.source
      };
    } catch (error) {
      error('[TEST-PRINT] Falha ao imprimir conteúdo de teste', {
        metadata: { error }
      });
      return {
        success: false,
        error: error.message
      };
    }
  });
}

function createTestPrint() {
  // Registrar handlers na primeira vez
  registerHandlers();

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

module.exports = { createTestPrint };
