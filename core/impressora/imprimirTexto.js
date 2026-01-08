const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");

const verificarCompartilhamento = require("./verificarCompartilhamento");
const { gerarNomeUnico } = require("../utils/gerarNomeUnico");
const { warn, error, info } = require("../utils/logger");

const isWindows = os.platform() === "win32";

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

    const filePath = path.join(os.tmpdir(), gerarNomeUnico("txt"));
    fs.writeFileSync(filePath, msg, "utf8");

    // Comando específico por plataforma
    const comando = isWindows
      ? `copy "${filePath}" \\\\localhost\\"${impressora}"`
      : `lp -d "${impressora}" "${filePath}"`;

    exec(comando, (operationError) => {
      if (operationError) {
        error('Erro ao enviar arquivo para impressora', {
          metadata: { error: operationError, impressora, plataforma: isWindows ? 'windows' : 'linux' }
        });
      }
      // Remove arquivo temporário no Linux
      if (!isWindows) {
        fs.unlink(filePath, () => {});
      }
    });

    info('Comando de impressão enviado para fila', {
      metadata: { impressora, arquivo: filePath, plataforma: isWindows ? 'windows' : 'linux' }
    });

    resolve({ status: "success", message: "Impresso com sucesso", acao: "imprimir" });
  });
}

module.exports = imprimirTexto;
