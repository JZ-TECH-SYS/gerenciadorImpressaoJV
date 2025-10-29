const { BrowserWindow } = require("electron");
const path = require("path");

let settingsWin = null;

function createSettings() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }

  let paht = path.join(__dirname, "../../src/loads/preload.js");
  console.log(paht);

  settingsWin = new BrowserWindow({
    width: 800,
    height: 900,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "../../src/loads/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Importante: desabilitar sandbox aqui para permitir que o preload
      // acesse os módulos do Electron (contextBridge/ipcRenderer) e exponha
      // window.api para a página de configurações. A janela de teste de
      // impressão já funcionava sem sandbox, e foi após ativá-lo aqui que
      // a tela deixou de carregar os dados/impressoras.
      sandbox: false
    }
  });

  settingsWin.loadFile(path.join(__dirname, "../../assets/html/settings.html"));

  settingsWin.on("closed", () => {
    settingsWin = null;
  });
}

module.exports = { createSettings };
