function formatDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString('pt-BR');
}

function extrairResumoMensagem(jsonStr) {
  try {
    const payload = jsonStr ? JSON.parse(jsonStr) : {};
    const numero = payload?.data?.number || '-';
    const texto = payload?.data?.text || '-';
    return { numero, texto };
  } catch (e) {
    return { numero: '-', texto: 'JSON inválido' };
  }
}

function renderFilaPendentes(mensagens) {
  const tbody = document.getElementById('queue-pendentes-body');
  const total = document.getElementById('queue-total-pendentes');
  if (!tbody || !total) return;

  total.textContent = String(mensagens.length);

  if (!mensagens.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-muted-small">Nenhuma mensagem pendente.</td>
      </tr>
    `;
    return;
  }

  const linhas = mensagens.map((m) => {
    const { numero, texto } = extrairResumoMensagem(m?.json);
    return `
      <tr>
        <td>${m?.idfila ?? '-'}</td>
        <td>${numero}</td>
        <td class="queue-message-cell">${texto}</td>
        <td>${m?.status ?? '-'}</td>
        <td>${m?.datahorainclusao ?? '-'}</td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = linhas;
}

async function atualizarStatusProcessoFila() {
  const badge = document.getElementById('queue-process-status');
  const lastRun = document.getElementById('queue-last-run');
  const lastBatch = document.getElementById('queue-last-batch');
  if (!badge || !lastRun || !lastBatch) return;

  try {
    const status = await window.api.getQueueWatcherStatus();
    const ativo = !!status?.ativo;
    const processando = !!status?.processando;

    badge.textContent = processando ? 'Processando' : (ativo ? 'Ativo' : 'Parado');
    badge.classList.remove('bg-secondary', 'bg-success', 'bg-warning', 'bg-danger');
    badge.classList.add(processando ? 'bg-warning' : (ativo ? 'bg-success' : 'bg-secondary'));

    lastRun.textContent = formatDateTime(status?.ultimaExecucaoEm);
    lastBatch.textContent = String(status?.ultimoLote ?? 0);
  } catch (e) {
    badge.textContent = 'Erro';
    badge.classList.remove('bg-secondary', 'bg-success', 'bg-warning');
    badge.classList.add('bg-danger');
  }
}

async function atualizarFilaMyZap() {
  try {
    const pendentes = await window.api.getQueuePendentes();
    renderFilaPendentes(Array.isArray(pendentes) ? pendentes : []);
  } catch (e) {
    renderFilaPendentes([]);
  }
}

async function iniciarFilaMyZap() {
  const btn = document.getElementById('btn-start-queue');
  if (!btn) return;

  btn.disabled = true;
  const txt = btn.textContent;
  btn.textContent = 'Iniciando...';

  try {
    const result = await window.api.startQueueWatcher();
    if (result?.status !== 'success') {
      throw new Error(result?.message || 'Falha ao iniciar a fila');
    }
    await atualizarStatusProcessoFila();
    alert(result?.message || 'Processo da fila iniciado.');
  } catch (e) {
    alert(`Erro ao iniciar processo da fila: ${e?.message || e}`);
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
}

(async () => {
  const btnStart = document.getElementById('btn-start-queue');
  const btnRefresh = document.getElementById('btn-refresh-fila');

  if (btnStart) {
    btnStart.addEventListener('click', iniciarFilaMyZap);
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      await atualizarStatusProcessoFila();
      await atualizarFilaMyZap();
    });
  }

  await atualizarStatusProcessoFila();
  await atualizarFilaMyZap();

  setInterval(async () => {
    await atualizarStatusProcessoFila();
    await atualizarFilaMyZap();
  }, 3000);
})();
