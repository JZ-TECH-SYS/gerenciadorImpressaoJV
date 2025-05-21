const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");

const verificarCompartilhamento = require("./verificarCompartilhamento");
const { gerarNomeUnico } = require("../utils/gerarNomeUnico");
const { erro } = require("../utils/log");

function imprimirTexto({ impressora, msg }) {
  return new Promise(async (resolve) => {
    if (!impressora || !msg) {
      erro("Impressora ou mensagem não informada!");
      return resolve({ status: "error", message: "Dados inválidos" });
    }

    const compartilhada = await verificarCompartilhamento(impressora);
    if (!compartilhada) {
      return resolve({ status: "error", message: "Impressora não compartilhada" });
    }

    const filePath = path.join(os.tmpdir(), gerarNomeUnico("txt"));
    fs.writeFileSync(filePath, msg, "utf8");

    exec(`copy "${filePath}" \\\\localhost\\"${impressora}"`, (error) => {
      if (error) erro(`Erro ao imprimir: ${error.message}`);
    });

    resolve({ status: "success", message: "Impresso com sucesso", acao: "imprimir" });
  });
}

module.exports = imprimirTexto;
