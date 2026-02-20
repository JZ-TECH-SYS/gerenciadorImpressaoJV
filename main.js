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

const verificarDiretorio = require('./core/myzap/verificarDiretorio');
const atualizarEnv = require('./core/myzap/atualizarEnv');

/* ---------- store ---------- */
const store = new Store({
  defaults: { apiUrl: '', idempresa: '', printer: '' }
});

/* ---------- state ---------- */
let printing = false;
let queueAutoStartTimer = null; // será alterado depois

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
  return !!store.get('myzap_diretorio') && !!store.get('myzap_sessionKey') && !!store.get('myzap_apiToken') && !!store.get('myzap_envContent');
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
  const envContent = store.get('myzap_envContent');
  console.log('Auto-start MyZap com diretório:', diretorio);

  if (!hasValidConfigMyZap()) {
    warn('MyZap: Configurações ausentes.');
    toast('Configure o MyZap pelo ícone na bandeja');
    return;
  }

  try {
    const checkDir = await verificarDiretorio(diretorio);

    if (checkDir.status !== 'success') {
      warn('MyZap: Diretório vazio ou inválido.');
      toast('MyZap: Diretório inválido. Configure pelo ícone na bandeja');
      return;
    }

    info('MyZap: Reiniciando serviço automático...');
    const result = await atualizarEnv(diretorio, envContent);

    if (result.status === 'success') {
      toast('Serviço MyZap reiniciado automaticamente');
    } else {
      error('MyZap: Falha ao reiniciar automaticamente', { metadata: { result } });
    }

  } catch (err) {
    error('MyZap: Erro crítico no auto-start', { metadata: { error: err } });
  }
}


async function tryStartQueueWatcherAuto() {
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
  scheduleQueueAutoStart();
  startMyzapStatusWatcher();

  // Auto update: verifica e aplica (silencioso)
  handleUpdateCheck();
});

// (Atualização já aplicada na fila acima)

/* =========================================================
  3. Janelas nunca fecham o app (fica só no tray)
========================================================= */
app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => {
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
  info('Configurações salvas pelo usuário', {
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

  if (myzap_diretorio) {
    const result = await atualizarEnv(myzap_diretorio, myzap_envContent);

    if (result.status === 'success') {
      toast('MyZap: Configurações atualizadas!');
    }
  }

  scheduleQueueAutoStart();
  enviarStatusMyZap().catch((err) => {
    warn('Falha ao enviar status passivo do MyZap apos salvar configuracoes', {
      metadata: { error: err }
    });
  });
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









