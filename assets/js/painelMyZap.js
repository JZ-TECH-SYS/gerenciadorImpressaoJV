function setButtonsState({ canStart, canDelete }) {
  const btnStart = document.getElementById('btn-start-session');
  const btnDelete = document.getElementById('btn-delete-session');

  if (btnStart) btnStart.disabled = !canStart;
  if (btnDelete) btnDelete.disabled = !canDelete;
}

function setIaConfigVisibility(isVisible) {
  const box = document.getElementById('ia-config-box');
  if (!box) return;
  box.classList.toggle('d-none', !isVisible);
}

const CONFIG_SYNC_INTERVAL_MS = 30 * 1000;
const QUEUE_POLL_INTERVAL_MS = 30 * 1000;
const STATUS_WATCH_INTERVAL_MS = 10 * 1000;
const PROGRESS_POLL_INTERVAL_MS = 1000;
const STALE_PROGRESS_HIDE_MS = 15 * 60 * 1000;

let myzapProgressPollTimer = null;

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function getProgressPercentByPhase(phase) {
  const map = {
    start: 5,
    prepare: 10,
    remote_validate: 15,
    check_install: 25,
    install_local: 35,
    update_existing_install: 55,
    precheck: 10,
    reinstall_cleanup: 20,
    clone_repo: 35,
    install_dependencies: 55,
    sync_configs: 75,
    restart_service: 78,
    start_service: 88,
    check_runtime: 86,
    git_pull: 90,
    run_start: 93,
    wait_port: 96,
    ready: 98,
    start_confirmed: 95,
    sync_ia: 97,
    already_running: 95,
    done: 100,
    error: 100,
    mode_web: 100
  };

  return map[String(phase || '').trim().toLowerCase()] ?? 0;
}

function getProgressPhaseLabel(phase) {
  const normalized = String(phase || '').trim().toLowerCase();
  if (!normalized) return 'aguardando';

  const labels = {
    start: 'inicio',
    prepare: 'preparacao',
    remote_validate: 'validacao remota',
    check_install: 'verificacao local',
    install_local: 'instalacao local',
    update_existing_install: 'atualizacao local',
    precheck: 'pre-requisitos',
    reinstall_cleanup: 'limpeza',
    clone_repo: 'clone git',
    install_dependencies: 'dependencias',
    sync_configs: 'sync configs',
    restart_service: 'reinicio',
    start_service: 'inicializacao',
    check_runtime: 'runtime',
    git_pull: 'git pull',
    run_start: 'start',
    wait_port: 'porta local',
    ready: 'servico pronto',
    start_confirmed: 'confirmacao',
    sync_ia: 'sync ia',
    already_running: 'ja em execucao',
    done: 'concluido',
    error: 'erro',
    mode_web: 'modo online'
  };

  return labels[normalized] || normalized.replace(/_/g, ' ');
}

function shouldHideProgress(progress) {
  if (!progress || typeof progress !== 'object') return true;
  if (!progress.active && String(progress.phase || '').toLowerCase() === 'mode_web') {
    return true;
  }
  if (!progress.active) {
    const updatedAt = Number(progress.updated_at || 0);
    if (updatedAt > 0 && (Date.now() - updatedAt) > STALE_PROGRESS_HIDE_MS) {
      return true;
    }
  }
  return false;
}

function resolveProgressPercent(progress = {}) {
  const fromMetadata = progress?.metadata?.percent;
  if (fromMetadata !== undefined && fromMetadata !== null && fromMetadata !== '') {
    return clampPercent(fromMetadata);
  }
  return clampPercent(getProgressPercentByPhase(progress?.phase));
}

function applyProgressStateClasses(box, bar, state, isActive) {
  box.classList.remove('alert-info', 'alert-success', 'alert-danger', 'alert-secondary');
  bar.classList.remove('bg-info', 'bg-success', 'bg-danger');

  if (state === 'success') {
    box.classList.add('alert-success');
    bar.classList.add('bg-success');
    bar.classList.remove('progress-bar-animated');
    return;
  }

  if (state === 'error') {
    box.classList.add('alert-danger');
    bar.classList.add('bg-danger');
    bar.classList.remove('progress-bar-animated');
    return;
  }

  box.classList.add('alert-info');
  bar.classList.add('bg-info');
  if (isActive) {
    bar.classList.add('progress-bar-animated');
  } else {
    bar.classList.remove('progress-bar-animated');
  }
}

