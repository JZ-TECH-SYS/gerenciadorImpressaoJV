/* ─── Main process ─────────────────────────────────────────────────── */

// Corrige o PATH no macOS/Linux — o Electron nao herda o PATH do shell,
// entao git, node, pnpm nao seriam encontrados sem esta chamada.
if (process.platform !== 'win32') {
  try { require('fix-path')(); } catch (_e) { /* melhor esforco */ }
}

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
const { startMyzapStatusWatcher, stopMyzapStatusWatcher, enviarStatusMyZap, isMyzapWatcherAtivo } = require('./core/api/myzapStatusWatcher');
const { startTokenSyncWatcher, stopTokenSyncWatcher } = require('./core/api/tokenSyncWatcher');
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
const { clearProgress, getCurrentProgress } = require('./core/myzap/progress');
const { killProcessesOnPort, isPortInUse } = require('./core/myzap/processUtils');
const { killMyZapProcess } = require('./core/myzap/iniciarMyZap');
const deleteSession = require('./core/myzap/api/deleteSession');
const { info: myzapInfo, warn: myzapWarn, error: myzapError } = require('./core/myzap/myzapLogger');

/* ---------- store ---------- */
const store = new Store({
  defaults: { apiUrl: '', idempresa: '', printer: '' }
});

/* ---------- state ---------- */
let printing = false;
let myzapConfigRefreshTimer = null;
let queueAutoStartTimer = null; // será alterado depois
let myzapEnsureLoopTimer = null;
let myzapManualUpdateInProgress = false;
const MYZAP_CONFIG_REFRESH_MS = 30 * 1000;
const MYZAP_ENSURE_LOOP_MS = 20 * 1000;

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
    scheduleMyZapEnsureLoop();
    scheduleQueueAutoStart();
    startMyzapStatusWatcher();
    startTokenSyncWatcher();
    return;
  }

  // Modo web: encerrar sessao, matar processo MyZap + porta local
  if (queueAutoStartTimer) {
    clearInterval(queueAutoStartTimer);
    queueAutoStartTimer = null;
  }

  if (myzapEnsureLoopTimer) {
    clearInterval(myzapEnsureLoopTimer);
    myzapEnsureLoopTimer = null;
  }

  stopWhatsappQueueWatcher();
  stopMyzapStatusWatcher();
  stopTokenSyncWatcher();

  // Encerrar sessao do WhatsApp antes de matar o processo
  deleteSession().catch((err) => {
    myzapWarn('Falha ao encerrar sessao WhatsApp na troca para modo web', {
      metadata: { error: err?.message || String(err) }
    });
  });

  // Matar child process rastreado
  try {
    killMyZapProcess();
  } catch (_e) { /* melhor esforco */ }

  try {
    killProcessesOnPort(5555);
  } catch (_e) { /* melhor esforco */ }

  toast('MyZap alterado para modo web/online. Rotinas locais desativadas.');

  myzapInfo('MyZap em modo web/online. Rotinas locais e processo MyZap foram desativados.', {
    metadata: { modo: getModoIntegracaoMyZap() }
  });
}

async function ensureMyZapLocalRuntime(trigger = 'watchdog') {
  if (!hasValidConfigMyZap()) {
    return { status: 'skipped', reason: 'missing_base_config' };
  }

  if (store.get('myzap_userRemovedLocal') === true) {
    return { status: 'skipped', reason: 'user_removed_local' };
  }

  if (!isMyZapModoLocal()) {
    return { status: 'skipped', reason: 'mode_not_local' };
  }

  try {
    const portaAtiva = await isPortInUse(5555);
    if (portaAtiva) {
      return { status: 'success', message: 'MyZap local ja ativo.' };
    }

    myzapInfo('MyZap auto-ensure: porta local fechada, tentando iniciar automaticamente', {
      metadata: { trigger, modo: getModoIntegracaoMyZap() }
    });

    const result = await ensureMyZapReadyAndStart({ forceRemote: false });
    applyMyZapRuntimeByMode();
    return result;
  } catch (err) {
    myzapWarn('MyZap auto-ensure: erro ao validar/iniciar runtime local', {
      metadata: { trigger, error: err?.message || String(err) }
    });
    return { status: 'error', message: err?.message || String(err) };
  }
}

function rebuildTrayMenu() {
  trayManager.rebuildMenu();
}

function toggleMyzap() {
  if (isMyzapWatcherAtivo()) {
    stopWhatsappQueueWatcher();
    stopMyzapStatusWatcher();
    toast('Serviço MyZap pausado');
    info('Serviço MyZap pausado via toggle', {
      metadata: { status: 'parado' }
    });
  } else {
    startMyzapStatusWatcher();
    if (isMyZapModoLocal()) {
      tryStartQueueWatcherAuto();
    }
    toast('Serviço MyZap iniciado');
    info('Serviço MyZap iniciado via toggle', {
      metadata: { status: 'iniciado' }
    });
  }
  rebuildTrayMenu();
}

