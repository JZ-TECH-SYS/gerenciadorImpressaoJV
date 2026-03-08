// core/impressora/imprimirHtml.js
const { BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { info, debug, warn, error, logImpressao } = require('../utils/logger');
const windowsJobMonitor = require('../utils/windowsJobMonitor');

const PRINT_TIMEOUT_MS = 30000; // 30s max por impressao
const CRASH_LOG_PATH = path.join(os.tmpdir(), 'jv-printer', 'logs', 'crash.log');

/** Grava log sincrono de emergencia (sobrevive a crash) */
function emergencyLog(type, data) {
  try {
    const dir = path.dirname(CRASH_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: type,
      ...data
    }) + os.EOL;
    fs.appendFileSync(CRASH_LOG_PATH, line, 'utf8');
  } catch (_e) { /* melhor esforco */ }
}

const isWindows = os.platform() === 'win32';

// ── Fila de impressão serializada (Linux) ─────────────────────────
// Garante que jobs são processados um por vez, na ordem de chegada.
// Essencial para escrita direta na porta USB (/dev/usb/lp*) onde
// não existe spooler — se mandar dois ao mesmo tempo, mistura dados.
const printQueue = [];
let printBusy = false;

async function processPrintQueue() {
  if (printBusy) return;
  printBusy = true;

  while (printQueue.length > 0) {
    const job = printQueue.shift();
    try {
      const result = await job.execute();
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    }
  }

  printBusy = false;
}

function enqueuePrintJob(execute) {
  return new Promise((resolve, reject) => {
    printQueue.push({ execute, resolve, reject });
    processPrintQueue();
  });
}
// ──────────────────────────────────────────────────────────────────

// ── Comandos ESC/POS ──────────────────────────────────────────────
const ESC = '\x1B';
const GS  = '\x1D';

const ESCPOS = {
  INIT:         `${ESC}\x40`,           // reset impressora
  CENTER:       `${ESC}\x61\x01`,       // alinhamento centralizado
  LEFT:         `${ESC}\x61\x00`,       // alinhamento esquerda
  BOLD_ON:      `${ESC}\x45\x01`,       // negrito liga
  BOLD_OFF:     `${ESC}\x45\x00`,       // negrito desliga
  FONT_A:       `${ESC}\x4D\x00`,       // Font A (12x24, padrão)
  FONT_B:       `${ESC}\x4D\x01`,       // Font B (9x17, menor)
  DOUBLE_WH:    `${GS}\x21\x11`,        // largura + altura dupla
  DOUBLE_H:     `${GS}\x21\x01`,        // altura dupla
  DOUBLE_W:     `${GS}\x21\x10`,        // largura dupla
  NORMAL:       `${GS}\x21\x00`,        // tamanho normal
  LINE_TIGHT:   `${ESC}\x33\x14`,       // espaçamento compacto (20 dots)
  LINE_DEFAULT: `${ESC}\x32`,           // espaçamento padrão
  FEED2:        `${ESC}\x64\x02`,       // avança 2 linhas
  CUT:          `${GS}\x56\x42\x00`,    // corte parcial do papel
};

const SEP_LINE = '-'.repeat(42);

/**
 * Remove acentos para compatibilidade com code page padrão das impressoras térmicas.
 */