function renderMyZapProgress(progress) {
  const box = document.getElementById('myzap-progress-box');
  const title = document.getElementById('myzap-progress-title');
  const phase = document.getElementById('myzap-progress-phase');
  const message = document.getElementById('myzap-progress-message');
  const bar = document.getElementById('myzap-progress-bar');
  const updated = document.getElementById('myzap-progress-updated');
  const statusApi = document.getElementById('status-api');

  if (!box || !title || !phase || !message || !bar || !updated) return;

  if (shouldHideProgress(progress)) {
    box.classList.add('d-none');
    return;
  }

  const state = String(progress?.state || (progress?.active ? 'running' : '') || 'running').toLowerCase();
  const phaseLabel = getProgressPhaseLabel(progress?.phase);
  const percent = (state === 'success')
    ? 100
    : resolveProgressPercent(progress);
  const isActive = Boolean(progress?.active);

  box.classList.remove('d-none');
  title.textContent = isActive ? 'Processo local do MyZap em andamento' : 'Ultimo processo local do MyZap';
  phase.textContent = phaseLabel;
  message.textContent = String(progress?.message || 'Aguardando execucao...');
  bar.style.width = `${percent}%`;
  bar.textContent = `${percent}%`;
  bar.setAttribute('aria-valuenow', String(percent));
  updated.textContent = `Ultima atualizacao: ${formatDateTimeBR(progress?.updated_at)}`;

  applyProgressStateClasses(box, bar, state, isActive);

  if (statusApi && isActive) {
    statusApi.textContent = `Processando: ${progress?.message || 'instalando MyZap local...'}`;
    statusApi.className = 'badge bg-warning text-dark status-badge';
  }
}

async function refreshMyZapProgress() {
  try {
    const progress = await window.api.getStore('myzap_progress');
    const modoIntegracao = (await window.api.getStore('myzap_modoIntegracao')) ?? 'local';
    const remoteConfigOk = Boolean(await window.api.getStore('myzap_remoteConfigOk'));
    const modoLocalAtivo = remoteConfigOk && isModoLocal(modoIntegracao);

    if (!modoLocalAtivo && !progress?.active) {
      renderMyZapProgress(null);
      return;
    }

    renderMyZapProgress(progress);
  } catch (err) {
    console.warn('Falha ao carregar progresso MyZap:', err?.message || err);
  }
}

function startMyZapProgressPolling() {
  if (myzapProgressPollTimer) return;
  refreshMyZapProgress();
  myzapProgressPollTimer = setInterval(() => {
    refreshMyZapProgress();
  }, PROGRESS_POLL_INTERVAL_MS);
}

function normalizeModoIntegracao(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'local';

  if (raw.includes('fila') || raw.includes('local')) return 'local';
  if (raw.includes('web') || raw.includes('online') || raw.includes('cloud') || raw.includes('nuvem')) return 'web';
  return raw;
}

function isModoLocal(value) {
  return normalizeModoIntegracao(value) === 'local';
}

function formatDateTimeBR(value) {
  const ts = Number(value || 0);
  if (!ts) return 'ainda nao sincronizado';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'ainda nao sincronizado';
  return d.toLocaleString('pt-BR');
}

function renderRuntimeInfo({ modoIntegracao, lastSyncAt, remoteConfigOk = true }) {
  const box = document.getElementById('myzap-runtime-info');
  if (!box) return;

  const modo = normalizeModoIntegracao(modoIntegracao);
  const modoLabel = modo === 'local' ? 'local/fila' : 'web/online';

  box.innerHTML = `
    <div><strong>Modo atual:</strong> ${modoLabel}</div>
    <div><strong>Configuracao remota validada:</strong> ${remoteConfigOk ? 'sim' : 'nao'}</div>
    <div><strong>Sincronizacao API -> gerenciador:</strong> a cada ${CONFIG_SYNC_INTERVAL_MS / 1000}s</div>
    <div><strong>Troca de modo no ClickExpress:</strong> aplicada automaticamente em ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s</div>
    <div><strong>Tentativa de iniciar fila local:</strong> a cada ${QUEUE_POLL_INTERVAL_MS / 1000}s (somente modo local)</div>
    <div><strong>Atualizacao de status passivo:</strong> a cada ${STATUS_WATCH_INTERVAL_MS / 1000}s (somente modo local)</div>
    <div><strong>Atualizacao de codigo do MyZap (git pull):</strong> ao iniciar o MyZap local</div>
    <div><strong>Ultima sincronizacao remota:</strong> ${formatDateTimeBR(lastSyncAt)}</div>
  `;
}

function applyModoInfoBanner(modoIntegracao) {
  const box = document.getElementById('myzap-modo-info');
  if (!box) return;
  const modo = normalizeModoIntegracao(modoIntegracao);

  if (modo === 'local') {
    box.classList.remove('alert-warning');
    box.classList.add('alert-info');
    box.textContent = `Modo local/fila ativo. O gerenciador instala/sincroniza/inicia o MyZap automaticamente e revalida config a cada ${CONFIG_SYNC_INTERVAL_MS / 1000}s.`;
    return;
  }

  box.classList.remove('alert-info');
  box.classList.add('alert-warning');
  box.textContent = `Modo web/online ativo. O MyZap local esta desativado neste computador. Atualize no ClickExpress para modo local/fila se quiser usar WhatsApp local. A sincronizacao aplica em ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s.`;
}

