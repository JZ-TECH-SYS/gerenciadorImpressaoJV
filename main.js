/* ─── Main process ─────────────────────────────────────────────────── */
const {
  app,
  Notification,
  ipcMain
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const Store = require('electron-store');
const { info, warn, error, abrirPastaLogs, criarArquivoAjuda } = require('./core/utils/logger');
const { startWatcher, stopWatcher } = require('./core/api/ticketWatcher');
const { createSettings } = require('./core/windows/settings');
const { openLogViewer } = require('./core/windows/logViewer');
const { createTestPrint } = require('./core/windows/testPrint');
const { createPainelMyZap } = require('./core/windows/painelMyZap');
const trayManager = require('./core/windows/tray');
const { registerPrinterHandlers } = require('./core/ipc/printers');
const { registerMyZapHandlers } = require('./core/ipc/myzap');
const { attachAutoUpdaterHandlers, checkForUpdates } = require('./core/updater');

const verificarDiretorio = require('./core/myzap/verificarDiretorio');
const iniciarMyZap = require('./core/myzap/iniciarMyZap');

/* ---------- store ---------- */
const store = new Store({
  defaults: { apiUrl: '', idempresa: '', printer: '' }
});

/* ---------- state ---------- */
let printing = false; // será alterado depois

/* =========================================================
   1. Helpers
========================================================= */
function toast(msg) {
  new Notification({ title: 'JV-Printer', body: msg, icon: path.join(__dirname, 'assets/icon.png') }).show();
}

function hasValidConfig() {
  return !!store.get('apiUrl') && !!store.get('printer');
}

function hasValidConfigMyZap() {
  return !!store.get('myzap_diretorio') && !!store.get('myzap_sessionKey') && !!store.get('myzap_apiToken');
}

function rebuildTrayMenu() {
  trayManager.rebuildMenu();
}

function handleUpdateCheck() {
  checkForUpdates(autoUpdater, { toast, warn });
}

function togglePrint() {
  printing = !printing;

  if (printing) {
    startWatcher();
    toast('Serviço de impressão iniciado');
    info('Serviço de impressão ativo via toggle', {
      metadata: { status: 'iniciado' }
    });
  } else {
    stopWatcher();
    toast('Serviço de impressão parado');
    info('Serviço de impressão pausado via toggle', {
      metadata: { status: 'parado' }
    });
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

async function autoStartMyZap() {
  const diretorio = store.get('myzap_diretorio');
  console.log('Auto-start MyZap com diretório:', diretorio);
  
  if (!hasValidConfigMyZap()) {
    warn('MyZap: Configurações ausentes.');
    createPainelMyZap();
    return;
  }

  try {
    const checkDir = await verificarDiretorio(diretorio);

    if (checkDir.status !== 'success') {
      warn('MyZap: Diretório vazio ou inválido.');
      createPainelMyZap();
      return;
    }

    info('MyZap: Iniciando serviço automático...');
    const result = await iniciarMyZap(diretorio);

    if (result.status === 'success') {
      toast('Serviço MyZap iniciado automaticamente');
    } else {
      error('MyZap: Falha na inicialização automática', { metadata: { result } });
      createPainelMyZap();
    }

  } catch (err) {
    error('MyZap: Erro crítico no auto-start', { metadata: { error: err } });
    createPainelMyZap();
  }
}

attachAutoUpdaterHandlers(autoUpdater, { toast });

/* =========================================================
  2. App ready
========================================================= */
app.whenReady().then(() => {
  info('Aplicação pronta para uso', {
    metadata: { ambiente: app.isPackaged ? 'producao' : 'desenvolvimento' }
  });
  trayManager.init(
    path.join(__dirname, 'assets/icon.png'),
    {
      createSettings,
      togglePrint,
      createTestPrint,
      openLogViewer,
      abrirPastaLogs,
      abrirAjuda,
      checkUpdates: handleUpdateCheck,
      createPainelMyZap
    },
    () => printing,
    app.getVersion()
  );

  // Cria menu inicial (printing ainda false)
  rebuildTrayMenu();

  // Abre settings se ainda falta config
  if (!hasValidConfig()) {
    warn('Configuração incompleta detectada', {
      metadata: { apiUrl: !!store.get('apiUrl'), printer: !!store.get('printer') }
    });
    createSettings();
  } else {
    // Config OK → inicia automaticamente
    printing = true;
    startWatcher();
    toast('Serviço de impressão iniciado');
    rebuildTrayMenu();
    info('Serviço de impressão iniciado automaticamente', {
      metadata: { trigger: 'inicializacao' }
    });
  }

  autoStartMyZap();

  // Auto update: verifica e aplica (silencioso)
  handleUpdateCheck();
});

// (Atualização já aplicada na fila acima)

/* =========================================================
  3. Janelas nunca fecham o app (fica só no tray)
========================================================= */
app.on('window-all-closed', e => e.preventDefault());

/* =========================================================
   4. IPC handlers
========================================================= */
ipcMain.handle('settings:get', (_e, key) => store.get(key));

registerPrinterHandlers(ipcMain);
registerMyZapHandlers(ipcMain);

/* Quando o usuário salva as configurações */
ipcMain.on('settings-saved', (_e, { idempresa, apiUrl, apiToken, printer }) => {
  info('Configurações salvas pelo usuário', {
    metadata: { idempresa, apiUrl, printer }
  });
  store.set({ idempresa, apiUrl, apiToken, printer });

  // Se já está tudo configurado e o serviço ainda não rodava → iniciar
  if (!printing && hasValidConfig()) {
    printing = true;
    startWatcher();
    toast('Serviço de impressão iniciado');
    rebuildTrayMenu();
  }
});

/* Quando o usuário salva as configurações */
ipcMain.on('myzap-settings-saved', (_e, { myzap_diretorio, myzap_sessionKey, myzap_apiToken }) => {
  info('Configurações salvas pelo usuário', {
    metadata: { myzap_diretorio, myzap_sessionKey, myzap_apiToken }
  });
  store.set({ myzap_diretorio, myzap_sessionKey, myzap_apiToken });
});

process.on('uncaughtException', (err) => {
  error('uncaughtException', {
    metadata: { error: err }
  });
});

process.on('unhandledRejection', (reason) => {
  error('unhandledRejection', {
    metadata: { error: reason }
  });
});

