const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');
const { error } = require("../utils/logger");

async function verificarDiretorio(dirPath) {
  try {
    console.log('Verificando diretório:', dirPath);
    if (!dirPath || !fs.existsSync(dirPath)) {
      return {
        status: "error",
        message: "MyZap não se encontra no diretório configurado!",
      };
    }

    const packageJsonPath = path.join(dirPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return {
        status: "error",
        message: "Diretório existe mas não contém uma instalação válida do MyZap!",
      };
    }

    return {
      status: "success",
      message: "MyZap se encontra no diretório configurado!"
    };
  } catch (err) {
    error('Erro ao verificar diretório', {
      metadata: { error: err, area: 'verificarDiretorio' }
    });
    return {
      status: "error",
      message: err.message || err,
    };
  }
}

module.exports = verificarDiretorio;
