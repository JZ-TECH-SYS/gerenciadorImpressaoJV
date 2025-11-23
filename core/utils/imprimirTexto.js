const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");

const verificarCompartilhamento = require("./verificarCompartilhamento");
const { gerarNomeUnico } = require("../utils/gerarNomeUnico");
const { warn, error, info } = require("../utils/logger");

function imprimirTexto({ impressora, msg }) {
  return new Promise(async (resolve) => {
    if (!impressora || !msg) {
      warn('Impressora ou mensagem não informada', {
        metadata: { area: 'imprimirTextoUtils', falta: !impressora ? 'impressora' : 'mensagem' }
      });
      return resolve({ status: "error", message: "Dados inválidos" });
    }

    const compartilhada = await verificarCompartilhamento(impressora);
    if (!compartilhada) {
      warn('Impressora não está compartilhada', {
        metadata: { area: 'imprimirTextoUtils', impressora }
      });
      return resolve({ status: "error", message: "Impressora não compartilhada" });
    }

    const filePath = path.join(os.tmpdir(), gerarNomeUnico("txt"));
    fs.writeFileSync(filePath, msg, "utf8");

    exec(`copy "${filePath}" \\localhost\"${impressora}"`, (operationError) => {
      if (operationError) {
        error('Erro ao enviar arquivo para impressora', {
          metadata: { error: operationError, impressora }
        });
      }
    });

    info('Comando de impressão enviado para fila (utils)', {
      metadata: { impressora, arquivo: filePath }
    });

    resolve({ status: "success", message: "Impresso com sucesso", acao: "imprimir" });
  });
}

module.exports = imprimirTexto;
