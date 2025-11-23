const { Menu, Tray } = require('electron');

let trayInstance = null;
let actions = null;
let getPrinting = () => false;

function buildMenuTemplate(printing, callbacks) {
  const {
    createSettings,
    togglePrint,
    createTestPrint,
    openLogViewer,
    abrirPastaLogs,
    abrirAjuda
  } = callbacks;

  return [
    { label: '⚙️ Configurações', click: createSettings },
    {
      label: printing ? '⛔ Parar impressão' : '▶️ Iniciar impressão',
      click: togglePrint
    },
    { type: 'separator' },
    { label: '🖨️ Testar Impressão', click: createTestPrint },
    { label: '📄 Ver Logs', click: openLogViewer },
    { label: '📁 Abrir Pasta de Logs', click: abrirPastaLogs },
    { label: '❓ Ajuda (Problemas)', click: abrirAjuda },
    { type: 'separator' },
    { label: '🚪 Sair', role: 'quit' }
  ];
}

function init(iconPath, callbackSet, printingState) {
  actions = callbackSet;
  if (typeof printingState === 'function') {
    getPrinting = printingState;
  }

  trayInstance = new Tray(iconPath);
  trayInstance.setToolTip('JV-Printer');
  rebuildMenu();
  return trayInstance;
}

function rebuildMenu() {
  if (!trayInstance || !actions) {
    return;
  }

  const menu = Menu.buildFromTemplate(buildMenuTemplate(getPrinting(), actions));
  trayInstance.setContextMenu(menu);
}

module.exports = {
  init,
  rebuildMenu
};