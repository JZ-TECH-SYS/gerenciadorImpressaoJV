const { exec } = require("child_process");

function verificarCompartilhamento(printerName) {
  return new Promise((resolve, reject) => {
    exec("net share", (error, stdout) => {
      if (error) return reject(error.message);
      resolve(stdout.toLowerCase().includes(printerName.toLowerCase()));
    });
  });
}

module.exports = verificarCompartilhamento;
