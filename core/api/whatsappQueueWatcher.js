const Store = require('electron-store');
const { info, warn, error } = require('../myzap/myzapLogger');

const store = new Store();
// 127.0.0.1 (e nao localhost: pode resolver ::1 no Windows e dar timeout)
const MYZAP_API_URL = 'http://127.0.0.1:5555/';
const LOOP_INTERVAL_MS = 3000;
const FETCH_TIMEOUT_MS = 15000;
const PROCESSANDO_TIMEOUT_MS = 120000;

let ativo = false;
let processando = false;
let processandoDesde = 0;
let timer = null;
let ultimaExecucaoEm = null;
let ultimoErro = null;
let ultimoLote = 0;
let ultimosPendentes = [];
let consecutiveSkips = 0;
let ciclosSemMovimento = 0;
const MAX_CONSECUTIVE_SKIPS = 10;

// Pausa RECUPERAVEL no lugar do antigo auto-stop definitivo.
let motivoPausa = null;
let notifyCallback = null;
let ultimoToastPausaAt = 0;
const PAUSA_TOAST_COOLDOWN_MS = 10 * 60 * 1000;

function setQueueNotifier(fn) {
  notifyCallback = (typeof fn === 'function') ? fn : null;
}

function notificarFila(mensagem, { comCooldown = false } = {}) {
  if (!notifyCallback) return;
  if (comCooldown) {
    const agora = Date.now();
    if (agora - ultimoToastPausaAt < PAUSA_TOAST_COOLDOWN_MS) return;
    ultimoToastPausaAt = agora;
  }
  try { notifyCallback(mensagem); } catch (_e) { /* melhor esforco */ }
}

function entrarEmPausa(motivo, mensagem) {
  if (motivoPausa === motivo) return;
  motivoPausa = motivo;
  warn(`[FilaMyZap] Fila pausada (${motivo}) — retoma sozinha quando resolver`, {
    metadata: { motivo, consecutiveSkips }
  });
  notificarFila(mensagem, { comCooldown: true });
}

function sairDaPausa() {
  if (!motivoPausa) return;
  motivoPausa = null;
  info('[FilaMyZap] Fila retomada automaticamente', { metadata: { area: 'whatsappQueueWatcher' } });
  notificarFila('Fila de mensagens retomada: MyZap respondendo novamente.');
}
const SKIP_LOG_EVERY = 5;
const IDLE_LOG_EVERY = 20;

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Converte qualquer valor de erro (string, numero, boolean, Error, objeto ou
 * resposta crua do MyZap) numa string legivel para gravar como "motivo" na fila.
 * Evita gravar "[object Object]" (objeto via String()) ou "true" (boolean).
 *
 * @param {*} valor Valor bruto do erro
 * @param {string} fallback Mensagem usada quando nao ha nada legivel
 * @returns {string}
 */
function extrairMensagemErro(valor, fallback = 'Falha desconhecida no envio') {
  if (valor === null || valor === undefined) return fallback;
  if (typeof valor === 'string') return valor.trim() || fallback;
  if (typeof valor === 'number') return String(valor);
  if (typeof valor === 'boolean') return fallback; // "true"/"false" nao ajuda no diagnostico
  if (valor instanceof Error) return valor.message || fallback;

  if (typeof valor === 'object') {
    // Tenta os campos de mensagem mais comuns (MyZap / fetch / axios)
    for (const campo of ['message', 'error', 'text', 'msg', 'reason', 'description']) {
      const v = valor[campo];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    // Sem campo legivel: serializa o objeto inteiro para preservar o contexto
    try {
      const json = JSON.stringify(valor);
      if (json && json !== '{}' && json !== '[]' && json !== 'null') return json;
    } catch (_) { /* referencia circular: cai no fallback */ }
    return fallback;
  }

  return fallback;
}

async function validarDisponibilidadeMyZap(sessionKey, sessionToken) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${MYZAP_API_URL}verifyRealStatus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apitoken: sessionToken,
        sessionkey: sessionKey
      },
      body: JSON.stringify({ session: sessionKey }),
      signal: ctrl.signal
    });

    clearTimeout(timeout);
    await res.json().catch(() => ({}));
    return res.ok;
  } catch (err) {
    warn('[FilaMyZap] Erro ao validar disponibilidade do MyZap', {
      metadata: { error: err?.message || err }
    });
    return false;
  }
}

