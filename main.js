/* ─── Main process — JV Printer v4 (versão suprema) ──────────────────
 * Plataforma idêntica ao gerenciadorMyzap v2.3.1 (Runtime Pack, supervisor,
 * janela única com semáforo, auto-update dos dois lados) + o subsistema de
 * IMPRESSÃO original preservado byte a byte (ticketWatcher/imprimirHtml):
 * a parte que a empresa mais usa não muda de comportamento.
 * ──────────────────────────────────────────────────────────────────── */

if (process.platform !== 'win32') {
  try { require('fix-path')(); } catch (_e) { /* melhor esforco */ }
}

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  dialog,
  ipcMain,
  crashReporter
} = require('electron');
const { autoUpdater } = require('electron-updater');

// Estabilidade com drivers de impressora térmica (EPSON TM-T etc.):
// crashes nativos do GPU process matavam o app inteiro sem log.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

// Crash reporter ANTES de tudo — dumps nativos (Chromium/V8) locais.
crashReporter.start({
  submitURL: '',
  uploadToServer: false,
  compress: false
});

const path = require('path');
const Store = require('electron-store');
const {
  info, warn, error,
  abrirPastaLogs, limparLogsAntigos, criarArquivoAjuda
} = require('./core/utils/logger');
const {
  startWhatsappQueueWatcher,
  stopWhatsappQueueWatcher,
  getWhatsappQueueWatcherStatus,
  setQueueNotifier
} = require('./core/api/whatsappQueueWatcher');
const {
  startMyzapStatusWatcher,
  stopMyzapStatusWatcher,
  enviarStatusMyZap,
  getMyzapStatusWatcherInfo,
  setTrayCallback
} = require('./core/api/myzapStatusWatcher');
const {
  startTokenSyncWatcher,
  stopTokenSyncWatcher,
  getTokenSyncWatcherStatus
} = require('./core/api/tokenSyncWatcher');
const { startWatcher: startPrintWatcher, stopWatcher: stopPrintWatcher, getPrintingStatus } = require('./core/api/ticketWatcher');
const { openLogViewer } = require('./core/windows/logViewer');
const { createAppWindow } = require('./core/windows/appWindow');
const trayManager = require('./core/windows/tray');
const { registerPrinterHandlers } = require('./core/ipc/printers');
const { registerMyZapHandlers } = require('./core/ipc/myzap');
const { attachAutoUpdaterHandlers, checkForUpdates, getUpdaterStatus } = require('./core/updater');
const { ensureMyZapReadyAndStart, refreshRemoteConfigAndSyncIa } = require('./core/myzap/autoConfig');
const {
  buildBackendProfileKey,
  clearDerivedBackendState,
  isCapabilityEnabled,
  getCapabilityEntry,
  getCapabilitySnapshotPayload,
  saveCapabilityPreferences
} = require('./core/myzap/capabilities');
const { clearProgress, getCurrentProgress } = require('./core/myzap/progress');
const { killProcessesOnPort } = require('./core/myzap/processUtils');
const { killMyZapProcess } = require('./core/myzap/iniciarMyZap');
const {
  startSupervisor,
  stopSupervisor,
  getSupervisorStatus,
  forceRepair
} = require('./core/myzap/supervisor');
const { checkAndUpdateIfNeeded } = require('./core/myzap/updateChecker');
const {
  checkAndUpdatePack,
  cleanupLeftovers: cleanupPackLeftovers,
  getInstalledPackVersion
} = require('./core/myzap/enginePack');
const { runPostUpdateRepairIfNeeded } = require('./core/myzap/firstRunRepair');
const { offerPerUserMigration, redirectToPerUserIfInstalled } = require('./core/migracaoInstalador');
const deleteSession = require('./core/myzap/api/deleteSession');
const { info: myzapInfo, warn: myzapWarn, error: myzapError } = require('./core/myzap/myzapLogger');
const imprimirHTML = require('./core/impressora/imprimirHtml');

// Aba Configurações da janela única substitui a antiga janela de settings.
const createSettings = () => createAppWindow('config');

Menu.setApplicationMenu(null);

const AUTO_LAUNCH_ARGS = ['--autostart'];
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const store = new Store({
  defaults: {
    idempresa: '',
    apiUrl: '',
    apiToken: '',
    printer: '',
    myzap_diretorio: '',
    myzap_sessionKey: '',
    myzap_sessionName: '',
    myzap_apiToken: '',
    myzap_envContent: '',
    myzap_capabilityIaConfigMode: 'auto',
    myzap_capabilityTokenSyncMode: 'auto',
    myzap_capabilityPassiveStatusMode: 'auto',
    myzap_capabilityQueuePollingMode: 'auto'
  }
});

let printing = false;
let myzapConfigRefreshTimer = null;
let queueAutoStartTimer = null;
let myzapCodeUpdateTimer = null;
let myzapManualUpdateInProgress = false;
let lastKnownModoIntegracao = null;
let lastAdminRequiredToastAt = 0;
const MYZAP_CONFIG_REFRESH_MS = 30 * 1000;
const MYZAP_CODE_UPDATE_FIRST_DELAY_MS = 2 * 60 * 1000;
const MYZAP_CODE_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ADMIN_REQUIRED_TOAST_INTERVAL_MS = 10 * 60 * 1000;

function toast(msg) {
  new Notification({
    title: 'JV Printer',
    body: msg,
    icon: path.join(__dirname, 'assets/icon.png')
  }).show();
}