function stripAccents(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Escapa valores para uso seguro em shells POSIX (bash, dash, sh).
 */
function shellEscapePosix(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Lista device files de impressoras USB existentes no Linux.
 * Retorna caminhos como /dev/usb/lp0, /dev/usb/lp1, etc.
 */
function findLinuxUsbDevices() {
  const devices = [];
  for (let i = 0; i < 4; i++) {
    const devicePath = `/dev/usb/lp${i}`;
    try {
      fs.accessSync(devicePath, fs.constants.F_OK);
      devices.push(devicePath);
    } catch {
      // device não existe
    }
  }
  return devices;
}

/**
 * Escreve dados binários diretamente no device USB.
 * Bypassa CUPS completamente — impressão instantânea.
 */
function writeToUsbDevice(devicePath, data) {
  const fd = fs.openSync(devicePath, 'w');
  try {
    fs.writeSync(fd, data, 0, data.length);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Verifica se a impressora CUPS é USB via lpstat -v.
 */
async function isUsbPrinter(printerName) {
  try {
    const { stdout } = await execPromise(`lpstat -v ${shellEscapePosix(printerName)}`, { timeout: 5000 });
    return /usb:\/\//i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Converte HTML para texto formatado com comandos ESC/POS para impressoras térmicas.
 * Usa fonte maior (double height), negrito, centralização e corte de papel.
 */
function htmlParaTexto(html, largura = 48) {
  // Remove scripts e styles
  let texto = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Processa tags de formatação
  // Centralização - adiciona espaços para centralizar
  texto = texto.replace(/<([^>]+)style="[^"]*text-align:\s*center[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi, (match, tag, content) => {
    const linhas = content.replace(/<[^>]+>/g, '').split('\n');
    return linhas.map(linha => {
      linha = linha.trim();
      const espacos = Math.max(0, Math.floor((largura - linha.length) / 2));
      return ' '.repeat(espacos) + linha;
    }).join('\n');
  });
  
  // Converte tags para texto
  texto = texto
    // Títulos e negrito - mantém em maiúsculas para destaque
    .replace(/<(h[1-3]|strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (match, tag, content) => {
      return content.replace(/<[^>]+>/g, '').toUpperCase();
    })
    // <br> para quebra de linha
    .replace(/<br\s*\/?>/gi, '\n')
    // </p>, </div>, </tr>, </li> para quebra de linha
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    // <hr> para linha de separação
    .replace(/<hr[^>]*>/gi, '\n' + '-'.repeat(largura) + '\n')
    // <td> para tabulação/espaço
    .replace(/<td[^>]*>/gi, '  ')
    // Remove todas as outras tags
    .replace(/<[^>]+>/g, '')
    // Decodifica entidades HTML
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&copy;/gi, '(c)')
    .replace(/&reg;/gi, '(R)')
    .replace(/&#(\d+);/gi, (match, dec) => String.fromCharCode(dec))
    // Normaliza espaços e quebras
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    // Trim cada linha
    .split('\n')
    .map(linha => linha.trim())
    .filter((linha, i, arr) => linha || (i > 0 && arr[i-1])) // Remove linhas vazias consecutivas
    .join('\n')
    .trim();
  
  return texto;
}

/**
 * Converte texto puro em dados ESC/POS com fonte grande, negrito e corte de papel.
 * Cada linha é impressa em double height para melhor legibilidade.
 */
function wrapTextoComEscPos(textoPlano) {
  const linhas = textoPlano.split('\n');
  const partes = [];

  // Inicializa impressora + espaçamento compacto + negrito
  partes.push(ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.LINE_TIGHT + ESCPOS.BOLD_ON);

  for (const linha of linhas) {
    const stripped = stripAccents(linha);

    // Detecta se é uma linha separadora
    if (/^[-=]{5,}$/.test(stripped.trim())) {
      partes.push(ESCPOS.CENTER + ESCPOS.NORMAL + SEP_LINE + ESCPOS.DOUBLE_H);
      continue;
    }

    // Linha vazia = pula
    if (!stripped.trim()) {
      partes.push('');
      continue;
    }

    // Imprime em double height (fonte maior, legível)
    partes.push(ESCPOS.CENTER + ESCPOS.DOUBLE_H + stripped);
  }

  // Finaliza: remove negrito, espaçamento padrão, avança e corta
  partes.push(ESCPOS.NORMAL + ESCPOS.BOLD_OFF + ESCPOS.LINE_DEFAULT);
  partes.push(ESCPOS.FEED2 + ESCPOS.FEED2 + ESCPOS.CUT);

  return partes.join('\n');
}

/**
 * Imprime no Linux com cadeia de fallbacks:
 * 1. Escrita direta no device USB (/dev/usb/lp0) — mais rápido
 * 2. lp -d "impressora" -o raw — via CUPS mas em modo raw
 * 3. lpr -P "impressora" -l — alternativa CUPS
 */
async function imprimirLinux(dadosEscPos, printerName) {
  const tmpFile = path.join(os.tmpdir(), `jv-print-${Date.now()}.bin`);

  try {
    // Salva como binário (não UTF-8) para preservar comandos ESC/POS
    fs.writeFileSync(tmpFile, dadosEscPos, 'binary');
    const ticketData = fs.readFileSync(tmpFile);

    const safePrinter = shellEscapePosix(printerName);
    const safeTmpFile = shellEscapePosix(tmpFile);

    // Monta lista de tentativas
    const attempts = [];

    if (printerName.startsWith('/dev/')) {
      // Usuário selecionou device direto
      attempts.push({ type: 'device-direct', devicePath: printerName });
    } else {
      // Tenta descobrir devices USB
      const usbDevices = findLinuxUsbDevices();
      const isUsb = usbDevices.length > 0 || await isUsbPrinter(printerName);

      if (isUsb) {
        for (const devicePath of usbDevices) {
          attempts.push({ type: 'device-direct', devicePath });
        }
      }

      // Fallbacks CUPS
      attempts.push(
        { type: 'lp', command: `lp -d ${safePrinter} -o raw ${safeTmpFile}` },
        { type: 'lpr', command: `lpr -P ${safePrinter} -l ${safeTmpFile}` }
      );
    }

    let lastError;

    for (const attempt of attempts) {
      try {
        if (attempt.devicePath) {
          // Escrita direta no device USB (bypassa CUPS — instantâneo)
          writeToUsbDevice(attempt.devicePath, ticketData);
        } else if (attempt.command) {
          await execPromise(attempt.command, { timeout: 15000 });
        }

        const jobId = `native_${Date.now()}`;
        const method = attempt.devicePath || attempt.type;

        info('Impressão Linux enviada com sucesso', {
          metadata: { impressora: printerName, metodo: method, jobId }
        });

        return { success: true, jobId, source: method };
      } catch (err) {
        lastError = err;
        warn(`Tentativa ${attempt.type} falhou no Linux`, {
          metadata: { impressora: printerName, metodo: attempt.devicePath || attempt.type, erro: err.message }
        });
      }
    }

    throw lastError || new Error('Falha ao imprimir no Linux. Verifique se o CUPS está instalado e a impressora configurada.');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
}

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
    metadata: { impressora: printerName, tamanho: msg.length, tipo: 'html', plataforma: isWindows ? 'windows' : 'linux' }
  });

  // ============ LINUX: Usa ESC/POS direto (rápido + corte de papel) ============
  // Enfileira para garantir que um job só começa após o anterior terminar
  if (!isWindows) {
    return enqueuePrintJob(async () => {
      info('Linux detectado - usando impressão ESC/POS direta', {
        metadata: { impressora: printerName }
      });
      
      // Converte HTML → texto puro → ESC/POS com fonte grande + corte
      const textoPlano = htmlParaTexto(msg);
      const dadosEscPos = wrapTextoComEscPos(textoPlano);
      
      debug('HTML convertido para ESC/POS', {
        metadata: { 
          tamanhoOriginal: msg.length, 
          tamanhoEscPos: dadosEscPos.length,
          preview: textoPlano.substring(0, 200) + '...'
        }
      });
      
      const resultado = await imprimirLinux(dadosEscPos, printerName);
      logImpressao(printerName, textoPlano, resultado.jobId);
      
      info('Impressão Linux concluída', {
        metadata: { impressora: printerName, jobId: resultado.jobId, metodo: resultado.source }
      });
      
      return resultado;
    });
  }

  // ============ WINDOWS: Usa Electron webContents.print() ============
  
  // Análise do HTML antes de carregar
  const temImagem = msg.includes('data:image');
  const temQRCode = msg.toLowerCase().includes('qr code');
  const posicaoImagem = msg.indexOf('data:image');
  const previewImagem = temImagem ? msg.substring(posicaoImagem, posicaoImagem + 150) : 'sem imagem';

  info('Analisando conteúdo HTML antes de carregar', {
    metadata: { 
      impressora: printerName,
      tamanhoHtml: msg.length,
      temImagem,
      temQRCode,
      posicaoImagem: temImagem ? posicaoImagem : 'N/A',
      previewImagem
    }
  });

  info('Carregando conteúdo HTML no BrowserWindow', {
    metadata: { 
      impressora: printerName,
      conteudoOriginal: msg.substring(0, 300) + '...'
    }
  });

  // Log sincrono ANTES de criar a janela — se crashar aqui, pelo menos temos evidencia
  emergencyLog('PRINT_ATTEMPT', {
    impressora: printerName,
    tamanhoHtml: msg.length,
    temImagem,
    temQRCode,
    pid: process.pid
  });

  let win;
  try {
    win = new BrowserWindow({
      show: false,
      width: widthPx,
      height: 1000,
      webPreferences: { sandbox: false }
    });
  } catch (winErr) {
    error('Falha ao criar BrowserWindow para impressao', {
      metadata: { impressora: printerName, error: winErr.message, stack: winErr.stack }
    });
    emergencyLog('PRINT_FAIL_CREATE_WIN', { impressora: printerName, error: winErr.message });
    throw new Error(`Falha ao criar janela de impressao: ${winErr.message}`);
  }

  function safeCloseWin() {
    try {
      if (win && !win.isDestroyed()) win.close();
    } catch (_e) { /* janela ja fechada */ }
  }

  // Handler para crash do renderer desta janela especifica
  let rendererCrashed = false;
  win.webContents.on('render-process-gone', (_event, details) => {
    rendererCrashed = true;
    const crashInfo = {
      impressora: printerName,
      reason: details.reason,
      exitCode: details.exitCode,
      tamanhoHtml: msg.length,
      temImagem,
      temQRCode
    };
    error('CRASH RENDERER durante impressao — processo de renderizacao morreu', {
      metadata: crashInfo
    });
    emergencyLog('CRASH_RENDERER_PRINT', crashInfo);
    safeCloseWin();
  });

  // Handler para crash do webContents (evento legado, mas ainda util)
  win.webContents.on('crashed', (_event, killed) => {
    if (rendererCrashed) return; // ja tratado acima
    rendererCrashed = true;
    const crashInfo = {
      impressora: printerName,
      killed,
      tamanhoHtml: msg.length
    };
    error('webContents CRASHED durante impressao', {
      metadata: crashInfo
    });
    emergencyLog('CRASH_WEBCONTENTS_PRINT', crashInfo);
    safeCloseWin();
  });

  try {
    await win.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(msg)
    );
  } catch (loadErr) {
    error('Falha ao carregar HTML no BrowserWindow', {
      metadata: { impressora: printerName, error: loadErr.message, stack: loadErr.stack, tamanhoHtml: msg.length }
    });
    emergencyLog('PRINT_FAIL_LOAD', { impressora: printerName, error: loadErr.message, tamanhoHtml: msg.length });
    safeCloseWin();
    throw new Error(`Falha ao carregar HTML para impressao: ${loadErr.message}`);
  }

  // Se o renderer ja crashou durante o loadURL
  if (rendererCrashed) {
    throw new Error('Renderer crashou ao carregar HTML para impressao. Verifique crash.log para detalhes.');
  }

  info('HTML carregado com sucesso no BrowserWindow', {
    metadata: { 
      impressora: printerName,
      tamanho: msg.length,
      temImagem,
      temQRCode
    }
  });

  emergencyLog('PRINT_SENDING', { impressora: printerName, fase: 'webContents.print' });

  return new Promise((resolve, reject) => {
    let settled = false;

    // Timeout de seguranca — se nada acontecer em 30s, rejeita e limpa
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const msg = `Timeout de ${PRINT_TIMEOUT_MS}ms na impressao para ${printerName}`;
      error(msg, { metadata: { impressora: printerName, timeout: PRINT_TIMEOUT_MS } });
      emergencyLog('PRINT_TIMEOUT', { impressora: printerName, timeout: PRINT_TIMEOUT_MS });
      safeCloseWin();
      reject(new Error(msg));
    }, PRINT_TIMEOUT_MS);

    // Se o renderer crashar durante o print, rejeita a promise
    const onRendererGone = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error('Renderer crashou durante impressao. Verifique crash.log.'));
    };
    win.webContents.once('render-process-gone', onRendererGone);
    win.webContents.once('crashed', onRendererGone);

    try {
      win.webContents.print(
        {
          silent,
          deviceName: printerName,
          margins: { marginType: 'none' }
        },
        async (success, failureReason) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);

          try {
            if (success) {
              info('HTML enviado para impressora com sucesso', {
                metadata: { impressora: printerName }
              });
              emergencyLog('PRINT_SUCCESS', { impressora: printerName });
              
              try {
                const windowsJobId = await windowsJobMonitor.waitForJobId(printerName, 3000);
                
                if (windowsJobId) {
                  logImpressao(printerName, msg, windowsJobId);
                  info('Job confirmado pelo Windows', {
                    metadata: { impressora: printerName, jobId: windowsJobId }
                  });
                  safeCloseWin();
                  resolve({ success: true, jobId: windowsJobId, source: 'windows' });
                } else {
                  const fallbackId = `CUSTOM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                  logImpressao(printerName, msg, fallbackId);
                  warn('Fallback de JobID apos tentativa pelo Windows', {
                    metadata: { impressora: printerName, jobId: fallbackId }
                  });
                  safeCloseWin();
                  resolve({ success: true, jobId: fallbackId, source: 'fallback' });
                }
              } catch (jobErr) {
                warn('Erro ao buscar Job ID do Windows', {
                  metadata: { impressora: printerName, error: jobErr.message }
                });
                const fallbackId = `ERROR_${Date.now()}`;
                logImpressao(printerName, msg, fallbackId);
                safeCloseWin();
                resolve({ success: true, jobId: fallbackId, source: 'error' });
              }
            } else {
              const erro = failureReason || 'Erro desconhecido na impressao';
              error('Falha ao imprimir HTML', {
                metadata: { impressora: printerName, erro }
              });
              emergencyLog('PRINT_FAIL', { impressora: printerName, erro });
              safeCloseWin();
              reject(new Error(erro));
            }
          } catch (callbackErr) {
            error('Erro inesperado no callback de impressao', {
              metadata: { impressora: printerName, error: callbackErr.message, stack: callbackErr.stack }
            });
            emergencyLog('PRINT_CALLBACK_ERROR', { impressora: printerName, error: callbackErr.message });
            safeCloseWin();
            reject(callbackErr);
          }
        }
      );
    } catch (printErr) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      error('Erro ao chamar webContents.print()', {
        metadata: { impressora: printerName, error: printErr.message, stack: printErr.stack }
      });
      emergencyLog('PRINT_CALL_ERROR', { impressora: printerName, error: printErr.message });
      safeCloseWin();
      reject(printErr);
    }
  });
}

module.exports = imprimirHTML;