function setOnlineOnlyView(enabled, customMessage = '') {
  const onlineBox = document.getElementById('myzap-online-only');
  const localContent = document.getElementById('myzap-local-content');
  const myzapTabBtn = document.getElementById('myzap-tab');
  const myzapPane = document.getElementById('myzap');
  const statusTabBtn = document.getElementById('status-tab');
  const statusTabItem = statusTabBtn?.closest('li');
  const statusPane = document.getElementById('status');
  const runtimeInfo = document.getElementById('myzap-runtime-info');

  if (!onlineBox || !localContent) return;

  if (enabled) {
    onlineBox.classList.remove('d-none');
    localContent.classList.add('d-none');
    if (statusTabItem) statusTabItem.classList.add('d-none');
    if (statusPane) {
      statusPane.classList.add('d-none');
      statusPane.classList.remove('show', 'active');
    }
    if (myzapTabBtn) myzapTabBtn.classList.add('active');
    if (myzapPane) myzapPane.classList.add('show', 'active');
    if (statusTabBtn) statusTabBtn.classList.remove('active');
    if (runtimeInfo) runtimeInfo.classList.add('d-none');
    onlineBox.textContent = customMessage || `Modo web/online ativo. As mensagens do WhatsApp estao sendo enviadas de forma online (nao local). Para usar WhatsApp local, altere o modo para local/fila no ClickExpress. Aplicacao automatica em ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s.`;
    return;
  }

  onlineBox.classList.add('d-none');
  localContent.classList.remove('d-none');
  if (statusTabItem) statusTabItem.classList.remove('d-none');
  if (statusPane) statusPane.classList.remove('d-none');
  if (runtimeInfo) runtimeInfo.classList.remove('d-none');
}

async function isModoLocalAtivo() {
  const modo = (await window.api.getStore('myzap_modoIntegracao')) ?? 'local';
  const remoteOk = Boolean(await window.api.getStore('myzap_remoteConfigOk'));
  return remoteOk && isModoLocal(modo);
}

let configAutoRefreshTimer = null;

async function refreshConfigFromApiAndRender() {
  const autoConfig = await window.api.prepareMyZapAutoConfig(true);
  if (autoConfig?.status === 'error') {
    setOnlineOnlyView(true, `Nao foi possivel consultar a rota de configuracao do MyZap agora: ${autoConfig?.message || 'erro desconhecido'}. Verifique API/Token/Empresa e tente novamente.`);
    await refreshMyZapProgress();
    return;
  }

  const myzap_modoIntegracao = (await window.api.getStore('myzap_modoIntegracao')) ?? 'local';
  const myzap_lastRemoteConfigSyncAt = (await window.api.getStore('myzap_lastRemoteConfigSyncAt')) ?? 0;
  const myzap_remoteConfigOk = Boolean(await window.api.getStore('myzap_remoteConfigOk'));
  const modoLocal = isModoLocal(myzap_modoIntegracao);

  applyModoInfoBanner(myzap_modoIntegracao);
  renderRuntimeInfo({
    modoIntegracao: myzap_modoIntegracao,
    lastSyncAt: myzap_lastRemoteConfigSyncAt,
    remoteConfigOk: myzap_remoteConfigOk
  });
  if (!myzap_remoteConfigOk) {
    setOnlineOnlyView(true, `Nao foi possivel validar a configuracao do MyZap na API neste momento. O painel local foi bloqueado para evitar decisao por cache. Verifique API/Token/Empresa e tente novamente.`);
  } else {
    setOnlineOnlyView(!modoLocal);
  }

  const statusApi = document.getElementById('status-api');
  const statusInstallation = document.getElementById('status-installation');
  const statusConfig = document.getElementById('status-config');
  const btnStart = document.getElementById('btn-start');

  if (!myzap_remoteConfigOk || !modoLocal) {
    if (statusApi) {
      statusApi.textContent = !myzap_remoteConfigOk
        ? 'Nao foi possivel validar modo na API. Start local bloqueado.'
        : `Modo web/online: start local desativado. Troque para local/fila no ClickExpress (sync em ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s).`;
      statusApi.className = 'badge bg-info text-dark status-badge';
    }
    if (statusInstallation) {
      statusInstallation.textContent = !myzap_remoteConfigOk
        ? 'Modo nao validado na API'
        : 'Nao aplicavel no modo web/online';
      statusInstallation.className = 'badge bg-info text-dark status-badge';
    }
    if (statusConfig) {
      statusConfig.textContent = 'Automatico via API';
      statusConfig.className = 'badge bg-info text-dark status-badge';
    }
    if (btnStart) btnStart.disabled = true;
    setButtonsState({ canStart: false, canDelete: false });
    setIaConfigVisibility(false);
  }

  await refreshMyZapProgress();
}

function startConfigAutoRefresh() {
  if (configAutoRefreshTimer) return;
  configAutoRefreshTimer = setInterval(() => {
    refreshConfigFromApiAndRender().catch((err) => {
      console.warn('Falha no refresh automatico de config MyZap:', err?.message || err);
    });
  }, CONFIG_SYNC_INTERVAL_MS);
}


