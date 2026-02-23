const { Menu, Tray } = require('electron');

let trayInstance = null;
let actions = null;
let getPrinting = () => false;
let getMyzapStatus = () => 'desconhecido';
let appVersion = '?.?.?';

function buildMenuTemplate(printing, myzapAtivo, callbacks) {
  const {
    createSettings,
    togglePrint,
    toggleMyzap,
    updateMyZapNow,
    createTestPrint,
    openLogViewer,
    abrirPastaLogs,
    abrirAjuda,
    checkUpdates,
    createPainelMyZap,
    createFilaMyZap
  } = callbacks;

  return [
    // ── Cabeçalho ──────────────────────────────────────
    { label: '🖨️  JV-Printer', enabled: false },
    { label: `      v${appVersion}`, enabled: false },
    { type: 'separator' },

    // ── Impressão ──────────────────────────────────────
    { label: '── Impressão ──', enabled: false },
    {
      label: printing
        ? '🟢  Impressão ativa'
        : '🔴  Impressão pausada',
      click: togglePrint
    },
    { label: '⚙️   Configurações', click: createSettings },
    { label: '🖨️   Teste de impressão', click: createTestPrint },
    { type: 'separator' },

    // ── WhatsApp ───────────────────────────────────────
    { label: '── WhatsApp ──', enabled: false },
    {
      label: myzapAtivo
        ? '🟢  MyZap ativo'
        : '🔴  MyZap pausado',
      click: toggleMyzap
    },
    { label: '🔄  Atualizar MyZap agora', click: updateMyZapNow },
    { label: '💬  Painel MyZap', click: createPainelMyZap },
    { label: '📬  Fila de mensagens', click: createFilaMyZap },
    { type: 'separator' },

    // ── Sistema ────────────────────────────────────────
    { label: '── Sistema ──', enabled: false },
    { label: '📋  Ver logs', click: openLogViewer },
    { label: '📁  Pasta de logs', click: abrirPastaLogs },
    { label: '❓  Ajuda / Problemas', click: abrirAjuda },
    {
      label: '🔄  Verificar atualização',
      click: () => checkUpdates?.(),
      enabled: !!checkUpdates
    },
    { type: 'separator' },

    // ── Sair ───────────────────────────────────────────
    { label: '🚪  Sair', role: 'quit' }
  ];
}

function init(iconPath, callbackSet, printingState, version = '?.?.?', myzapStatusState) {
  actions = callbackSet;
  appVersion = version;
  if (typeof printingState === 'function') {
    getPrinting = printingState;
  }
  if (typeof myzapStatusState === 'function') {
    getMyzapStatus = myzapStatusState;
  }

  trayInstance = new Tray(iconPath);
  trayInstance.setToolTip(`JV-Printer  v${version}`);
  rebuildMenu();
  return trayInstance;
}

function rebuildMenu() {
  if (!trayInstance || !actions) {
    return;
  }

  const menu = Menu.buildFromTemplate(buildMenuTemplate(getPrinting(), getMyzapStatus(), actions));
  trayInstance.setContextMenu(menu);
}

module.exports = {
  init,
  rebuildMenu
};