function notifyAdminRequired(result, context = 'runtime') {
  if (!result?.requiresAdmin) {
    return;
  }

  const now = Date.now();
  if ((now - lastAdminRequiredToastAt) < ADMIN_REQUIRED_TOAST_INTERVAL_MS) {
    return;
  }

  lastAdminRequiredToastAt = now;
  toast(result.message || 'Abra o JV Printer como Administrador para concluir a instalacao local do MyZap.');
  myzapWarn('MyZap: instalacao local bloqueada por falta de privilegios de administrador', {
    metadata: { context, result }
  });
}

function hasValidConfigMyZap() {
  return !!store.get('apiUrl') && !!store.get('apiToken') && !!store.get('idempresa');
}

function hasValidConfigImpressao() {
  return !!store.get('apiUrl') && !!store.get('printer');
}

function getModoIntegracaoMyZap() {
  return String(store.get('myzap_modoIntegracao') || 'local').trim().toLowerCase() || 'local';
}

function isMyZapModoLocal() {
  return getModoIntegracaoMyZap() === 'local';
}

function rebuildTrayMenu() {
  trayManager.rebuildMenu();
}

/* ── IMPRESSÃO: liga/pausa (pausa PERSISTIDA — sobrevive a restart) ── */
function isImpressaoPausadaPeloUsuario() {
  return store.get('impressao_pausadaPeloUsuario') === true;
}

function startPrintingIfConfigured(trigger = 'runtime') {
  if (printing) return true;
  if (!hasValidConfigImpressao()) return false;
  if (isImpressaoPausadaPeloUsuario()) return false;
  printing = true;
  startPrintWatcher();
  info('Servico de impressao iniciado', { metadata: { trigger } });
  rebuildTrayMenu();
  return true;
}

function setImpressaoPausada(pausada) {
  store.set('impressao_pausadaPeloUsuario', Boolean(pausada));
  if (pausada) {
    printing = false;
    stopPrintWatcher();
    toast('Impressao automatica pausada.');
    info('Impressao pausada pelo usuario');
  } else {
    if (startPrintingIfConfigured('retomada_manual')) {
      toast('Impressao automatica retomada.');
    } else {
      toast('Configure a impressora para retomar a impressao.');
    }
  }
  rebuildTrayMenu();
}

function togglePrinting() {
  setImpressaoPausada(!isImpressaoPausadaPeloUsuario());
}

/* ── ENVIO (fila WhatsApp): pausa persistida ── */
function isEnvioPausadoPeloUsuario() {
  return store.get('myzap_envioPausadoPeloUsuario') === true;
}

function setEnvioPausado(pausado) {
  store.set('myzap_envioPausadoPeloUsuario', Boolean(pausado));
  if (pausado) {
    clearQueueAutoStartTimer();
    stopWhatsappQueueWatcher();
    toast('Envio automatico pausado. As mensagens ficam aguardando na fila.');
    info('Envio pausado pelo usuario');
  } else {
    scheduleQueueAutoStart();
    toast('Envio automatico retomado.');
    info('Envio retomado pelo usuario');
  }
  rebuildTrayMenu();
}

function toggleEnvio() {
  setEnvioPausado(!isEnvioPausadoPeloUsuario());
}

function focusExistingWindow() {
  const targetWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (!targetWindow) {
    return false;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }

  targetWindow.show();
  targetWindow.focus();
  return true;
}

function showPrimaryInstance() {
  if (focusExistingWindow()) {
    return;
  }

  if (!hasValidConfigMyZap()) {
    createSettings();
    return;
  }

  createAppWindow();
}

function handleSecondInstanceLaunch() {
  const revealPrimaryInstance = () => {
    info('Nova execucao detectada; mantendo apenas a instancia principal.', {
      metadata: { pid: process.pid }
    });
    showPrimaryInstance();
    toast('JV Printer ja esta em execucao');
  };

  if (app.isReady()) {
    revealPrimaryInstance();
    return;
  }

  app.whenReady().then(revealPrimaryInstance).catch(() => {});
}

function configureAutoLaunch() {
  if (!app.isPackaged) {
    info('Inicializacao com o sistema ignorada em ambiente de desenvolvimento.', {
      metadata: { platform: process.platform, execPath: process.execPath }
    });
    return;
  }

  if (!['win32', 'darwin'].includes(process.platform)) {
    warn('Inicializacao com o sistema nao suportada nesta plataforma via Electron.', {
      metadata: { platform: process.platform }
    });
    return;
  }

  const loginItemSettings = { openAtLogin: true };

  if (process.platform === 'win32') {
    loginItemSettings.path = process.execPath;
    loginItemSettings.args = AUTO_LAUNCH_ARGS;
    loginItemSettings.enabled = true;
  } else if (process.platform === 'darwin') {
    loginItemSettings.openAsHidden = true;
  }

  app.setLoginItemSettings(loginItemSettings);
}

function getCapabilityMetadata(capability) {
  return getCapabilityEntry(capability, store) || null;
}

function clearQueueAutoStartTimer() {
  if (queueAutoStartTimer) {
    clearInterval(queueAutoStartTimer);
    queueAutoStartTimer = null;
  }
}

function maybeLogCapabilityIgnored(capability, trigger) {
  if (trigger === 'config_refresh') {
    return;
  }

  const labels = {
    supportsPassiveStatus: 'status passivo',
    supportsTokenSync: 'sync de tokens',
    supportsQueuePolling: 'polling da fila'
  };

  myzapInfo(`MyZap: ${labels[capability] || capability} ignorado por nao suportado/desabilitado.`, {
    metadata: {
      trigger,
      capability: getCapabilityMetadata(capability)
    }
  });
}