(async () => {
  try {
    await loadConfigs();
    startMyZapProgressPolling();
    startConfigAutoRefresh();
  } catch (e) {
    alert('Erro ao carregar configuraÃ§Ãµes: ' + (e?.message || e));
  }
})();


async function loadConfigs() {
  try {
    const autoConfig = await window.api.prepareMyZapAutoConfig(true);
    const remoteConfigOk = autoConfig?.status !== 'error';
    if (autoConfig?.status === 'error') {
      console.warn('Falha na prepara??o autom?tica do MyZap:', autoConfig?.message);
    }
    const configTab = document.getElementById('config-tab');
    const configTabItem = configTab?.closest('li');
    const configPane = document.getElementById('config');
    const installGroup = document.getElementById('install-group');
    if (configTabItem) configTabItem.classList.add('d-none');
    if (configPane) configPane.classList.add('d-none');
    if (installGroup) installGroup.classList.add('d-none');
    const myzap_diretorio = (await window.api.getStore('myzap_diretorio')) ?? '';
    const myzap_sessionKey = (await window.api.getStore('myzap_sessionKey')) ?? '';
    const myzap_sessionName = (await window.api.getStore('myzap_sessionName')) ?? myzap_sessionKey;
    const myzap_apiToken = (await window.api.getStore('myzap_apiToken')) ?? '';
    const myzap_envContent = (await window.api.getStore('myzap_envContent')) ?? '';
    const myzap_mensagemPadrao = (await window.api.getStore('myzap_mensagemPadrao')) ?? '';
    const myzap_modoIntegracao = (await window.api.getStore('myzap_modoIntegracao')) ?? 'local';
    const myzap_lastRemoteConfigSyncAt = (await window.api.getStore('myzap_lastRemoteConfigSyncAt')) ?? 0;
    const myzap_remoteConfigOk = Boolean(await window.api.getStore('myzap_remoteConfigOk'));
    const clickexpress_apiUrl = (await window.api.getStore('clickexpress_apiUrl')) ?? '';
    const clickexpress_queueToken = (await window.api.getStore('clickexpress_queueToken')) ?? '';
    const modoLocal = isModoLocal(myzap_modoIntegracao);

    applyModoInfoBanner(myzap_modoIntegracao);
    renderRuntimeInfo({
      modoIntegracao: myzap_modoIntegracao,
      lastSyncAt: myzap_lastRemoteConfigSyncAt,
      remoteConfigOk: myzap_remoteConfigOk
    });
    setOnlineOnlyView(
      !remoteConfigOk || !myzap_remoteConfigOk || !modoLocal,
      !remoteConfigOk
        ? `Nao foi possivel consultar a rota de configuracao do MyZap agora: ${autoConfig?.message || 'erro desconhecido'}. Verifique API/Token/Empresa e tente novamente.`
        : (!myzap_remoteConfigOk
          ? 'Nao foi possivel validar a configuracao do MyZap na API neste momento. O painel local foi bloqueado para evitar decisao por cache.'
          : '')
    );

    const statusConfig = document.getElementById('status-config');
    if (!myzap_remoteConfigOk || !modoLocal) {
      statusConfig.textContent = 'Automatico via API';
      statusConfig.classList.remove('bg-secondary', 'bg-danger', 'bg-success');
      statusConfig.classList.add('bg-info', 'text-dark');
    } else if (myzap_diretorio && myzap_sessionKey && myzap_apiToken && myzap_envContent) {
      statusConfig.textContent = 'Tudo em ordem!';
      statusConfig.classList.remove('bg-secondary');
      statusConfig.classList.add('bg-success');
    }
    const statusInstallation = document.getElementById('status-installation');
    const statusApi = document.getElementById('status-api');
    const btnStart = document.getElementById('btn-start');

    if (!myzap_remoteConfigOk || !modoLocal) {
      statusInstallation.textContent = !myzap_remoteConfigOk
        ? 'Modo nao validado na API'
        : 'Nao aplicavel no modo web/online';
      statusInstallation.classList.remove('bg-secondary', 'bg-danger', 'bg-success');
      statusInstallation.classList.add('bg-info', 'text-dark');
      setInstalled(false);

      statusApi.textContent = !myzap_remoteConfigOk
        ? 'Nao foi possivel validar modo na API. Start local bloqueado.'
        : `Modo web/online: start local desativado. Troque para local/fila no ClickExpress (sync em ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s).`;
      statusApi.classList.remove('bg-secondary', 'bg-danger', 'bg-success');
      statusApi.classList.add('bg-info', 'text-dark');
      btnStart.disabled = true;
      setButtonsState({ canStart: false, canDelete: false });
      setIaConfigVisibility(false);
    } else {
      const hasFiles = await window.api.checkDirectoryHasFiles(
        String(myzap_diretorio)
      );
      statusInstallation.textContent = hasFiles.message || 'Erro na configuracao!';
      statusInstallation.classList.remove('bg-secondary');
      statusInstallation.classList.add(hasFiles.status === 'success' ? 'bg-success' : 'bg-danger');
      setInstalled(hasFiles.status === 'success');
      btnStart.disabled = false;

      if (hasFiles.status === 'success') {
        statusApi.innerHTML = `
              <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
              Verificando...
          `;
        const realStatus = await window.api.verifyRealStatus();
        const localApiAcessivel = Boolean(
          realStatus && (
            realStatus.status
            || realStatus.realStatus
            || realStatus.dbStatus
            || realStatus.dbState
          )
        );

        statusApi.classList.remove('bg-secondary', 'bg-info', 'bg-danger', 'bg-success', 'bg-warning', 'text-dark');
        if (localApiAcessivel) {
          statusApi.textContent = 'MyZap local acessivel.';
          statusApi.classList.add('bg-success');
          btnStart.disabled = true;
        } else {
          statusApi.textContent = 'MyZap local parado. Clique em Iniciar MyZap.';
          statusApi.classList.add('bg-warning', 'text-dark');
          btnStart.disabled = false;
        }
      }
    }

    if (myzap_sessionKey) {
      document.getElementById('myzap-sessionkey').value = myzap_sessionKey;
      document.getElementById('myzap-sessionname').value = myzap_sessionName || myzap_sessionKey;
    }
    if (document.getElementById('myzap-sessionkey')) {
      document.getElementById('myzap-sessionkey').placeholder = 'Carregado automaticamente da API';
    }
    if (document.getElementById('myzap-sessionname')) {
      document.getElementById('myzap-sessionname').placeholder = 'Carregado automaticamente da API';
    }
    if (modoLocal && myzap_sessionKey) {
      setInterval(async () => {
        await checkConnection();
      }, STATUS_WATCH_INTERVAL_MS);
    }

    if (document.getElementById('input-path')) document.getElementById('input-path').value = myzap_diretorio;
    if (document.getElementById('input-sessionkey')) document.getElementById('input-sessionkey').value = myzap_sessionKey;
    if (document.getElementById('input-apitoken')) document.getElementById('input-apitoken').value = myzap_apiToken;
    if (document.getElementById('input-env')) document.getElementById('input-env').value = myzap_envContent;
    if (document.getElementById('myzap-mensagem-padrao')) document.getElementById('myzap-mensagem-padrao').value = myzap_mensagemPadrao;
    if (document.getElementById('input-clickexpress-apiurl')) document.getElementById('input-clickexpress-apiurl').value = clickexpress_apiUrl;
    if (document.getElementById('input-clickexpress-token')) document.getElementById('input-clickexpress-token').value = clickexpress_queueToken;
    await refreshMyZapProgress();
  } catch (e) {
    alert('Erro ao carregar configura??es: ' + (e?.message || e));
  }
}