async function buscarPendentes(apiBaseUrl, token, sessionKey, sessionName) {
  const query = new URLSearchParams({
    sessionKey: sessionKey || '',
    sessionToken: sessionName || ''
  }).toString();

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  const res = await fetch(`${apiBaseUrl}parametrizacao-myzap/pendentes?${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: ctrl.signal
  });

  clearTimeout(timeout);

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || 'Falha ao consultar pendentes');
  }

  return Array.isArray(data?.result?.mensagens) ? data.result.mensagens : [];
}

async function atualizarStatusFila(apiBaseUrl, token, payload) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  const res = await fetch(`${apiBaseUrl}parametrizacao-myzap/fila/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload),
    signal: ctrl.signal
  });

  clearTimeout(timeout);

  const data = await res.json().catch(() => ({}));
  return res.ok && !data?.error;
}

async function enviarParaMyZap(mensagem, fallbackSessionKey, fallbackApiToken) {
  if (String(mensagem?.status || '').toLowerCase() === 'enviado') {
    return { ok: true, skipped: true, motivo: 'status_enviado' };
  }

  let payloadFila = {};
  try {
    payloadFila = mensagem?.json ? JSON.parse(mensagem.json) : {};
  } catch (e) {
    return { ok: false, erro: `JSON invalido da fila: ${e.message}` };
  }

  const endpoint = payloadFila?.endpoint;
  const data = payloadFila?.data;

  if (!endpoint || !data) {
    return { ok: false, erro: 'Mensagem sem endpoint ou payload para MyZap' };
  }

  const endpointNormalizado = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const sessionKey = mensagem?.sessionkey || fallbackSessionKey;
  const apiToken = mensagem?.apitoken || fallbackApiToken;

  if (!sessionKey || !apiToken) {
    return { ok: false, erro: 'SessionKey ou APIToken do MyZap ausente' };
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  const res = await fetch(`${MYZAP_API_URL}${endpointNormalizado}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apitoken: apiToken,
      sessionkey: sessionKey
    },
    body: JSON.stringify(data),
    signal: ctrl.signal
  });

  clearTimeout(timeout);

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    // body.error pode vir como string, objeto ou ate boolean (true), dependendo
    // do MyZap. Normaliza para uma mensagem legivel e nunca "[object Object]".
    const motivo = extrairMensagemErro(body?.error, '')
      || extrairMensagemErro(body, '')
      || `HTTP ${res.status}`;
    return { ok: false, erro: motivo };
  }

  if (endpointNormalizado.toLowerCase() === 'sendtext' && body?.result !== 200) {
    return { ok: false, erro: 'Retorno do sendText diferente de 200' };
  }

  return { ok: true, body };
}

async function obterCredenciaisAtivas() {
  const clickApiUrl = normalizeBaseUrl(String(store.get('clickexpress_apiUrl') || '').trim());
  const clickToken = String(store.get('clickexpress_queueToken') || '').trim();
  const sessionKey = String(store.get('myzap_sessionKey') || '').trim();
  const sessionName = String(store.get('myzap_sessionName') || sessionKey).trim();
  const myzapApiToken = String(store.get('myzap_apiToken') || '').trim();

  return {
    clickApiUrl,
    clickToken,
    sessionKey,
    sessionName,
    myzapApiToken
  };
}

async function listarPendentesMyZap() {
  const config = await obterCredenciaisAtivas();
  const {
    clickApiUrl,
    clickToken,
    sessionKey,
    sessionName
  } = config;

  if (!clickApiUrl || !clickToken || !sessionKey || !sessionName) {
    return [];
  }

  return buscarPendentes(clickApiUrl, clickToken, sessionKey, sessionName);
}

async function processarFilaUmaRodada() {
  if (!ativo) return;

  // Protecao contra processamento travado (timeout de seguranca)
  if (processando) {
    const elapsed = Date.now() - processandoDesde;
    if (elapsed > PROCESSANDO_TIMEOUT_MS) {
      warn('[FilaMyZap] Processamento anterior travado, resetando flag processando', {
        metadata: { area: 'whatsappQueueWatcher', elapsedMs: elapsed }
      });
      processando = false;
    } else {
      return;
    }
  }

  processando = true;
  processandoDesde = Date.now();

  try {
    // Validar MyZap disponivel antes de buscar pendentes
    const configAtual = await obterCredenciaisAtivas();
    if (!configAtual.sessionKey || !configAtual.myzapApiToken) {
      consecutiveSkips++;
      if (consecutiveSkips % SKIP_LOG_EVERY === 1) {
        warn(`[FilaMyZap] Credenciais ausentes (skip #${consecutiveSkips})`, {
          metadata: { consecutiveSkips }
        });
      }
      if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
        entrarEmPausa('aguardando_credenciais',
          'Fila de mensagens pausada: aguardando credenciais do MyZap. Ela retoma sozinha.');
      }
      return;
    }

    const myzapOk = await validarDisponibilidadeMyZap(configAtual.sessionKey, configAtual.myzapApiToken);
    if (!myzapOk) {
      consecutiveSkips++;
      if (consecutiveSkips % SKIP_LOG_EVERY === 1) {
        warn(`[FilaMyZap] MyZap indisponivel (skip #${consecutiveSkips})`, {
          metadata: { consecutiveSkips }
        });
      }
      if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
        entrarEmPausa('aguardando_myzap',
          'Fila de mensagens pausada: aguardando o MyZap voltar a responder. Ela retoma sozinha.');
      }
      return;
    }

    // MyZap ok, reset skip counter
    consecutiveSkips = 0;
    sairDaPausa();

    const pendentes = await listarPendentesMyZap();
    ultimosPendentes = Array.isArray(pendentes) ? pendentes : [];
    const lote = pendentes.filter((m) => String(m?.status || '').toLowerCase() !== 'enviado');

    ultimoLote = lote.length;
    ultimaExecucaoEm = new Date().toISOString();

    if (lote.length === 0) {
      ciclosSemMovimento += 1;
      if (ciclosSemMovimento === 1 || ciclosSemMovimento % IDLE_LOG_EVERY === 0) {
        info('[FilaMyZap] Fila vazia, aguardando novas mensagens', {
          metadata: {
            area: 'whatsappQueueWatcher',
            totalPendentes: pendentes.length,
            ciclosSemMovimento
          }
        });
      }
      ultimoErro = null;
      return;
    }

    ciclosSemMovimento = 0;
    info('[FilaMyZap] Pendencias encontradas para envio', {
      metadata: { totalPendentes: pendentes.length, tamanhoLote: lote.length }
    });

    const {
      clickApiUrl,
      clickToken,
      sessionKey,
      myzapApiToken
    } = await obterCredenciaisAtivas();

    for (const mensagem of lote) {
      if (!ativo) break;

      let novoStatus = 'erro';
      let motivoErro = '';   // preenchido quando da erro
      let retornoJson = '';  // JSON da resposta do MyZap quando da certo
      try {
        info('[FilaMyZap] Enviando mensagem', {
          metadata: { idfila: mensagem?.idfila, idempresa: mensagem?.idempresa }
        });

        const envio = await enviarParaMyZap(mensagem, sessionKey, myzapApiToken);
        novoStatus = envio.ok ? 'enviado' : 'erro';

        if (envio.ok) {
          try {
            retornoJson = envio.body ? JSON.stringify(envio.body) : '';
          } catch (_) {
            retornoJson = '';
          }
          info('[FilaMyZap] Mensagem enviada com sucesso', {
            metadata: { idfila: mensagem?.idfila, idempresa: mensagem?.idempresa }
          });
        } else {
          motivoErro = extrairMensagemErro(envio?.erro ?? envio?.motivo, 'Falha desconhecida no envio');
          warn('[FilaMyZap] Falha ao enviar mensagem para MyZap', {
            metadata: {
              idfila: mensagem?.idfila,
              idempresa: mensagem?.idempresa,
              motivo: motivoErro
            }
          });
        }
      } catch (envioError) {
        motivoErro = extrairMensagemErro(envioError, 'Erro inesperado no envio');
        warn('Erro inesperado no envio para MyZap', {
          metadata: {
            idfila: mensagem?.idfila,
            idempresa: mensagem?.idempresa,
            error: envioError
          }
        });
      }

      const statusOk = await atualizarStatusFila(clickApiUrl, clickToken, {
        idfila: mensagem?.idfila,
        idempresa: mensagem?.idempresa,
        status: novoStatus,
        erro: novoStatus === 'erro' ? motivoErro : '',
        retorno: novoStatus === 'enviado' ? retornoJson : ''
      });

      if (!statusOk) {
        warn('Nao foi possivel atualizar status da fila MyZap', {
          metadata: {
            idfila: mensagem?.idfila,
            idempresa: mensagem?.idempresa,
            status: novoStatus
          }
        });
      }
    }

    info('[FilaMyZap] Ciclo de processamento concluido', {
      metadata: { area: 'whatsappQueueWatcher', loteProcessado: lote.length }
    });

    ultimoErro = null;
  } catch (e) {
    ultimoErro = e?.message || String(e);
    error('Erro no watcher da fila MyZap', {
      metadata: { area: 'whatsappQueueWatcher', error: e }
    });
  } finally {
    processando = false;
  }
}

