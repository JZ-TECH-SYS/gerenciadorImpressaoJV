// core/impressora/imprimirHtml.js
import { BrowserWindow } from 'electron';

export default async function imprimirHTML({
  msg,
  printerName,
  widthPx = 576,
  silent = true
}) {
  if (!printerName) throw new Error('Nome da impressora não informado');

  console.log(`[PRINT] Imprimindo "${printerName}" → ${msg.length} caracteres`);

  console.log(`[PRINT] ${msg}`);
  // 1) Cria janela oculta e carrega HTML
  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: 1000,
    webPreferences: { sandbox: false }
  });
  console.log(`[PRINT] Carregando HTML para "${printerName}"`);
  await win.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(msg)
  );

  
  // 3) Envia para impressão (silent = true → sem diálogo)
  return new Promise((resolve, reject) => {
    win.webContents.print(
      {
        silent,
        deviceName: printerName, // só faz diferença se silent:false no macOS
        margins: { marginType: 'none' }
      },
      (success, failureReason) => {
        console.log(
          `[PRINT] ${success ? 'OK' : 'FALHOU'} → "${printerName}"`,
          failureReason || ''
        );
        win.close();
        success ? resolve() : reject(new Error(failureReason || 'Erro'));
      }
    );
  });
}
