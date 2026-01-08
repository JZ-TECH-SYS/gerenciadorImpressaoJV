const { exec } = require("child_process");
const os = require("os");

const isWindows = os.platform() === "win32";

function verificarCompartilhamento(printerName) {
  return new Promise((resolve, reject) => {
    if (isWindows) {
      // Windows: verifica compartilhamento de rede
      exec("net share", (error, stdout) => {
        if (error) return reject(error.message);
        resolve(stdout.toLowerCase().includes(printerName.toLowerCase()));
      });
    } else {
      // Linux: verifica se impressora existe no CUPS
      exec(`lpstat -p "${printerName}" 2>/dev/null`, (error, stdout) => {
        if (error) {
          // Tenta verificar se a impressora existe de outra forma
          exec("lpstat -p", (err, out) => {
            if (err) return resolve(false);
            resolve(out.toLowerCase().includes(printerName.toLowerCase()));
          });
          return;
        }
        resolve(stdout.length > 0);
      });
    }
  });
}

module.exports = verificarCompartilhamento;