async function checkRealConnection() {
  const qrBox = document.getElementById('qrcode-box');
  const statusIndicator = document.querySelector('.status-indicator');

  qrBox.innerHTML = `<span class="text-muted-small">Verificando status real...</span>`;

  try {
    const response = await window.api.verifyRealStatus();

    if (!response.dbStatus && !response.status) {
      throw new Error('Resposta invÃ¡lida da API');
    }

    const {
      realStatus,
      dbStatus,
      dbState,
      status,
      message
    } = response;

    if (status == 'NOT FOUND') {
      statusIndicator.className = 'status-indicator waiting';
      statusIndicator.textContent = 'SessÃ£o nÃ£o iniciada!';

      qrBox.innerHTML = `
        <span class="text-muted-small">
          Nenhuma instÃ¢ncia de sessÃ£o foi criada!
        </span>
      `;

      setButtonsState({ canStart: true, canDelete: false });
      setIaConfigVisibility(false);
      return { isConnected: false, isQrWaiting: false, response };
    }

    const isConnected = realStatus === 'CONNECTED';
    const isQrWaiting = dbState === 'QRCODE' || dbStatus === 'qrCode';

    if (isConnected) {
      statusIndicator.className = 'status-indicator connected';
      statusIndicator.textContent = 'âœ… Conectado';

      qrBox.innerHTML = `
        <span class="text-muted-small">
          WhatsApp conectado com sucesso
        </span>
      `;

      setButtonsState({ canStart: false, canDelete: true });
      setIaConfigVisibility(true);
      return { isConnected: true, isQrWaiting: false, response };
    }

    if (isQrWaiting) {
      statusIndicator.className = 'status-indicator waiting';
      statusIndicator.textContent = 'â³ Aguardando leitura do QR Code';

      setButtonsState({ canStart: false, canDelete: true });
      setIaConfigVisibility(false);
      return { isConnected: false, isQrWaiting: true, response };
    }

    statusIndicator.className = 'status-indicator disconnected';
    statusIndicator.textContent = 'âŒ Desconectado';

    qrBox.innerHTML = `
      <span class="text-muted-small">
        ${message || 'QR Code nÃ£o disponÃ­vel'}
      </span>
    `;

    setButtonsState({ canStart: true, canDelete: false });
    setIaConfigVisibility(false);
    return { isConnected: false, isQrWaiting: false, response };

  } catch (err) {
    console.error('Erro ao verificar status real:', err);

    statusIndicator.className = 'status-indicator disconnected';
    statusIndicator.textContent = 'âš  Erro de conexÃ£o';

    qrBox.innerHTML = `
      <span class="text-danger text-small">
        Erro ao verificar status do MyZap
      </span>
    `;

    setButtonsState({ canStart: false, canDelete: false });
    setIaConfigVisibility(false);
    return { isConnected: false, isQrWaiting: false, response: null };
  }
}

