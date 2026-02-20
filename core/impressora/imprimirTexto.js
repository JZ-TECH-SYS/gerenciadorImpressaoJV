const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

const verificarCompartilhamento = require("./verificarCompartilhamento");
const { gerarNomeUnico } = require("../utils/gerarNomeUnico");
const { warn, error, info } = require("../utils/logger");

const isWindows = os.platform() === "win32";

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
  INIT:         `${ESC}\x40`,
  CENTER:       `${ESC}\x61\x01`,
  LEFT:         `${ESC}\x61\x00`,
  BOLD_ON:      `${ESC}\x45\x01`,
  BOLD_OFF:     `${ESC}\x45\x00`,
  FONT_A:       `${ESC}\x4D\x00`,
  DOUBLE_H:     `${GS}\x21\x01`,
  NORMAL:       `${GS}\x21\x00`,
  LINE_TIGHT:   `${ESC}\x33\x14`,
  LINE_DEFAULT: `${ESC}\x32`,
  FEED2:        `${ESC}\x64\x02`,
  CUT:          `${GS}\x56\x42\x00`,
};

const SEP_LINE = '-'.repeat(42);

function stripAccents(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function shellEscapePosix(value) {
  return "'" + value.replace(/'/g, "'\\\\'") + "'";
}

/**
 * Envolve texto puro com comandos ESC/POS: fonte grande, negrito e corte de papel.
 */
function wrapTextoComEscPos(msg) {
  const linhas = msg.split('\n');
  const partes = [];

  partes.push(ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.LINE_TIGHT + ESCPOS.BOLD_ON);

  for (const linha of linhas) {
    const stripped = stripAccents(linha);
    if (/^[-=]{5,}$/.test(stripped.trim())) {
      partes.push(ESCPOS.CENTER + ESCPOS.NORMAL + SEP_LINE + ESCPOS.DOUBLE_H);
      continue;
    }
    if (!stripped.trim()) {
      partes.push('');
      continue;
    }
    partes.push(ESCPOS.CENTER + ESCPOS.DOUBLE_H + stripped);
  }

  partes.push(ESCPOS.NORMAL + ESCPOS.BOLD_OFF + ESCPOS.LINE_DEFAULT);
  partes.push(ESCPOS.FEED2 + ESCPOS.FEED2 + ESCPOS.CUT);

  return partes.join('\n');
}

/**
 * Lista device files de impressoras USB existentes no Linux.
 */
function findLinuxUsbDevices() {
  const devices = [];
  for (let i = 0; i < 4; i++) {
    const devicePath = `/dev/usb/lp${i}`;
    try {
      fs.accessSync(devicePath, fs.constants.F_OK);
      devices.push(devicePath);
    } catch { /* device não existe */ }
  }
  return devices;
}

/**
 * Escreve dados diretamente no device USB — impressão instantânea.
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

function imprimirTexto({ impressora, msg }) {
  return new Promise(async (resolve) => {
    if (!impressora || !msg) {
      warn('Impressora ou mensagem não informada', {
        metadata: { area: 'imprimirTexto', falta: !impressora ? 'impressora' : 'mensagem' }
      });
      return resolve({ status: "error", message: "Dados inválidos" });
    }

    // Verificação de compartilhamento só no Windows
    if (isWindows) {
      const compartilhada = await verificarCompartilhamento(impressora);
      if (!compartilhada) {
        warn('Impressora não está compartilhada', {
          metadata: { area: 'imprimirTexto', impressora }
        });
        return resolve({ status: "error", message: "Impressora não compartilhada" });
      }
    }

    // ── Windows: comportamento original ──
    if (isWindows) {
      const filePath = path.join(os.tmpdir(), gerarNomeUnico("txt"));
      fs.writeFileSync(filePath, msg, "utf8");
      const comando = `copy "${filePath}" \\\\localhost\\"${impressora}"`;

      exec(comando, (operationError) => {
        if (operationError) {
          error('Erro ao enviar arquivo para impressora', {
            metadata: { error: operationError, impressora, plataforma: 'windows' }
          });
        }
      });

      info('Comando de impressão enviado para fila', {
        metadata: { impressora, arquivo: filePath, plataforma: 'windows' }
      });
      return resolve({ status: "success", message: "Impresso com sucesso", acao: "imprimir" });
    }

    // ── Linux: ESC/POS com fonte grande + corte + escrita direta USB ──
    // Enfileira para garantir que um job só começa após o anterior terminar
    const resultado = await enqueuePrintJob(async () => {
      const dadosEscPos = wrapTextoComEscPos(msg);
      const filePath = path.join(os.tmpdir(), gerarNomeUnico("bin"));
      fs.writeFileSync(filePath, dadosEscPos, 'binary');
      const ticketData = fs.readFileSync(filePath);

      const safePrinter = shellEscapePosix(impressora);
      const safeFile = shellEscapePosix(filePath);

      // Cadeia de tentativas: device USB direto → lp raw → lpr raw
      const attempts = [];

      if (impressora.startsWith('/dev/')) {
        attempts.push({ type: 'device-direct', devicePath: impressora });
      } else {
        const usbDevices = findLinuxUsbDevices();
        for (const dp of usbDevices) {
          attempts.push({ type: 'device-direct', devicePath: dp });
        }
        attempts.push(
          { type: 'lp', command: `lp -d ${safePrinter} -o raw ${safeFile}` },
          { type: 'lpr', command: `lpr -P ${safePrinter} -l ${safeFile}` }
        );
      }

      let success = false;
      for (const attempt of attempts) {
        try {
          if (attempt.devicePath) {
            writeToUsbDevice(attempt.devicePath, ticketData);
          } else {
            await execPromise(attempt.command, { timeout: 15000 });
          }
          info('Impressão Linux enviada com sucesso', {
            metadata: { impressora, metodo: attempt.devicePath || attempt.type }
          });
          success = true;
          break;
        } catch (err) {
          warn(`Tentativa ${attempt.type} falhou`, {
            metadata: { impressora, erro: err.message }
          });
        }
      }

      // Limpa arquivo temporário
      fs.unlink(filePath, () => {});

      if (success) {
        return { status: "success", message: "Impresso com sucesso", acao: "imprimir" };
      } else {
        return { status: "error", message: "Falha ao imprimir no Linux" };
      }
    });

    return resolve(resultado);
  });
}

module.exports = imprimirTexto;