function applyOptionalWatchersByCapabilities(trigger = 'runtime_apply') {
  const supportsPassiveStatus = isCapabilityEnabled('supportsPassiveStatus', store);
  const supportsTokenSync = isCapabilityEnabled('supportsTokenSync', store);
  const supportsQueuePolling = isCapabilityEnabled('supportsQueuePolling', store);

  if (supportsPassiveStatus) {
    startMyzapStatusWatcher();
  } else {
    if (trigger !== 'config_refresh' || getMyzapStatusWatcherInfo().ativo) {
      maybeLogCapabilityIgnored('supportsPassiveStatus', trigger);
    }
    stopMyzapStatusWatcher();
  }

  if (supportsTokenSync) {
    startTokenSyncWatcher();
  } else {
    if (trigger !== 'config_refresh' || getTokenSyncWatcherStatus().ativo) {
      maybeLogCapabilityIgnored('supportsTokenSync', trigger);
    }
    stopTokenSyncWatcher();
  }

  if (supportsQueuePolling) {
    scheduleQueueAutoStart();
  } else {
    if (trigger !== 'config_refresh' || queueAutoStartTimer || getWhatsappQueueWatcherStatus().ativo) {
      maybeLogCapabilityIgnored('supportsQueuePolling', trigger);
    }
    clearQueueAutoStartTimer();
    stopWhatsappQueueWatcher();
  }
}

function applyMyZapRuntimeByMode(trigger = 'runtime_apply') {
  const modoAtual = getModoIntegracaoMyZap();
  const modoMudou = lastKnownModoIntegracao !== null && lastKnownModoIntegracao !== modoAtual;
  lastKnownModoIntegracao = modoAtual;

  if (isMyZapModoLocal()) {
    startSupervisor({ onNotify: (msg) => trayManager.notify(msg) });
    applyOptionalWatchersByCapabilities(trigger);
    rebuildTrayMenu();
    return;
  }

  clearQueueAutoStartTimer();
  stopSupervisor();

  stopWhatsappQueueWatcher();
  stopMyzapStatusWatcher();
  stopTokenSyncWatcher();

  deleteSession().catch((err) => {
    myzapWarn('Falha ao encerrar sessao WhatsApp na troca para modo web', {
      metadata: { error: err?.message || String(err) }
    });
  });

  try {
    killMyZapProcess();
  } catch (_e) { /* melhor esforco */ }

  try {
    killProcessesOnPort(5555);
  } catch (_e) { /* melhor esforco */ }

  if (modoMudou) {
    toast('MyZap alterado para modo web/online. Rotinas locais desativadas.');
  }
  myzapInfo('MyZap em modo web/online. Rotinas locais e processo MyZap foram desativados.', {
    metadata: { modo: modoAtual }
  });
  rebuildTrayMenu();
}

function handleUpdateCheck() {
  // Busca MANUAL (botao/tray): com toasts de progresso e de "nada novo".
  checkForUpdates(autoUpdater, { toast, warn }, { manual: true });
}

/** Botao unico de atualizacao: busca APP e MOTOR juntos, com toasts. */
function checkAllUpdatesManual() {
  handleUpdateCheck();
  updateMyZapNow().catch((err) => {
    myzapWarn('Falha na busca manual de update do MyZap', {
      metadata: { error: err?.message || String(err) }
    });
  });
}

let appUpdateCheckTimer = null;
const APP_UPDATE_CHECK_INTERVAL_MS = 45 * 60 * 1000;

// O app vive semanas na bandeja: checar update SO no boot deixava clientes
// para tras. Agora: boot + a cada 45min, sempre silencioso.
function scheduleAppUpdateChecks() {
  checkForUpdates(autoUpdater, { toast, warn });

  if (appUpdateCheckTimer) return;
  appUpdateCheckTimer = setInterval(() => {
    checkForUpdates(autoUpdater, { toast, warn });
  }, APP_UPDATE_CHECK_INTERVAL_MS);
}

let reparoManualEmAndamento = false;

async function repararMyZapAgora() {
  if (reparoManualEmAndamento) {
    toast('Reparo ja em andamento, aguarde...');
    return { status: 'busy', message: 'Reparo ja em andamento.' };
  }

  if (!hasValidConfigMyZap()) {
    toast('Configure API/Token/Empresa antes de reparar o MyZap');
    createSettings();
    return { status: 'error', message: 'Configuracao base ausente.' };
  }

  if (!isMyZapModoLocal()) {
    toast('Modo web/online ativo: nao ha servico local para reparar.');
    return { status: 'skipped', message: 'Modo web/online ativo.' };
  }

  reparoManualEmAndamento = true;
  toast('Reparando o MyZap... isso pode levar alguns minutos.');
  myzapInfo('Reparo manual do MyZap solicitado pelo usuario');

  // Reparo manual = usuario QUER o MyZap de volta: a marca de "removido pelo
  // usuario" nao pode continuar vetando auto-start/auto-heal depois disso.
  if (store.get('myzap_userRemovedLocal') === true) {
    store.delete('myzap_userRemovedLocal');
    myzapInfo('Flag myzap_userRemovedLocal limpa pelo reparo manual');
  }

  try {
    const result = await forceRepair();
    toast(result?.message || 'Reparo finalizado.');

    if (result?.status === 'success') {
      applyMyZapRuntimeByMode('manual_repair');
      enviarStatusMyZap().catch(() => {});
    }
    return result;
  } catch (err) {
    myzapError('Erro inesperado no reparo manual do MyZap', { metadata: { error: err } });
    toast('Erro inesperado ao reparar o MyZap. Veja os logs.');
    return { status: 'error', message: err?.message || String(err) };
  } finally {
    reparoManualEmAndamento = false;
  }
}

