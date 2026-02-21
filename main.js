/* ─── Main process ─────────────────────────────────────────────────── */
const {
  app,
  Menu,
  Notification,
  ipcMain
} = require('electron');
const { autoUpdater } = require('electron-updater');

// Remove completamente o menu do Electron em todas as janelas
Menu.setApplicationMenu(null);
const path = require('path');
const Store = require('electron-store');
const { info, warn, error, abrirPastaLogs, criarArquivoAjuda } = require('./core/utils/logger');
const { startWatcher, stopWatcher } = require('./core/api/ticketWatcher');
const { startWhatsappQueueWatcher, stopWhatsappQueueWatcher } = require('./core/api/whatsappQueueWatcher');
const { startMyzapStatusWatcher, stopMyzapStatusWatcher, enviarStatusMyZap } = require('./core/api/myzapStatusWatcher');
const { createSettings } = require('./core/windows/settings');
const { openLogViewer } = require('./core/windows/logViewer');
const { createTestPrint } = require('./core/windows/testPrint');
const { createPainelMyZap } = require('./core/windows/painelMyZap');
const { createFilaMyZap } = require('./core/windows/filaMyZap');
const trayManager = require('./core/windows/tray');
const { registerPrinterHandlers } = require('./core/ipc/printers');
const { registerMyZapHandlers } = require('./core/ipc/myzap');
const { attachAutoUpdaterHandlers, checkForUpdates } = require('./core/updater');
const { ensureMyZapReadyAndStart, refreshRemoteConfigAndSyncIa } = require('./core/myzap/autoConfig');
const { info: myzapInfo, warn: myzapWarn, error: myzapError } = require('./core/myzap/myzapLogger');

/* ---------- store ---------- */
const store = new Store({
  defaults: { apiUrl: '', idempresa: '', printer: '' }
});

/* ---------- state ---------- */
let printing = false;
let myzapConfigRefreshTimer = null;
let queueAutoStartTimer = null; // será alterado depois
const MYZAP_CONFIG_REFRESH_MS = 30 * 1000;

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
  return !!store.get('apiUrl') && !!store.get('apiToken') && !!store.get('idempresa');
}

function getModoIntegracaoMyZap() {
  return String(store.get('myzap_modoIntegracao') || 'local').trim().toLowerCase() || 'local';
}

function isMyZapModoLocal() {
  return getModoIntegracaoMyZap() === 'local';
}

function applyMyZapRuntimeByMode() {
  if (isMyZapModoLocal()) {
    scheduleQueueAutoStart();
    startMyzapStatusWatcher();
    return;
  }

  if (queueAutoStartTimer) {
    clearInterval(queueAutoStartTimer);
    queueAutoStartTimer = null;
  }

  stopWhatsappQueueWatcher();
  stopMyzapStatusWatcher();
  myzapInfo('MyZap em modo web/online. Rotinas locais foram desativadas.', {
    metadata: { modo: getModoIntegracaoMyZap() }
  });
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
  if (!hasValidConfigMyZap()) {
    myzapWarn('MyZap: configuracoes base ausentes (apiUrl/apiToken/idempresa).');
    toast('Configure o MyZap pelo ícone na bandeja');
    return;
  }

  try {
    myzapInfo('MyZap: iniciando fluxo automatico de preparacao/start...');
    const result = await ensureMyZapReadyAndStart({ forceRemote: true });

    if (result.status === 'success' && result?.skippedLocalStart) {
      toast('MyZap em modo web/online. Execucao local desativada.');
    } else if (result.status === 'success') {
      toast('Serviço MyZap iniciado automaticamente');
    } else {
      myzapError('MyZap: falha no fluxo automatico de start', { metadata: { result } });
    }
    applyMyZapRuntimeByMode();
  } catch (err) {
    myzapError('MyZap: erro critico no auto-start', { metadata: { error: err } });
  }
}


async function refreshMyZapConfigPeriodicamente() {
  if (!hasValidConfigMyZap()) {
    return;
  }

  try {
    const modoAntes = getModoIntegracaoMyZap();
    const result = await refreshRemoteConfigAndSyncIa();
    if (result?.status !== 'success') {
      myzapWarn('MyZap: falha ao atualizar config remota periodica', {
        metadata: { result }
      });
    }

    const modoDepois = getModoIntegracaoMyZap();
    if (modoAntes !== 'local' && modoDepois === 'local') {
      myzapInfo('MyZap: modo alterado para local/fila. Iniciando ambiente local automaticamente.');
      const startResult = await ensureMyZapReadyAndStart({ forceRemote: false });
      if (startResult?.status !== 'success') {
        myzapWarn('MyZap: falha ao iniciar ambiente local apos troca de modo', {
          metadata: { startResult }
        });
      }
    }

    applyMyZapRuntimeByMode();
  } catch (err) {
    myzapWarn('MyZap: erro na atualizacao remota periodica', {
      metadata: { error: err }
    });
  }
}

