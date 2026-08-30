/**
 * Bandeja MINIMALISTA (v4). Abre o painel e resolve as urgencias reais:
 * pausar IMPRESSAO, pausar envio, buscar atualizacao. Todo o resto vive na
 * janela unica.
 */

const { Menu, Tray, Notification, nativeImage } = require('electron');

let trayInstance = null;
let actions = null;
let states = { impressaoAtiva: () => true, envioAtivo: () => true };
let appVersion = '?.?.?';
let trayIconPath = null;

function buildMenuTemplate(callbacks) {
  const { openPanel, togglePrinting, toggleEnvio, checkAllUpdates } = callbacks;
  const impressaoAtiva = states.impressaoAtiva();
  const envioAtivo = states.envioAtivo();

  return [
    { label: `JV Printer  v${appVersion}`, enabled: false },
    { type: 'separator' },
    { label: 'Abrir painel', click: () => openPanel?.() },
    {
      label: impressaoAtiva ? 'Pausar impressao' : 'Retomar impressao',
      click: () => togglePrinting?.()
    },
    {
      label: envioAtivo ? 'Pausar envio de mensagens' : 'Retomar envio de mensagens',
      click: () => toggleEnvio?.()
    },
    { label: 'Buscar atualizacao', click: () => checkAllUpdates?.() },
    { type: 'separator' },
    { label: 'Sair', role: 'quit' }
  ];
}

function init(iconPath, callbackSet, version = '?.?.?', stateGetters = {}) {
  actions = callbackSet;
  appVersion = version;
  trayIconPath = iconPath;
  states = { ...states, ...stateGetters };

  trayInstance = new Tray(iconPath);
  trayInstance.setToolTip(`JV Printer  v${version}`);
  trayInstance.on('double-click', () => actions?.openPanel?.());
  rebuildMenu();
  return trayInstance;
}

function notify(message, title = 'JV Printer') {
  const body = String(message || '').trim();
  if (!body) {
    return;
  }

  if (process.platform === 'win32' && trayInstance) {
    try {
      trayInstance.displayBalloon({
        title,
        content: body,
        icon: trayIconPath ? nativeImage.createFromPath(trayIconPath) : undefined
      });
      return;
    } catch (_e) { /* cai no fallback */ }
  }

  try {
    new Notification({ title, body, icon: trayIconPath || undefined }).show();
  } catch (_e) { /* melhor esforco */ }
}

function rebuildMenu() {
  if (!trayInstance || !actions) {
    return;
  }

  const menu = Menu.buildFromTemplate(buildMenuTemplate(actions));
  trayInstance.setContextMenu(menu);
}

module.exports = {
  init,
  rebuildMenu,
  notify
};
