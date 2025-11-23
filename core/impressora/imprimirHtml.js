// core/impressora/imprimirHtml.js
const { BrowserWindow } = require('electron');
const path = require('path');
const { info, debug, warn, error, logImpressao } = require('../utils/logger');
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
  info('Iniciando impressão HTML', {
    metadata: { impressora: printerName, tamanho: msg.length, tipo: 'html' }
  });
  debug('HTML preparado para impressão', {
    metadata: {
      impressora: printerName,
      snippet: msg.length > 400 ? `${msg.slice(0, 400)}...` : msg
    }
  });

  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: 1000,
    webPreferences: { sandbox: false }
  });

  info('Carregando conteúdo HTML no BrowserWindow', {
    metadata: { impressora: printerName }
  });

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
          info('HTML enviado para impressora com sucesso', {
            metadata: { impressora: printerName }
          });
          
          try {
            const windowsJobId = await windowsJobMonitor.waitForJobId(printerName, 3000);
            
            if (windowsJobId) {
              logImpressao(printerName, msg, windowsJobId);
              info('Job confirmado pelo Windows', {
                metadata: { impressora: printerName, jobId: windowsJobId }
              });
              win.close();
              resolve({ success: true, jobId: windowsJobId, source: 'windows' });
            } else {
              // Fallback para ID customizado se não conseguir pegar do Windows
              const fallbackId = `CUSTOM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              logImpressao(printerName, msg, fallbackId);
              warn('Fallback de JobID após tentativa pelo Windows', {
                metadata: { impressora: printerName, jobId: fallbackId }
              });
              win.close();
              resolve({ success: true, jobId: fallbackId, source: 'fallback' });
            }
          } catch (error) {
            warn('Erro ao buscar Job ID do Windows', {
              metadata: { impressora: printerName, error }
            });
            const fallbackId = `ERROR_${Date.now()}`;
            logImpressao(printerName, msg, fallbackId);
            win.close();
            resolve({ success: true, jobId: fallbackId, source: 'error' });
          }
        } else {
          const erro = failureReason || 'Erro desconhecido na impressão';
          error('Falha ao imprimir HTML', {
            metadata: { impressora: printerName, erro }
          });
          win.close();
          reject(new Error(erro));
        }
      }
    );
  });
}

module.exports = imprimirHTML;
