const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const { info, warn, error } = require("../utils/logger");

const isWindows = os.platform() === "win32";

async function listarImpressoras() {
  try {
    let nomes = [];
    
    if (isWindows) {
      // Windows: usa PowerShell (wmic foi removido no Windows 11 moderno)
      let listarOk = false;

      // Método 1: PowerShell Get-Printer
      try {
        const { stdout: psOutput } = await execPromise(
          'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"'
        );
        const psNomes = psOutput.split("\n").map(l => l.trim()).filter(Boolean);
        if (psNomes.length > 0) {
          nomes = psNomes;
          listarOk = true;
          info('Impressoras encontradas via PowerShell Get-Printer', {
            metadata: { total: nomes.length, impressoras: nomes }
          });
        }
      } catch (e) {
        warn('PowerShell Get-Printer falhou, tentando wmic', {
          metadata: { erro: e.message }
        });
      }

      // Método 2: wmic (fallback para Windows mais antigos)
      if (!listarOk) {
        try {
          const { stdout: wmicOutput } = await execPromise("wmic printer get name");
          nomes = wmicOutput.split("\n").map(l => l.trim())
            .filter(l => l && l !== "Name");
          if (nomes.length > 0) {
            info('Impressoras encontradas via wmic', {
              metadata: { total: nomes.length, impressoras: nomes }
            });
          }
        } catch (e) {
          warn('wmic também falhou', { metadata: { erro: e.message } });
        }
      }

    } else {
      // Linux: tenta múltiplos métodos para listar impressoras
      
      // Método 1: lpstat -p (lista impressoras)
      // Suporta saída em português ("impressora") e inglês ("printer")
      try {
        const { stdout: lpstatOutput } = await execPromise("lpstat -p 2>/dev/null");
        if (lpstatOutput && lpstatOutput.trim()) {
          const lpstatNomes = lpstatOutput.split("\n")
            .map(line => {
              // Formato PT: "impressora NOME está inativa..."
              // Formato EN: "printer NOME is idle..."
              const match = line.match(/^(?:printer|impressora)\s+(\S+)/i);
              return match ? match[1] : null;
            })
            .filter(Boolean);
          
          if (lpstatNomes.length > 0) {
            nomes = lpstatNomes;
            info('Impressoras encontradas via lpstat -p', {
              metadata: { total: nomes.length, impressoras: nomes }
            });
          }
        }
      } catch (e) {
        warn('lpstat -p falhou, tentando alternativa', {
          metadata: { erro: e.message }
        });
      }
      
      // Método 2: lpstat -a (lista impressoras aceitando jobs)
      if (nomes.length === 0) {
        try {
          const { stdout: lpstatAOutput } = await execPromise("lpstat -a 2>/dev/null");
          if (lpstatAOutput && lpstatAOutput.trim()) {
            const lpstatANomes = lpstatAOutput.split("\n")
              .map(line => {
                // Formato PT: "NOME está aceitando requisições desde..."
                // Formato EN: "NOME accepting requests since..."
                const match = line.match(/^(\S+)\s+(?:accepting|está\s+aceitando)/i);
                return match ? match[1] : null;
              })
              .filter(Boolean);
            
            if (lpstatANomes.length > 0) {
              nomes = lpstatANomes;
              info('Impressoras encontradas via lpstat -a', {
                metadata: { total: nomes.length, impressoras: nomes }
              });
            }
          }
        } catch (e) {
          warn('lpstat -a também falhou', {
            metadata: { erro: e.message }
          });
        }
      }
      
      // Método 3: lpstat -d (impressora padrão)
      if (nomes.length === 0) {
        try {
          const { stdout: lpinfoOutput } = await execPromise("lpstat -d 2>/dev/null");
          // Formato PT: "destino padrão do sistema: NOME"
          // Formato EN: "system default destination: NOME"
          const matchPT = lpinfoOutput.match(/destino\s+padr[aã]o\s+do\s+sistema:\s*(\S+)/i);
          const matchEN = lpinfoOutput.match(/system\s+default\s+destination:\s*(\S+)/i);
          const match = matchPT || matchEN;
          
          if (match && match[1]) {
            nomes = [match[1]];
            info('Impressora padrão encontrada via lpstat -d', {
              metadata: { impressora: match[1] }
            });
          }
        } catch (e) {
          // Ignora erro silenciosamente
        }
      }
      
      // Método 4: Ler diretamente do CUPS
      if (nomes.length === 0) {
        try {
          const { stdout: cupsOutput } = await execPromise("cat /etc/cups/printers.conf 2>/dev/null | grep '<Printer' | sed 's/<Printer //g' | sed 's/>//g'");
          if (cupsOutput && cupsOutput.trim()) {
            nomes = cupsOutput.trim().split("\n").filter(Boolean);
            info('Impressoras encontradas via printers.conf', {
              metadata: { total: nomes.length }
            });
          }
        } catch (e) {
          // Ignora erro
        }
      }
    }
    
    info('Lista de impressoras atualizada', {
      metadata: { total: nomes.length, plataforma: isWindows ? 'windows' : 'linux', impressoras: nomes }
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