async function startWhatsappQueueWatcher() {
  if (ativo) {
    return { status: 'success', message: 'Watcher da fila MyZap ja esta em execucao.' };
  }

  const config = await obterCredenciaisAtivas();
  if (!config.clickApiUrl || !config.clickToken || !config.sessionKey || !config.myzapApiToken) {
    warn('[FilaMyZap] Configuracao incompleta para iniciar watcher', {
      metadata: {
        clickApiUrl: !!config.clickApiUrl,
        clickToken: !!config.clickToken,
        sessionKey: !!config.sessionKey,
        sessionName: !!config.sessionName,
        myzapApiToken: !!config.myzapApiToken
      }
    });
    return { status: 'error', message: 'Configuracao do ClickExpress/MyZap incompleta.' };
  }

  const myzapDisponivel = await validarDisponibilidadeMyZap(config.sessionKey, config.myzapApiToken);
  if (!myzapDisponivel) {
    return {
      status: 'error',
      message: 'MyZap indisponivel. Verifique se a sessao esta ativa antes de iniciar a fila.'
    };
  }

  ativo = true;
  ultimoErro = null;
  ciclosSemMovimento = 0;

  info('Iniciando watcher da fila MyZap', {
    metadata: { area: 'whatsappQueueWatcher', loopMs: LOOP_INTERVAL_MS }
  });

  timer = setInterval(() => {
    processarFilaUmaRodada().catch((err) => {
      error('Erro inesperado no loop da fila MyZap', {
        metadata: { area: 'whatsappQueueWatcher', error: err }
      });
    });
  }, LOOP_INTERVAL_MS);

  await processarFilaUmaRodada();
  return { status: 'success', message: 'Watcher da fila MyZap iniciado com sucesso.' };
}