function scheduleMyZapConfigRefresh() {
  if (myzapConfigRefreshTimer) {
    return;
  }

  myzapConfigRefreshTimer = setInterval(() => {
    refreshMyZapConfigPeriodicamente();
  }, MYZAP_CONFIG_REFRESH_MS);
}


async function tryStartQueueWatcherAuto() {
  if (!isMyZapModoLocal()) {
    return true;
  }

  try {
    const result = await startWhatsappQueueWatcher();
    if (result?.status === 'success') {
      if (queueAutoStartTimer) {
        clearInterval(queueAutoStartTimer);
        queueAutoStartTimer = null;
      }
      info('Watcher da fila MyZap iniciado automaticamente', {
        metadata: { trigger: 'inicializacao', message: result?.message }
      });
      return true;
    }

    warn('Fila MyZap ainda nao foi iniciada automaticamente', {
      metadata: { message: result?.message || 'resultado sem mensagem' }
    });
    return false;
  } catch (err) {
    warn('Erro ao iniciar automaticamente o watcher da fila MyZap', {
      metadata: { error: err }
    });
    return false;
  }
}

function scheduleQueueAutoStart() {
  if (queueAutoStartTimer) {
    return;
  }

  tryStartQueueWatcherAuto();
  queueAutoStartTimer = setInterval(() => {
    tryStartQueueWatcherAuto();
  }, 30000);
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
      createPainelMyZap,
      createFilaMyZap
    },
    () => printing,
    app.getVersion()
  );

  // Cria menu inicial (printing ainda false)
  rebuildTrayMenu();

  // Se falta config, apenas avisa (não abre janela)
  if (!hasValidConfig()) {
    warn('Configuração incompleta detectada', {
      metadata: { apiUrl: !!store.get('apiUrl'), printer: !!store.get('printer') }
    });
    toast('Configure o sistema pelo ícone na bandeja');
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
  scheduleMyZapConfigRefresh();

  // Auto update: verifica e aplica (silencioso)
  handleUpdateCheck();
});

// (Atualização já aplicada na fila acima)

/* =========================================================
  3. Janelas nunca fecham o app (fica só no tray)
========================================================= */
app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => {
  if (myzapConfigRefreshTimer) {
    clearInterval(myzapConfigRefreshTimer);
    myzapConfigRefreshTimer = null;
  }
  if (queueAutoStartTimer) {
    clearInterval(queueAutoStartTimer);
    queueAutoStartTimer = null;
  }
  stopWhatsappQueueWatcher();
  stopMyzapStatusWatcher();
});

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
ipcMain.on('myzap-settings-saved', async (_e, {
  myzap_diretorio,
  myzap_sessionKey,
  myzap_apiToken,
  myzap_envContent,
  clickexpress_apiUrl,
  clickexpress_queueToken
}) => {
  myzapInfo('Configuracoes do painel MyZap salvas pelo usuario', {
    metadata: {
      myzap_diretorio,
      myzap_sessionKey,
      myzap_apiToken,
      myzap_envContent,
      clickexpress_apiUrl: !!clickexpress_apiUrl,
      clickexpress_queueToken: !!clickexpress_queueToken
    }
  });
  store.set({
    myzap_diretorio,
    myzap_sessionKey,
    myzap_sessionName: myzap_sessionKey,
    myzap_apiToken,
    myzap_envContent,
    clickexpress_apiUrl,
    clickexpress_queueToken
  });

  const result = await ensureMyZapReadyAndStart({ forceRemote: true });
  if (result.status === 'success') {
    toast('MyZap: configuracoes atualizadas automaticamente!');
  }

  applyMyZapRuntimeByMode();
  if (isMyZapModoLocal()) {
    enviarStatusMyZap().catch((err) => {
      myzapWarn('Falha ao enviar status passivo do MyZap apos salvar configuracoes', {
        metadata: { error: err }
      });
    });
  }
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









