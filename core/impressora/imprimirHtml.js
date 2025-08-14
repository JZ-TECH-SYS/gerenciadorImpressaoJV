// core/impressora/imprimirHtml.js
const { BrowserWindow } = require('electron');
const path = require('path');
const { log, logImpressao } = require('../utils/logger');
const windowsJobMonitor = require('../utils/windowsJobMonitor');

async function imprimirHTML({
  msg,
  printerName,
  widthPx = 576,
  silent = true
}) {
  if (!printerName) throw new Error('Nome da impressora não informado');

  // Log inicial da tentativa de impressão
  logImpressao(printerName, msg, null);
  log(`[PRINT] Imprimindo "${printerName}" → ${msg.length} caracteres`);
  log(`[PRINT-HTML] Conteúdo: ${msg}`);

  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: 1000,
    webPreferences: { sandbox: false }
  });

  log(`[PRINT] Carregando HTML para "${printerName}"`);

  await win.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(msg)
  );

  return new Promise(async (resolve, reject) => {
    win.webContents.print(
      {
        silent,
        deviceName: printerName,
        margins: { marginType: 'none' }
      },
      async (success, failureReason) => {
        if (success) {
          // Aguarda um pouco e tenta capturar o Job ID real do Windows
          log(`[PRINT] ✅ Enviado para impressora "${printerName}" - buscando Job ID...`);
          
          try {
            const windowsJobId = await windowsJobMonitor.waitForJobId(printerName, 3000);
            
            if (windowsJobId) {
              logImpressao(printerName, msg, windowsJobId);
              log(`[PRINT] ✅ SUCESSO → "${printerName}" | Windows JobID: ${windowsJobId}`);
              win.close();
              resolve({ success: true, jobId: windowsJobId, source: 'windows' });
            } else {
              // Fallback para ID customizado se não conseguir pegar do Windows
              const fallbackId = `CUSTOM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              logImpressao(printerName, msg, fallbackId);
              log(`[PRINT] ✅ SUCESSO → "${printerName}" | Fallback JobID: ${fallbackId}`);
              win.close();
              resolve({ success: true, jobId: fallbackId, source: 'fallback' });
            }
          } catch (error) {
            log(`[PRINT] ⚠️ Erro ao buscar Job ID: ${error.message}`);
            const fallbackId = `ERROR_${Date.now()}`;
            logImpressao(printerName, msg, fallbackId);
            win.close();
            resolve({ success: true, jobId: fallbackId, source: 'error' });
          }
        } else {
          const erro = failureReason || 'Erro desconhecido na impressão';
          log(`[PRINT] ❌ FALHOU → "${printerName}" | Erro: ${erro}`);
          win.close();
          reject(new Error(erro));
        }
      }
    );
  });
}

module.exports = imprimirHTML;