async function checkConnection() {
  const qrBox = document.getElementById('qrcode-box');
  const statusIndicator = document.querySelector('.status-indicator');

  if (!(await isModoLocalAtivo())) {
    statusIndicator.className = 'status-indicator waiting';
    statusIndicator.textContent = 'Modo local inativo ou nao validado';
    qrBox.innerHTML = `<span class="text-muted-small">QR Code local indisponivel. Verifique o modo no ClickExpress e a validacao da rota de configuracao.</span>`;
    setButtonsState({ canStart: false, canDelete: false });
    setIaConfigVisibility(false);
    return;
  }

  // loading simples (opcional)
  qrBox.innerHTML = `<span class="text-muted-small">Verificando status...</span>`;

  try {
    const realCheck = await checkRealConnection();

    if (!realCheck || realCheck.isConnected) {
      return;
    }

    if (!realCheck.isQrWaiting) {
      return;
    }

    const response = await window.api.getConnectionStatus();

    if (!response || response.result !== 200) {
      throw new Error('Resposta invÃ¡lida da API');
    }

    const { status, state, qrCode } = response;

    if ((state === 'QRCODE' || status === 'qrCode') && qrCode) {
      statusIndicator.className = 'status-indicator waiting';
      statusIndicator.textContent = 'â³ Aguardando leitura do QR Code';

      qrBox.innerHTML = `
        <img 
          src="${qrCode}" 
          alt="QR Code WhatsApp"
        />
        <div class="qrcode-hint">
          Escaneie o QR Code com o WhatsApp
        </div>
      `;
    }

  } catch (err) {
    console.error('Erro ao verificar conexÃ£o:', err);

    statusIndicator.className = 'status-indicator disconnected';
    statusIndicator.textContent = 'âš  Erro de conexÃ£o';

    qrBox.innerHTML = `
      <span class="text-danger text-small">
        Erro ao verificar status do MyZap
      </span>
    `;
  }
}

async function iniciarSessao() {
  if (!(await isModoLocalAtivo())) {
    alert(`Modo local inativo ou nao validado pela API. Verifique o modo no ClickExpress e aguarde ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s para sincronizacao.`);
    return;
  }

  const qrBox = document.getElementById('qrcode-box');
  const statusIndicator = document.querySelector('.status-indicator');

  try {
    const realCheck = await checkRealConnection();
    if (realCheck?.isConnected || realCheck?.isQrWaiting) {
      statusIndicator.className = 'status-indicator waiting';
      statusIndicator.textContent = 'âš  SessÃ£o jÃ¡ existe';

      setButtonsState({ canStart: false, canDelete: true });
      return;
    }

    statusIndicator.className = 'status-indicator waiting';
    statusIndicator.textContent = 'ðŸš€ Iniciando sessÃ£o...';

    qrBox.innerHTML = `
      <span class="text-muted-small">
        Inicializando sessÃ£o do WhatsApp...
      </span>
    `;

    const response = await window.api.startSession();

    if (!response || response.result !== 'success') {
      throw new Error('Falha ao iniciar sessÃ£o');
    }

    // 3ï¸âƒ£ Atualiza UI
    statusIndicator.textContent = 'â³ SessÃ£o iniciada, aguardando QR Code';

    setButtonsState({ canStart: false, canDelete: true });

    // opcional: forÃ§ar refresh do status
    setTimeout(checkConnection, 5000);

  } catch (err) {
    console.error('Erro ao iniciar sessÃ£o:', err);

    statusIndicator.className = 'status-indicator disconnected';
    statusIndicator.textContent = 'âŒ Erro ao iniciar sessÃ£o';

    qrBox.innerHTML = `
      <span class="text-danger text-small">
        NÃ£o foi possÃ­vel iniciar a sessÃ£o
      </span>
    `;
  }
}


