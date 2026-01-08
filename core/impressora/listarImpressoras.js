const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const { info, error } = require("../utils/logger");

const isWindows = os.platform() === "win32";

async function listarImpressoras() {
  try {
    const cmd = isWindows ? "wmic printer get name" : "lpstat -p";
    const { stdout } = await execPromise(cmd);
    
    let nomes;
    if (isWindows) {
      // Windows: saída do WMIC "Name\nImpressora1\nImpressora2"
      nomes = stdout.split("\n").map(l => l.trim())
        .filter(l => l && l !== "Name");
    } else {
      // Linux: saída do lpstat "printer Impressora1 is idle..."
      nomes = stdout.split("\n")
        .map(line => {
          const match = line.match(/^printer\s+(\S+)/);
          return match ? match[1] : null;
        })
        .filter(Boolean);
    }
    
    info('Lista de impressoras atualizada', {
      metadata: { comando: cmd, total: nomes.length, plataforma: isWindows ? 'windows' : 'linux' }
    });

    return {
      status: "success",
      acao: "todasImpressoras",
      data: nomes
    };
  } catch (err) {
    error('Erro ao listar impressoras', {
      metadata: { error: err, area: 'listarImpressoras' }
    });
    return {
      status: "error",
      acao: "todasImpressoras",
      data: []
    };
  }
}

module.exports = listarImpressoras;