function stopWhatsappQueueWatcher() {
  if (!ativo && !timer) {
    return { status: 'success', message: 'Watcher da fila MyZap ja estava parado.' };
  }

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  ativo = false;
  processando = false;
  ciclosSemMovimento = 0;

  info('Watcher da fila MyZap parado', {
    metadata: { area: 'whatsappQueueWatcher' }
  });

  return { status: 'success', message: 'Watcher da fila MyZap parado com sucesso.' };
}

function getWhatsappQueueWatcherStatus() {
  const proximaExecucaoEm = ultimaExecucaoEm
    ? new Date(new Date(ultimaExecucaoEm).getTime() + LOOP_INTERVAL_MS).toISOString()
    : null;

  return {
    ativo,
    processando,
    ultimoLote,
    ultimaExecucaoEm,
    proximaExecucaoEm,
    loopIntervalMs: LOOP_INTERVAL_MS,
    ultimoErro
  };
}

function getUltimosPendentesMyZap() {
  return Array.isArray(ultimosPendentes) ? [...ultimosPendentes] : [];
}

/**
 * Teste ponta a ponta: valida a API do ClickExpress (buscando o número da loja
 * pelas credenciais) e o MyZap local (enviando uma mensagem para o PRÓPRIO
 * número da loja). Não passa pela fila — envia direto, para feedback imediato.
 *
 * @returns {Promise<{ok:boolean, etapa?:string, erro?:string, numero?:string}>}
 *   etapa: 'config' | 'api' | 'myzap' | 'envio'
 */
