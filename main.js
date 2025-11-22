/* ─── Main process ─────────────────────────────────────────────────── */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain
} = require('electron');
const { autoUpdater } = require('electron-updater');

const path                 = require('path');
const Store                = require('electron-store');

const { startWatcher, stopWatcher } = require('./core/api/ticketWatcher');
const { createSettings }            = require('./core/windows/settings');
const { openLogViewer }             = require('./core/windows/logViewer');
const { createTestPrint }           = require('./core/windows/testPrint');
const { abrirPastaLogs, criarArquivoAjuda } = require('./core/utils/logger');
const listarImpressoras             = require('./core/impressora/listarImpressoras');

/* ---------- store ---------- */
const store = new Store({
  defaults: { apiUrl: '', idempresa: '', printer: '' }
});

/* ---------- state ---------- */
let tray        = null;
let printing    = false; // será alterado depois
let menu        = null;

/* =========================================================
   1. Helpers
========================================================= */
function toast(msg) {
  new Notification({ title: 'JV-Printer', body: msg }).show();
}

function hasValidConfig() {
  return !!store.get('apiUrl') && !!store.get('printer');
}

function buildMenuTemplate() {
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

function rebuildTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
}

function togglePrint() {
  printing = !printing;

  if (printing) {
    startWatcher();
    toast('Serviço de impressão iniciado');
  } else {
    stopWatcher();
    toast('Serviço de impressão parado');
  }

  rebuildTrayMenu();
}

function abrirAjuda() {
  const { shell } = require('electron');
  
  // Cria o arquivo de ajuda e obtém o caminho
  const caminhoAjuda = criarArquivoAjuda();
  
  if (caminhoAjuda) {
    shell.openPath(caminhoAjuda);
  } else {
    toast('Erro ao abrir arquivo de ajuda');
  }
}

/* =========================================================
   2. App ready
========================================================= */
app.whenReady().then(() => {
  tray = new Tray(path.join(__dirname, 'assets/icon.png'));
  tray.setToolTip('JV-Printer');

  // Cria menu inicial (printing ainda false)
  rebuildTrayMenu();

  // Abre settings se ainda falta config
  if (!hasValidConfig()) {
    createSettings();
  } else {
    // Config OK → inicia automaticamente
    printing = true;
    startWatcher();
    toast('Serviço de impressão iniciado');
    rebuildTrayMenu();
  }

  // Auto update: verifica e aplica (silencioso)
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    // Falha silenciosa
    console.warn('Falha ao checar atualizações', e.message);
  }
});

// Opcional: instalar automaticamente após download
autoUpdater.on('update-downloaded', () => {
  try {
    autoUpdater.quitAndInstall();
  } catch {}
});

/* =========================================================
   3. Janelas nunca fecham o app (fica só no tray)
========================================================= */
app.on('window-all-closed', e => e.preventDefault());

/* =========================================================
   4. IPC handlers
========================================================= */
ipcMain.handle('settings:get', (_e, key) => store.get(key));

ipcMain.handle('printers:list', async () => {
  try {
    const result = await listarImpressoras();
    // listarImpressoras retorna { status, acao, data: [] }
    if (result.status === 'success' && Array.isArray(result.data)) {
      return result.data;
    }
    return [];
  } catch {
    return [];
  }
});

/* Quando o usuário salva as configurações */
ipcMain.on('settings-saved', (_e, { idempresa, apiUrl, apiToken, printer }) => {
  store.set({ idempresa, apiUrl, apiToken, printer });

  // Se já está tudo configurado e o serviço ainda não rodava → iniciar
  if (!printing && hasValidConfig()) {
    printing = true;
    startWatcher();
    toast('Serviço de impressão iniciado');
    rebuildTrayMenu();
  }
});