async function updateMyZapNow() {
  if (myzapManualUpdateInProgress) {
    toast('Atualizacao do MyZap ja em andamento');
    return;
  }

  if (!hasValidConfigMyZap()) {
    toast('Configure API/Token/Empresa antes de atualizar o MyZap');
    createSettings();
    return;
  }

  myzapManualUpdateInProgress = true;
  toast('Atualizando MyZap manualmente...');
  myzapInfo('Atualizacao manual do MyZap solicitada');

  // Mesmo racional do reparo manual: pedido explicito de atualizar = quer o
  // MyZap rodando; a flag de remocao nao pode seguir travando o auto-start.
  if (store.get('myzap_userRemovedLocal') === true) {
    store.delete('myzap_userRemovedLocal');
    myzapInfo('Flag myzap_userRemovedLocal limpa pela atualizacao manual');
  }

  try {
    const result = await ensureMyZapReadyAndStart({ forceRemote: true });
    notifyAdminRequired(result, 'manual_update');
    applyMyZapRuntimeByMode('manual_update');

    if (result?.status === 'success' && result?.skippedLocalStart) {
      toast('Modo web/online ativo. Atualizacao local ignorada.');
      return;
    }

    if (result?.status !== 'success') {
      toast(`Falha ao atualizar MyZap: ${result?.message || 'erro desconhecido'}`);
      myzapWarn('Falha na atualizacao manual do MyZap', { metadata: { result } });
      return;
    }

    // Preferencia (v3): Runtime Pack — artefato pronto com rollback. Sem
    // release no canal, cai no fluxo legado por commit SHA.
    const packResult = await checkAndUpdatePack();
    if (packResult?.status === 'success') {
      toast(packResult.message || 'MyZap atualizado para a versao mais recente!');
    } else if (packResult?.status === 'up_to_date') {
      toast(packResult.message || 'MyZap ja esta na versao mais recente. Configuracoes reaplicadas.');
    } else if (packResult?.status === 'busy') {
      toast('Outra operacao do MyZap em andamento. Tente novamente em instantes.');
    } else if (packResult?.status === 'no_source') {
      const codeResult = await checkAndUpdateIfNeeded();
      if (codeResult?.status === 'success' && codeResult?.upToDate) {
        toast('MyZap ja esta na versao mais recente. Configuracoes reaplicadas.');
      } else if (codeResult?.status === 'success') {
        toast('MyZap atualizado para a versao mais recente!');
      } else if (codeResult?.status === 'busy') {
        toast('Outra operacao do MyZap em andamento. Tente novamente em instantes.');
      } else if (codeResult?.status === 'skipped') {
        toast('MyZap reiniciado. Nao foi possivel checar nova versao (sem rede?).');
      } else {
        toast(`Falha ao atualizar codigo do MyZap: ${codeResult?.message || 'erro desconhecido'}`);
      }
    } else {
      toast(`Falha ao atualizar MyZap: ${packResult?.message || 'erro desconhecido'}`);
    }

    if (isMyZapModoLocal()) {
      enviarStatusMyZap().catch((err) => {
        myzapWarn('Falha ao enviar status apos atualizacao manual do MyZap', {
          metadata: { error: err }
        });
      });
    }
  } catch (err) {
    toast('Erro inesperado ao atualizar MyZap');
    myzapError('Erro inesperado na atualizacao manual do MyZap', {
      metadata: { error: err }
    });
  } finally {
    myzapManualUpdateInProgress = false;
  }
}

async function adoptMyZapBaselineSha() {
  if (!hasValidConfigMyZap() || !isMyZapModoLocal()) return;
  if (store.get('myzap_userRemovedLocal') === true) return;

  try {
    const { getInstalledSha, setInstalledSha, fetchRemoteMainSha } = require('./core/myzap/updateChecker');
    if (getInstalledSha()) return;

    const sha = await fetchRemoteMainSha();
    if (sha) {
      setInstalledSha(sha);
      myzapInfo('MyZap: SHA atual adotado como baseline (sem atualizar codigo)', {
        metadata: { sha }
      });
    }
  } catch (err) {
    myzapWarn('MyZap: falha ao adotar baseline de versao', {
      metadata: { error: err?.message || String(err) }
    });
  }
}

async function runAutoPackUpdateCycle() {
  if (!hasValidConfigMyZap() || !isMyZapModoLocal()) return;
  if (store.get('myzap_userRemovedLocal') === true) return;

  try {
    if (getWhatsappQueueWatcherStatus()?.processando) {
      myzapInfo('MyZap: update automatico adiado (fila processando)');
      setTimeout(() => { runAutoPackUpdateCycle().catch(() => {}); }, 15 * 60 * 1000);
      return;
    }
  } catch (_e) { /* segue */ }

  try {
    const result = await checkAndUpdatePack();
    if (result?.status === 'success') {
      toast(result.message || 'MyZap atualizado automaticamente.');
      applyMyZapRuntimeByMode('auto_pack_update');
    } else if (result?.status === 'no_source') {
      await adoptMyZapBaselineSha();
    } else if (result?.status === 'error') {
      myzapWarn('MyZap: update automatico via pack falhou', { metadata: { result } });
    }
  } catch (err) {
    myzapWarn('MyZap: erro no ciclo automatico de update do pack', {
      metadata: { error: err?.message || String(err) }
    });
  }
}

function scheduleMyZapCodeUpdateCheck() {
  if (myzapCodeUpdateTimer) return;

  setTimeout(() => {
    runAutoPackUpdateCycle().catch(() => {});
  }, MYZAP_CODE_UPDATE_FIRST_DELAY_MS);

  myzapCodeUpdateTimer = setInterval(() => {
    runAutoPackUpdateCycle().catch(() => {});
  }, MYZAP_CODE_UPDATE_INTERVAL_MS);
}