async function enviarTesteParaProprioNumero() {
  const { clickApiUrl, clickToken, sessionKey, sessionName, myzapApiToken } = await obterCredenciaisAtivas();

  if (!clickApiUrl || !clickToken || !sessionKey || !sessionName || !myzapApiToken) {
    return { ok: false, etapa: 'config', erro: 'Configuracao do ClickExpress/MyZap incompleta.' };
  }

  // 1) Valida a API e obtem o proprio numero (cell da loja)
  let numero;
  try {
    const query = new URLSearchParams({ sessionKey, sessionToken: sessionName }).toString();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${clickApiUrl}parametrizacao-myzap/numero-loja?${query}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${clickToken}` },
      signal: ctrl.signal
    });

    clearTimeout(timeout);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.error) {
      return { ok: false, etapa: 'api', erro: data?.error || `API respondeu HTTP ${res.status}` };
    }
    numero = data?.result?.numero;
    if (!numero) {
      return { ok: false, etapa: 'api', erro: 'A API nao retornou o numero da loja (cell cadastrado?)' };
    }
  } catch (err) {
    return { ok: false, etapa: 'api', erro: `Falha ao falar com a API: ${err?.message || err}` };
  }

  // 2) MyZap disponivel?
  const myzapOk = await validarDisponibilidadeMyZap(sessionKey, myzapApiToken);
  if (!myzapOk) {
    return { ok: false, etapa: 'myzap', erro: 'MyZap indisponivel (WhatsApp desconectado?)', numero };
  }

  // 3) Envia a mensagem de teste para o proprio numero
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${MYZAP_API_URL}sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apitoken: myzapApiToken,
        sessionkey: sessionKey
      },
      body: JSON.stringify({
        session: sessionName,
        number: numero,
        text: '✅ Teste do ClickExpress: se voce recebeu esta mensagem, o WhatsApp esta enviando normalmente.'
      }),
      signal: ctrl.signal
    });

    clearTimeout(timeout);
    const body = await res.json().catch(() => ({}));

    if (!res.ok || body?.error || (typeof body?.result !== 'undefined' && body.result !== 200)) {
      return { ok: false, etapa: 'envio', erro: body?.error || `Envio respondeu HTTP ${res.status}`, numero };
    }

    return { ok: true, numero };
  } catch (err) {
    return { ok: false, etapa: 'envio', erro: `Falha ao enviar pelo MyZap: ${err?.message || err}`, numero };
  }
}

module.exports = {
  setQueueNotifier,
  listarPendentesMyZap,
  getUltimosPendentesMyZap,
  startWhatsappQueueWatcher,
  stopWhatsappQueueWatcher,
  getWhatsappQueueWatcherStatus,
  processarFilaUmaRodada,
  enviarTesteParaProprioNumero
};
