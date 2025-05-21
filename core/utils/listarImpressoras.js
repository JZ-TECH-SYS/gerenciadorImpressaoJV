const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const { erro } = require("../utils/log");

async function listarImpressoras() {
  try {
    const cmd = os.platform() === "win32" ? "wmic printer get name" : "lpstat -p";
    const { stdout } = await execPromise(cmd);
    const nomes = stdout.split("\n").map(l => l.trim())
      .filter(l => l && l !== "Name" && l !== "printer");

    return {
      status: "success",
      acao: "todasImpressoras",
      data: nomes
    };
  } catch (error) {
    erro(`Erro ao listar impressoras: ${error.message}`);
    return {
      status: "error",
      acao: "todasImpressoras"
    };
  }
}

module.exports = listarImpressoras;
