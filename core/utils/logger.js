const fs = require('fs');
const path = require('path');
const os = require('os');

const RETENCAO_DIAS = 7;
const TMP_BASE = path.join(os.tmpdir(), 'jv-printer', 'logs');

if (!fs.existsSync(TMP_BASE)) {
  fs.mkdirSync(TMP_BASE, { recursive: true });
}

function getLogPath() {
  const data = new Date().toISOString().split('T')[0]; // yyyy-mm-dd
  return path.join(TMP_BASE, `${data}.log`);
}

function log(msg) {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  const linha = `[${timestamp}] ${msg}${os.EOL}`;
  fs.appendFileSync(getLogPath(), linha, 'utf8');
}

function limparLogsAntigos() {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;

  fs.readdir(TMP_BASE, (err, arquivos) => {
    if (err) return;

    arquivos.forEach(arquivo => {
      const fullPath = path.join(TMP_BASE, arquivo);
      fs.stat(fullPath, (err, stats) => {
        if (!err && stats.mtimeMs < limite) {
          fs.unlink(fullPath, () => {});
        }
      });
    });
  });
}

// limpa ao carregar
limparLogsAntigos();

module.exports = { log, getLogPath };
