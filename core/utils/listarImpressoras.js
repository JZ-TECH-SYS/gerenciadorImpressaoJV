const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const { info, warn, error } = require("./logger");

const isWindows = os.platform() === "win32";

async function listarImpressoras() {
  try {
    let nomes = [];
    
    if (isWindows) {
      // Windows: usa WMIC
      const cmd = "wmic printer get name";
      const { stdout } = await execPromise(cmd);
      nomes = stdout.split("\n").map(l => l.trim())
        .filter(l => l && l !== "Name");
        
    } else {
      // Linux: tenta múltiplos métodos para listar impressoras
      
      // Método 1: lpstat -p (lista impressoras)
      try {
        const { stdout: lpstatOutput } = await execPromise("lpstat -p 2>/dev/null");
        if (lpstatOutput && lpstatOutput.trim()) {
          const lpstatNomes = lpstatOutput.split("\n")
            .map(line => {
              const match = line.match(/^printer\s+(\S+)/i);
              return match ? match[1] : null;
            })
            .filter(Boolean);
          
          if (lpstatNomes.length > 0) {
            nomes = lpstatNomes;
          }
        }
      } catch (e) {
        // Tenta próximo método
      }
      
      // Método 2: lpstat -a
      if (nomes.length === 0) {
        try {
          const { stdout: lpstatAOutput } = await execPromise("lpstat -a 2>/dev/null");
          if (lpstatAOutput && lpstatAOutput.trim()) {
            const lpstatANomes = lpstatAOutput.split("\n")
              .map(line => {
                const match = line.match(/^(\S+)\s+accepting/i);
                return match ? match[1] : null;
              })
              .filter(Boolean);
            
            if (lpstatANomes.length > 0) {
              nomes = lpstatANomes;
            }
          }
        } catch (e) {
          // Ignora
        }
      }
    }
    
    info('Lista de impressoras atualizada (utilitário)', {
      metadata: { total: nomes.length, plataforma: isWindows ? 'windows' : 'linux' }
    });

    return {
      status: "success",
      acao: "todasImpressoras",
      data: nomes
    };
  } catch (err) {
    error('Erro ao listar impressoras (utilitário)', {
      metadata: { error: err, area: 'listarImpressorasUtils' }
    });
    return {
      status: "error",
      acao: "todasImpressoras",
      data: []
    };
  }
}

module.exports = listarImpressoras;