async function autoStartMyZap() {
  if (!hasValidConfigMyZap()) {
    myzapWarn('MyZap: configuracoes base ausentes (apiUrl/apiToken/idempresa).');
    toast('Configure o sistema pelo icone na bandeja');
    createSettings();
    return;
  }

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

    notifyAdminRequired(result, 'auto_start');

    if (result.status === 'success' && result?.skippedLocalStart) {
      myzapInfo('MyZap em modo web/online. Execucao local desativada.', {
        metadata: { modo: getModoIntegracaoMyZap() }
      });
    } else if (result.status === 'success') {
      toast('Servico MyZap iniciado automaticamente');
      // WhatsApp desconectado precisa de gente (QR): abre o painel sozinho
      // na aba certa — o renderer conecta e o QR aparece sem clique.
      setTimeout(async () => {
        try {
          const verifyRealStatus = require('./core/myzap/api/verifyRealStatus');
          const { parseSessionPayload } = require('./core/myzap/api/sessionSnapshotParser');
          const parsed = parseSessionPayload(await verifyRealStatus());
          if (!parsed.isConnected) {
            createAppWindow('whatsapp');
          }
        } catch (_e) {
          createAppWindow('whatsapp');
        }
      }, 8000);
    } else {
      myzapError('MyZap: falha no fluxo automatico de start', { metadata: { result } });
      createAppWindow();
    }

    applyMyZapRuntimeByMode('auto_start');
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
      notifyAdminRequired(startResult, 'config_refresh_mode_switch');
      if (startResult?.status !== 'success') {
        myzapWarn('MyZap: falha ao iniciar ambiente local apos troca de modo', {
          metadata: { startResult }
        });
      }
    }

    applyMyZapRuntimeByMode('config_refresh');
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

  if (isEnvioPausadoPeloUsuario()) {
    clearQueueAutoStartTimer();
    stopWhatsappQueueWatcher();
    return true;
  }

  if (!isCapabilityEnabled('supportsQueuePolling', store)) {
    myzapInfo('Watcher da fila MyZap ignorado por nao suportado/desabilitado', {
      metadata: {
        trigger: 'auto_queue_start',
        capability: getCapabilityMetadata('supportsQueuePolling')
      }
    });
    clearQueueAutoStartTimer();
    stopWhatsappQueueWatcher();
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
  if (!isCapabilityEnabled('supportsQueuePolling', store) || isEnvioPausadoPeloUsuario()) {
    clearQueueAutoStartTimer();
    stopWhatsappQueueWatcher();
    return;
  }

  if (getWhatsappQueueWatcherStatus().ativo) {
    clearQueueAutoStartTimer();
    return;
  }

  if (queueAutoStartTimer) {
    return;
  }

  queueAutoStartTimer = setInterval(() => {
    tryStartQueueWatcherAuto();
  }, 30000);
  tryStartQueueWatcherAuto();
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', handleSecondInstanceLaunch);

  attachAutoUpdaterHandlers(autoUpdater, { toast, getQueueStatus: getWhatsappQueueWatcherStatus });
  setQueueNotifier((msg) => trayManager.notify(msg));

  app.whenReady().then(() => {
    if (redirectToPerUserIfInstalled({ app })) {
      return;
    }

    configureAutoLaunch();

    // Crash de qualquer renderer (janela de impressao inclusa) vira log —
    // e NAO derruba o app (protecao critica das impressoras termicas).
    app.on('render-process-gone', (_event, webContents, details) => {
      const crashInfo = {
        reason: details.reason,
        exitCode: details.exitCode,
        url: webContents?.getURL?.()?.substring(0, 200) || 'desconhecida',
        title: webContents?.getTitle?.() || 'sem titulo'
      };
      error('CRASH RENDERER: processo de renderizacao morreu', {
        metadata: { ...crashInfo, area: 'render-process-gone' }
      });
      try {
        const crashLine = JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'CRASH_RENDERER',
          ...crashInfo
        }) + require('os').EOL;
        const crashLogPath = require('path').join(require('os').tmpdir(), 'jv-printer', 'logs', 'crash.log');
        require('fs').appendFileSync(crashLogPath, crashLine, 'utf8');
      } catch (_e) { /* melhor esforco */ }
    });

    app.on('child-process-gone', (_event, details) => {
      const crashInfo = {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        name: details.name || 'desconhecido'
      };
      error('CRASH CHILD: processo filho morreu', {
        metadata: { ...crashInfo, area: 'child-process-gone' }
      });
      try {
        const crashLine = JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'CRASH_CHILD',
          ...crashInfo
        }) + require('os').EOL;
        const crashLogPath = require('path').join(require('os').tmpdir(), 'jv-printer', 'logs', 'crash.log');
        require('fs').appendFileSync(crashLogPath, crashLine, 'utf8');
      } catch (_e) { /* melhor esforco */ }
    });

    info('Aplicacao pronta para uso', {
      metadata: { ambiente: app.isPackaged ? 'producao' : 'desenvolvimento' }
    });

    if (app.isPackaged && process.platform === 'win32'
      && /\\Program Files( \(x86\))?\\/i.test(process.execPath)) {
      setTimeout(() => {
        offerPerUserMigration({ app, dialog, toast }).catch((err) => {
          warn('Falha na oferta de migracao do instalador', {
            metadata: { error: err?.message || String(err) }
          });
        });
      }, 30 * 1000);
    }

    try { limparLogsAntigos(); } catch (e) { warn('Falha ao limpar logs antigos', { metadata: { error: e?.message || e } }); }
    setInterval(() => {
      try { limparLogsAntigos(); } catch (e) { warn('Falha ao limpar logs antigos', { metadata: { error: e?.message || e } }); }
    }, 6 * 60 * 60 * 1000);

    trayManager.init(
      path.join(__dirname, 'assets/icon.png'),
      {
        openPanel: () => createAppWindow(),
        togglePrinting,
        toggleEnvio,
        checkAllUpdates: checkAllUpdatesManual
      },
      app.getVersion(),
      {
        impressaoAtiva: () => printing && !isImpressaoPausadaPeloUsuario(),
        envioAtivo: () => !isEnvioPausadoPeloUsuario()
      }
    );

    setTrayCallback(rebuildTrayMenu);
    rebuildTrayMenu();

    // IMPRESSÃO: liga imediatamente se configurada (independente do MyZap —
    // isolamento total: problema no WhatsApp nunca para a impressao).
    if (startPrintingIfConfigured('boot')) {
      toast('Servico de impressao iniciado');
    } else if (hasValidConfigImpressao() && isImpressaoPausadaPeloUsuario()) {
      info('Impressao pausada pelo usuario (persistido) — aguardando retomada manual');
    }

    if (!hasValidConfigMyZap()) {
      warn('Configuracao da API ausente no startup', {
        metadata: {
          apiUrl: !!store.get('apiUrl'),
          apiToken: !!store.get('apiToken'),
          idempresa: !!store.get('idempresa')
        }
      });
      toast('Configure o sistema antes de iniciar');
      createSettings();
    } else if (!store.get('printer')) {
      // Config base ok mas SEM impressora: o painel abre direto na aba certa.
      createAppWindow('impressao');
    }

    try {
      const progress = getCurrentProgress();
      if (progress && progress.active) {
        myzapWarn('Progresso stale detectado na inicializacao, limpando', {
          metadata: { progress }
        });
        clearProgress();
      }
    } catch (_e) { /* melhor esforco */ }

    try { cleanupPackLeftovers(); } catch (_e) { /* melhor esforco */ }

    runPostUpdateRepairIfNeeded(app.getVersion())
      .catch((err) => {
        myzapWarn('Falha no saneamento pos-update (seguindo o boot)', {
          metadata: { error: err?.message || String(err) }
        });
      })
      .finally(() => {
        autoStartMyZap();
      });

    scheduleMyZapConfigRefresh();
    scheduleMyZapCodeUpdateCheck();
    scheduleAppUpdateChecks();
  });

  app.on('window-all-closed', (e) => e.preventDefault());

  app.on('before-quit', () => {
    // Sair para o MOTOR de proposito (sem EPIPE/orfaos) e a impressao limpa.
    try { killMyZapProcess(); } catch (_e) { /* melhor esforco */ }
    try { stopPrintWatcher(); } catch (_e) { /* melhor esforco */ }

    if (myzapConfigRefreshTimer) {
      clearInterval(myzapConfigRefreshTimer);
      myzapConfigRefreshTimer = null;
    }

    if (appUpdateCheckTimer) {
      clearInterval(appUpdateCheckTimer);
      appUpdateCheckTimer = null;
    }

    if (myzapCodeUpdateTimer) {
      clearInterval(myzapCodeUpdateTimer);
      myzapCodeUpdateTimer = null;
    }

    clearQueueAutoStartTimer();
    stopSupervisor();

    stopWhatsappQueueWatcher();
    stopMyzapStatusWatcher();
    stopTokenSyncWatcher();
  });

  /* ── IPC ─────────────────────────────────────────────── */
  ipcMain.handle('settings:get', (_e, key) => store.get(key));
  ipcMain.handle('myzap:checkForUpdates', async () => {
    try {
      checkForUpdates(autoUpdater, { toast, warn }, { manual: true });
      return {
        status: 'success',
        message: app.isPackaged
          ? 'Buscando atualizacao... se houver, o app avisa e instala ao reiniciar.'
          : 'Atualizacao automatica so funciona na versao instalada (.exe).'
      };
    } catch (e) {
      return { status: 'error', message: e?.message || String(e) };
    }
  });
  ipcMain.handle('myzap:getSupervisorStatus', () => getSupervisorStatus());

  // ── Janela unica (v4): visao composta em UMA chamada ──
  ipcMain.handle('app:getOverview', () => {
    let queue = null;
    try { queue = getWhatsappQueueWatcherStatus(); } catch (_e) { /* */ }
    let supervisor = null;
    try { supervisor = getSupervisorStatus(); } catch (_e) { /* */ }
    let progress = null;
    try { progress = getCurrentProgress(); } catch (_e) { /* */ }
    let engineState = null;
    try {
      const { getStateSnapshot } = require('./core/myzap/stateMachine');
      engineState = getStateSnapshot();
    } catch (_e) { /* */ }
    let printingStatus = null;
    try { printingStatus = getPrintingStatus(); } catch (_e) { /* */ }
    return {
      progress,
      engineState,
      appVersion: app.getVersion(),
      packVersion: (() => { try { return getInstalledPackVersion(); } catch (_e) { return null; } })(),
      updater: (() => { try { return getUpdaterStatus(); } catch (_e) { return null; } })(),
      supervisor,
      queue,
      envioPausadoPeloUsuario: isEnvioPausadoPeloUsuario(),
      modoIntegracao: getModoIntegracaoMyZap(),
      configured: hasValidConfigMyZap(),
      isPackaged: app.isPackaged,
      // ── impressão ──
      printing: {
        ...(printingStatus || {}),
        rodando: printing,
        pausadoPeloUsuario: isImpressaoPausadaPeloUsuario(),
        impressora: String(store.get('printer') || ''),
        larguraPapelMm: Number(store.get('printer_paper_mm')) || null,
        configurada: hasValidConfigImpressao()
      }
    };
  });

  ipcMain.handle('app:toggleEnvio', () => {
    toggleEnvio();
    return { pausado: isEnvioPausadoPeloUsuario() };
  });

  ipcMain.handle('app:togglePrinting', () => {
    togglePrinting();
    return { pausado: isImpressaoPausadaPeloUsuario() };
  });

  // Grava a impressora padrao e liga o servico na hora se ficou completo.
  // Largura do papel (58/80mm) — '' = automatica (default do driver, modo
  // historico do campo). Necessaria em drivers com DEVMODE quebrado (MPT-II).
  ipcMain.handle('printers:setPaperWidth', (_e, mm) => {
    const valor = [58, 80].includes(Number(mm)) ? Number(mm) : '';
    store.set('printer_paper_mm', valor);
    info('Largura de papel configurada', { metadata: { printer_paper_mm: valor } });
    return { status: 'success', printer_paper_mm: valor };
  });

  ipcMain.handle('printers:setDefault', (_e, printerName) => {
    const nome = String(printerName || '').trim();
    store.set('printer', nome);
    info('Impressora padrao definida pelo usuario', { metadata: { printer: nome } });
    if (nome) {
      startPrintingIfConfigured('printer_saved');
    }
    return { status: 'success', printer: nome };
  });

  // Teste fisico de 1 clique — usa EXATAMENTE o mesmo caminho da producao
  // (imprimirHtml), na impressora padrao configurada.
  ipcMain.handle('printers:test', async () => {
    const printerName = String(store.get('printer') || '').trim();
    if (!printerName) {
      return { status: 'error', message: 'Escolha e salve uma impressora antes do teste.' };
    }
    const agora = new Date().toLocaleString('pt-BR');
    const html = `<div style="font-family:monospace;text-align:center">
      <h2>JV PRINTER</h2>
      <p>Teste de impressao</p>
      <hr>
      <p>${agora}</p>
      <p>Impressora: ${printerName}</p>
      <hr>
      <p>Se voce esta lendo isto,<br>a impressao esta funcionando.</p>
    </div>`;
    try {
      const resultado = await imprimirHTML({ msg: html, printerName, paperWidthMm: Number(store.get('printer_paper_mm')) || null });
      return { status: 'success', message: `Teste enviado (job ${resultado.jobId}).` };
    } catch (err) {
      return { status: 'error', message: `Falha no teste: ${err?.message || err}` };
    }
  });

  ipcMain.handle('app:checkAllUpdates', async () => {
    checkAllUpdatesManual();
    return { status: 'success', message: 'Buscando atualizacoes do app e do MyZap...' };
  });

  // Mensagem padrao: grava no store E aplica no MyZap local na hora.
  ipcMain.handle('app:setMensagemPadrao', async (_e, mensagem) => {
    const texto = String(mensagem ?? '').trim();
    store.set('myzap_mensagemPadrao', texto);
    try {
      const updateIaConfig = require('./core/myzap/api/updateIaConfig');
      const result = await updateIaConfig(texto);
      if (result?.status === 'success' || result?.status === 'skipped') {
        return result;
      }
      return {
        status: 'warning',
        message: 'Mensagem salva. Sera aplicada assim que o MyZap local estiver no ar.'
      };
    } catch (err) {
      return {
        status: 'warning',
        message: 'Mensagem salva. Sera aplicada assim que o MyZap local estiver no ar.'
      };
    }
  });

  ipcMain.handle('app:openLogViewer', () => { openLogViewer(); return { status: 'success' }; });
  ipcMain.handle('app:openLogsFolder', () => { abrirPastaLogs(); return { status: 'success' }; });
  ipcMain.handle('app:openAjudaArquivo', () => {
    try {
      const { shell } = require('electron');
      const caminho = criarArquivoAjuda();
      if (caminho) shell.openPath(caminho);
      return { status: 'success' };
    } catch (e) {
      return { status: 'error', message: e?.message || String(e) };
    }
  });

  ipcMain.handle('app:getDiagnostics', async () => {
    const linhas = [];
    const add = (k, v) => linhas.push(`${k}: ${v}`);
    try {
      add('JV Printer', `v${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}`);
      add('MyZap (pack)', getInstalledPackVersion() || 'legado/sem manifest');
      add('Windows', `${process.platform} ${require('os').release()}`);
      add('Data', new Date().toISOString());
      add('Empresa', String(store.get('idempresa') || '(nao configurada)'));
      add('API', String(store.get('apiUrl') || '(nao configurada)'));
      add('Modo', getModoIntegracaoMyZap());
      const pr = getPrintingStatus();
      add('Impressora', String(store.get('printer') || '(nao configurada)'));
      add('Impressao', isImpressaoPausadaPeloUsuario() ? 'PAUSADA pelo usuario' : (printing ? 'ativa' : 'parada'));
      add('Impressoes hoje', String(pr?.impressoesHoje ?? 0));
      if (pr?.ultimaImpressaoEm) add('Ultima impressao', `${pr.ultimaImpressaoEm} (ticket ${pr.ultimoTicketRef ?? '?'})`);
      if (pr?.ultimoErroImpressao) add('Ultimo erro de impressao', `${pr.ultimoErroImpressao.erro} (${pr.ultimoErroImpressao.em})`);
      const sup = getSupervisorStatus();
      add('Servico MyZap', sup?.saudavel ? 'saudavel' : `problema (${sup?.ultimaVerificacao?.detail || sup?.ultimaVerificacao?.state || 'sem dado'})`);
      add('Supervisor', `${sup?.ativo ? 'ativo' : 'parado'} | falhas seguidas: ${sup?.falhasConsecutivas} | breaker: ${sup?.breaker?.estado}`);
      const q = getWhatsappQueueWatcherStatus();
      add('Envio automatico', isEnvioPausadoPeloUsuario() ? 'PAUSADO pelo usuario' : (q?.ativo ? 'ativo' : 'parado'));
      add('Fila', `ultimo lote: ${q?.ultimoLote ?? '-'} | enviados hoje: ${q?.enviadosHoje ?? '-'} | pausa: ${q?.motivoPausa || 'nenhuma'}`);
      if (q?.ultimoErroDetalhe?.message) {
        add('Ultimo erro de envio', `${q.ultimoErroDetalhe.message} (${q.ultimoErroDetalhe.etapa}, ${q.ultimoErroDetalhe.timestamp})`);
      }
      const up = getUpdaterStatus();
      add('Update do app', `${up?.phase || 'idle'}${up?.percent ? ` ${up.percent}%` : ''}${up?.detail ? ` ${up.detail}` : ''}`);
    } catch (err) {
      linhas.push(`(diagnostico parcial: ${err?.message || err})`);
    }
    return linhas.join('\n');
  });

  registerPrinterHandlers(ipcMain);
  registerMyZapHandlers(ipcMain);

  ipcMain.on('settings-saved', async (_e, { idempresa, apiUrl, apiToken, printer }) => {
    info('Configuracoes da API salvas pelo usuario', {
      metadata: { idempresa, apiUrl }
    });

    const previousBackendProfileKey = buildBackendProfileKey({
      apiUrl: store.get('apiUrl'),
      idempresa: store.get('idempresa')
    });
    const nextBackendProfileKey = buildBackendProfileKey({ apiUrl, idempresa });

    if (previousBackendProfileKey && nextBackendProfileKey && previousBackendProfileKey !== nextBackendProfileKey) {
      myzapInfo('MyZap: backend/API da empresa alterado. Limpando cache remoto derivado.', {
        metadata: { previousBackendProfileKey, nextBackendProfileKey }
      });
      clearDerivedBackendState(store);
    }

    const payload = { idempresa, apiUrl, apiToken, myzap_backendProfileKey: nextBackendProfileKey };
    // Compat: payload antigo trazia a impressora junto; o novo salva pela
    // aba Impressao (printers:setDefault). undefined = preserva a atual.
    if (printer !== undefined) payload.printer = printer;
    store.set(payload);

    startPrintingIfConfigured('settings_saved');
    await autoStartMyZap();
  });

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
      myzap_backendApiUrl: clickexpress_apiUrl,
      myzap_backendApiToken: clickexpress_queueToken,
      clickexpress_apiUrl,
      clickexpress_queueToken
    });

    const result = await ensureMyZapReadyAndStart({ forceRemote: true });
    if (result.status === 'success') {
      toast('MyZap: configuracoes atualizadas automaticamente!');
    }

    applyMyZapRuntimeByMode('panel_manual_save');
    if (isMyZapModoLocal()) {
      enviarStatusMyZap().catch((err) => {
        myzapWarn('Falha ao enviar status passivo do MyZap apos salvar configuracoes', {
          metadata: { error: err }
        });
      });
    }
  });

  ipcMain.handle('myzap:repairService', () => repararMyZapAgora());
  ipcMain.handle('myzap:getCapabilitySnapshot', () => getCapabilitySnapshotPayload(store));
  ipcMain.handle('myzap:saveCapabilityPreferences', async (_e, preferences = {}) => {
    const result = saveCapabilityPreferences(preferences, store);
    applyMyZapRuntimeByMode('preferences_saved');
    rebuildTrayMenu();
    return result;
  });

  process.on('uncaughtException', (err) => {
    const fsCrash = require('fs');
    const osCrash = require('os');
    const crashDir = require('path').join(osCrash.tmpdir(), 'jv-printer', 'logs');
    try {
      if (!fsCrash.existsSync(crashDir)) fsCrash.mkdirSync(crashDir, { recursive: true });
      const crashLine = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'CRASH',
        type: 'uncaughtException',
        message: err?.message || String(err),
        stack: err?.stack || 'sem stack',
        pid: process.pid
      }) + osCrash.EOL;
      fsCrash.appendFileSync(require('path').join(crashDir, 'crash.log'), crashLine, 'utf8');
    } catch (_e) { /* melhor esforco */ }

    error('uncaughtException', {
      metadata: { error: err, stack: err?.stack }
    });
  });

  process.on('unhandledRejection', (reason) => {
    const fsCrash = require('fs');
    const osCrash = require('os');
    const crashDir = require('path').join(osCrash.tmpdir(), 'jv-printer', 'logs');
    try {
      if (!fsCrash.existsSync(crashDir)) fsCrash.mkdirSync(crashDir, { recursive: true });
      const crashLine = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'CRASH',
        type: 'unhandledRejection',
        message: reason?.message || String(reason),
        stack: reason?.stack || 'sem stack',
        pid: process.pid
      }) + osCrash.EOL;
      fsCrash.appendFileSync(require('path').join(crashDir, 'crash.log'), crashLine, 'utf8');
    } catch (_e) { /* melhor esforco */ }

    error('unhandledRejection', {
      metadata: { error: reason, stack: reason?.stack }
    });
  });

  process.on('exit', (code) => {
    const fsCrash = require('fs');
    const osCrash = require('os');
    const crashDir = require('path').join(osCrash.tmpdir(), 'jv-printer', 'logs');
    try {
      if (!fsCrash.existsSync(crashDir)) fsCrash.mkdirSync(crashDir, { recursive: true });
      const exitLine = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'EXIT',
        type: 'process_exit',
        code,
        pid: process.pid
      }) + osCrash.EOL;
      fsCrash.appendFileSync(require('path').join(crashDir, 'crash.log'), exitLine, 'utf8');
    } catch (_e) { /* melhor esforco */ }
  });
}