function handleUpdateCheck() {
  checkForUpdates(autoUpdater, { toast, warn });
}

async function updateMyZapNow() {
  if (myzapManualUpdateInProgress) {
    toast('Atualização do MyZap já em andamento');
    return;
  }

  if (!hasValidConfigMyZap()) {
    toast('Configure API/Token/Empresa antes de atualizar o MyZap');
    return;
  }

  myzapManualUpdateInProgress = true;
  toast('Atualizando MyZap manualmente...');
  myzapInfo('Atualização manual do MyZap solicitada via tray');

  try {
    const result = await ensureMyZapReadyAndStart({ forceRemote: true });
    applyMyZapRuntimeByMode();

    if (result?.status === 'success' && result?.skippedLocalStart) {
      toast('Modo web/online ativo. Atualização local ignorada.');
      return;
    }

    if (result?.status === 'success') {
      toast('MyZap atualizado e reiniciado com sucesso');
      if (isMyZapModoLocal()) {
        enviarStatusMyZap().catch((err) => {
          myzapWarn('Falha ao enviar status após atualização manual do MyZap', {
            metadata: { error: err }
          });
        });
      }
      return;
    }

    toast(`Falha ao atualizar MyZap: ${result?.message || 'erro desconhecido'}`);
    myzapWarn('Falha na atualização manual do MyZap', {
      metadata: { result }
    });
  } catch (err) {
    toast('Erro inesperado ao atualizar MyZap');
    myzapError('Erro inesperado na atualização manual do MyZap', {
      metadata: { error: err }
    });
  } finally {
    myzapManualUpdateInProgress = false;
  }
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

  // Se usuario removeu a instalacao local explicitamente, nao re-instalar automaticamente
  if (store.get('myzap_userRemovedLocal') === true) {
    myzapInfo('MyZap: auto-start ignorado (usuario removeu instalacao local previamente).');
    return;
  }

  try {
    myzapInfo('MyZap: iniciando fluxo automatico de preparacao/start...');
    let result = await ensureMyZapReadyAndStart({ forceRemote: true });

    if (result?.status !== 'success') {
      myzapWarn('MyZap: auto-start remoto falhou. Tentando fallback local com cache.', {
        metadata: { result }
      });
      result = await ensureMyZapReadyAndStart({ forceRemote: false });
    }

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
    if (isMyZapModoLocal()) {
      await ensureMyZapLocalRuntime('config_refresh');
    }
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

function scheduleMyZapEnsureLoop() {
  if (myzapEnsureLoopTimer) {
    return;
  }

  setTimeout(() => {
    ensureMyZapLocalRuntime('startup_delay').catch((err) => {
      myzapWarn('MyZap ensure-loop: erro na rodada inicial', {
        metadata: { error: err?.message || String(err) }
      });
    });
  }, 8000);

  myzapEnsureLoopTimer = setInterval(() => {
    ensureMyZapLocalRuntime('interval').catch((err) => {
      myzapWarn('MyZap ensure-loop: erro no loop de garantia de start', {
        metadata: { error: err?.message || String(err) }
      });
    });
  }, MYZAP_ENSURE_LOOP_MS);
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
      toggleMyzap,
      updateMyZapNow,
      createTestPrint,
      openLogViewer,
      abrirPastaLogs,
      abrirAjuda,
      checkUpdates: handleUpdateCheck,
      createPainelMyZap,
      createFilaMyZap
    },
    () => printing,
    app.getVersion(),
    isMyzapWatcherAtivo
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

  // Limpa progresso stale na inicializacao
  try {
    const progress = getCurrentProgress();
    if (progress && progress.active) {
      myzapWarn('Progresso stale detectado na inicializacao, limpando', {
        metadata: { progress }
      });
      clearProgress();
    }
  } catch (_e) { /* melhor esforco */ }

  autoStartMyZap();
  scheduleMyZapConfigRefresh();
  scheduleMyZapEnsureLoop();

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
  if (myzapEnsureLoopTimer) {
    clearInterval(myzapEnsureLoopTimer);
    myzapEnsureLoopTimer = null;
  }
  stopWhatsappQueueWatcher();
  stopMyzapStatusWatcher();
  stopTokenSyncWatcher();
});

/* =========================================================
   4. IPC handlers
========================================================= */
ipcMain.handle('settings:get', (_e, key) => store.get(key));

registerPrinterHandlers(ipcMain);
registerMyZapHandlers(ipcMain);

/* Quando o usuário salva as configurações */
ipcMain.on('settings-saved', async (_e, { idempresa, apiUrl, apiToken, printer }) => {
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

  await autoStartMyZap();
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









