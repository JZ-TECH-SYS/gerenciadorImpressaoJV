const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const { info, error } = require("../utils/logger");

async function listarImpressoras() {
  try {
    const cmd = os.platform() === "win32" ? "wmic printer get name" : "lpstat -p";
    const { stdout } = await execPromise(cmd);
    const nomes = stdout.split("\n").map(l => l.trim())
      .filter(l => l && l !== "Name" && l !== "printer");
    info('Lista de impressoras atualizada (utilitário)', {
      metadata: { comando: cmd, total: nomes.length }
    });

    return {
      status: "success",
      acao: "todasImpressoras",
      data: nomes
    };
  } catch (error) {
    error('Erro ao listar impressoras (utilitário)', {
      metadata: { error, area: 'listarImpressorasUtils' }
    });
    return {
      status: "error",
      acao: "todasImpressoras"
    };
  }
}

module.exports = listarImpressoras;