async function deletarSessao() {
  if (!(await isModoLocalAtivo())) {
    alert(`Modo local inativo ou nao validado pela API. Verifique o modo no ClickExpress e aguarde ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s para sincronizacao.`);
    return;
  }

  const qrBox = document.getElementById('qrcode-box');
  const statusIndicator = document.querySelector('.status-indicator');

  try {
    // 1ï¸âƒ£ Verifica se existe sessÃ£o
    const realCheck = await checkRealConnection();

    if (!realCheck || (!realCheck.isConnected && !realCheck.isQrWaiting)) {
      statusIndicator.className = 'status-indicator disconnected';
      statusIndicator.textContent = 'â„¹ Nenhuma sessÃ£o ativa';

      setButtonsState({ canStart: true, canDelete: false });
      return;
    }

    // 2ï¸âƒ£ Feedback visual
    statusIndicator.className = 'status-indicator waiting';
    statusIndicator.textContent = 'ðŸ§¹ Encerrando sessÃ£o...';

    qrBox.innerHTML = `
      <span class="text-muted-small">
        Finalizando sessÃ£o do WhatsApp...
      </span>
    `;

    // 3ï¸âƒ£ Chamada de delete
    const response = await window.api.deleteSession();

    if (!response || response.status !== 'SUCCESS') {
      throw new Error('Falha ao deletar sessÃ£o');
    }

    // 4ï¸âƒ£ UI final
    statusIndicator.className = 'status-indicator disconnected';
    statusIndicator.textContent = 'âŒ SessÃ£o encerrada';

    qrBox.innerHTML = `
      <span class="text-muted-small">
        SessÃ£o removida com sucesso
      </span>
    `;

    setButtonsState({ canStart: true, canDelete: false });

  } catch (err) {
    console.error('Erro ao deletar sessÃ£o:', err);

    statusIndicator.className = 'status-indicator disconnected';
    statusIndicator.textContent = 'âš  Erro ao deletar sessÃ£o';

    qrBox.innerHTML = `
      <span class="text-danger text-small">
        NÃ£o foi possÃ­vel encerrar a sessÃ£o
      </span>
    `;
  }
}

async function salvarMensagemPadrao() {
  if (!(await isModoLocalAtivo())) {
    alert(`Modo local inativo ou nao validado pela API. Para aplicar no local, verifique o modo no ClickExpress e aguarde ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s.`);
    return;
  }

  const textarea = document.getElementById('myzap-mensagem-padrao');
  const btnSave = document.getElementById('btn-save-ia-config');
  const mensagemPadrao = textarea?.value?.trim() || '';

  if (!mensagemPadrao) {
    alert('Informe uma mensagem padrao antes de salvar.');
    return;
  }

  btnSave.disabled = true;
  const oldText = btnSave.textContent;
  btnSave.textContent = 'Salvando...';

  try {
    const response = await window.api.updateIaConfig(mensagemPadrao);

    if (!response || response.status === 'error') {
      throw new Error(response?.message || 'Falha ao salvar configuracao da IA');
    }

    alert('Mensagem padrao atualizada com sucesso.');
  } catch (err) {
    console.error('Erro ao atualizar mensagem padrao:', err);
    alert(`Erro ao atualizar mensagem padrao: ${err?.message || err}`);
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = oldText;
  }
}

const cfg_myzap = document.getElementById('myzap-config-form');

cfg_myzap.onsubmit = (e) => {
  e.preventDefault();
  alert('As configurações do MyZap agora são automáticas. Use o botão "Iniciar MyZap".');
};

function atualizaStatus() {
  window.location.reload();
}

async function iniciarMyZapServico() {
  const btnStart = document.getElementById('btn-start');
  const statusApi = document.getElementById('status-api');
  const myzap_modoIntegracao = (await window.api.getStore('myzap_modoIntegracao')) ?? 'local';
  const myzap_remoteConfigOk = Boolean(await window.api.getStore('myzap_remoteConfigOk'));

  if (!myzap_remoteConfigOk || !isModoLocal(myzap_modoIntegracao)) {
    statusApi.textContent = !myzap_remoteConfigOk
      ? 'Nao foi possivel validar modo na API. Start local bloqueado.'
      : `Modo web/online: MyZap local desativado. Troque para local/fila no ClickExpress (sync em ate ${CONFIG_SYNC_INTERVAL_MS / 1000}s).`;
    statusApi.className = 'badge bg-info text-dark status-badge';
    btnStart.disabled = true;
    return;
  }

  btnStart.disabled = true;
  statusApi.innerHTML = `
    <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
    Iniciando...
  `;
  statusApi.className = 'badge bg-warning text-dark status-badge';
  try {
    const result = await window.api.ensureMyZapStarted(true);
    statusApi.textContent = result.message || 'Erro ao iniciar MyZap!';
    statusApi.classList.remove('bg-warning', 'text-dark');
    if (result?.status === 'success' && result?.skippedLocalStart) {
      statusApi.classList.add('bg-info', 'text-dark');
      btnStart.disabled = true;
      return;
    }
    statusApi.classList.add(result.status === 'success' ? 'bg-success' : 'bg-danger');
    btnStart.disabled = (result.status === 'success');
  } catch (err) {
    console.error('Erro ao iniciar MyZap:', err);
    statusApi.textContent = 'Erro ao iniciar MyZap!';
    statusApi.classList.remove('bg-warning', 'text-dark');
    statusApi.classList.add('bg-danger');
    btnStart.disabled = false;
  }
}

