// core/impressora/imprimirHtml.js
const { BrowserWindow } = require('electron');
const path = require('path');
const { log } = require('../utils/logger');

async function imprimirHTML({
  msg,
  printerName,
  widthPx = 576,
  silent = true
}) {
  if (!printerName) throw new Error('Nome da impressora não informado');

  log(`[PRINT] Imprimindo "${printerName}" → ${msg.length} caracteres`);
  log(`[PRINT] ${msg}`);

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

  return new Promise((resolve, reject) => {
    win.webContents.print(
      {
        silent,
        deviceName: printerName,
        margins: { marginType: 'none' }
      },
      (success, failureReason) => {
        log(
          `[PRINT] ${success ? 'OK' : 'FALHOU'} → "${printerName}"` +
          failureReason || ''
        );
        win.close();
        if (success) {
          resolve();
        } else {
          const err = new Error(failureReason || 'Erro');
          log(err);
          reject(err);
        }
      }
    );
  });
}

module.exports = imprimirHTML;