function setInstalled(isInstalled) {
  const dropdownBtn = document.getElementById("btn-install-dropdown");
  const mainBtn = document.getElementById("btn-install");

  if (isInstalled) {
    dropdownBtn.classList.remove("d-none");
    mainBtn.innerText = "Instalado";
    mainBtn.classList.remove("btn-primary");
    mainBtn.classList.add("btn-success");
    mainBtn.disabled = true;
  } else {
    dropdownBtn.classList.add("d-none");
    mainBtn.innerText = "Instalar";
    mainBtn.classList.remove("btn-success");
    mainBtn.classList.add("btn-primary");
    mainBtn.disabled = false;
  }
}

async function installMyZap() {
  const myzap_diretorio = (await window.api.getStore('myzap_diretorio')) ?? '';
  const myzap_envContent = (await window.api.getStore('myzap_envContent')) ?? '';

  if (!myzap_diretorio) {
    alert('Por favor, salve as configuraÃ§Ãµes antes de instalar o MyZap.');
    return;
  }

  // 1. Elementos da UI
  const btnInstall = document.getElementById('btn-install');
  const btnStart = document.getElementById('btn-start');
  const btnRefresh = document.getElementById('btn-refresh-status');
  const statusBadge = document.getElementById('status-installation');

  // Guardamos o texto original para restaurar em caso de erro
  const originalBtnText = btnInstall.innerHTML;
  const originalBadgeText = statusBadge.textContent;
  const originalBadgeClass = statusBadge.className;

  try {
    btnInstall.disabled = true;
    btnStart.disabled = true;
    btnRefresh.disabled = true;

    btnInstall.innerHTML = `
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            Instalando...
        `;

    statusBadge.textContent = 'Baixando arquivos...';
    statusBadge.className = 'badge bg-warning text-dark status-badge';

    const clone = await window.api.cloneRepository(
      String(myzap_diretorio),
      String(myzap_envContent)
    );

    if (clone.status === 'error') {
      throw new Error(clone.message || 'Erro desconhecido');
    }

    statusBadge.textContent = 'MyZap se encontra no diretÃ³rio configurado!';
    statusBadge.className = 'badge bg-success status-badge';

    setTimeout(() => {
      alert('MyZap instalado com sucesso!');
      atualizaStatus();
    }, 500);

  } catch (error) {
    console.error(error);
    alert('Erro ao instalar MyZap: ' + error.message);

    btnInstall.innerHTML = originalBtnText;
    btnInstall.disabled = false;

    statusBadge.textContent = 'Falha na instalaÃ§Ã£o';
    statusBadge.className = 'badge bg-danger status-badge';
  }
}

async function reinstallMyZap() {
  if (!confirm("Deseja reinstalar o MyZap? Isso substituirÃ¡ a instalaÃ§Ã£o atual.")) {
    return;
  }

  const myzap_diretorio = (await window.api.getStore('myzap_diretorio')) ?? '';
  const myzap_envContent = (await window.api.getStore('myzap_envContent')) ?? '';

  if (!myzap_diretorio) {
    alert('Por favor, salve as configuraÃ§Ãµes antes de re-instalar o MyZap.');
    return;
  }

  // 1. Elementos da UI
  const btnInstall = document.getElementById('btn-install');
  const btnReInstall = document.getElementById('btn-reinstall');
  const btnStart = document.getElementById('btn-start');
  const btnRefresh = document.getElementById('btn-refresh-status');
  const statusBadge = document.getElementById('status-installation');
  const statusRunBadge = document.getElementById('status-api');
  const dropdownBtn = document.getElementById("btn-install-dropdown");

  // Guardamos o texto original para restaurar em caso de erro
  const originalBtnText = btnInstall.innerHTML;
  const originalBadgeText = statusBadge.textContent;
  const originalBadgeClass = statusBadge.className;

  try {
    btnInstall.disabled = true;
    btnStart.disabled = true;
    btnReInstall.disabled = true;
    dropdownBtn.disabled = true;
    btnRefresh.disabled = true;

    btnInstall.innerHTML = `
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            Re-Instalando...
        `;

    statusBadge.textContent = 'Baixando arquivos...';
    statusBadge.className = 'badge bg-warning text-dark status-badge';

    statusRunBadge.textContent = 'Aguardando reinstalaÃ§Ã£o...';
    statusRunBadge.className = 'badge bg-secondary status-badge';

    const clone = await window.api.cloneRepository(
      String(myzap_diretorio),
      String(myzap_envContent),
      true
    );

    if (clone.status === 'error') {
      throw new Error(clone.message || 'Erro desconhecido');
    }

    statusBadge.textContent = 'MyZap se encontra no diretÃ³rio configurado!';
    statusBadge.className = 'badge bg-success status-badge';

    setTimeout(() => {
      alert('MyZap re-instalado com sucesso!');
      atualizaStatus();
    }, 500);

  } catch (error) {
    console.error(error);
    alert('Erro ao re-instalar MyZap: ' + error.message);

    btnInstall.innerHTML = originalBtnText;
    btnInstall.disabled = false;

    statusBadge.textContent = 'Falha na instalaÃ§Ã£o';
    statusBadge.className = 'badge bg-danger status-badge';
    setTimeout(() => {
      atualizaStatus();
    }, 1500);
  }
}

