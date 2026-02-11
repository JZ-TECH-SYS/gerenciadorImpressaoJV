const Store = require('electron-store');
const { info, warn, error, debug } = require('../utils/logger');

const store = new Store();
const MYZAP_API_URL = 'http://localhost:5555/';

let ativo = false;
let accessToken = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.endsWith('/') ? url : `${url}/`;
}

async function loginClickExpress(apiBaseUrl, nome, senha) {
  const res = await fetch(`${apiBaseUrl}login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, senha })
  });

  const data = await res.json().catch(() => ({}));
  const token = data?.result?.token;

  if (!res.ok || !token) {
    throw new Error(data?.error || 'Falha ao autenticar no ClickExpress');
  }

  return token;
}

async function validaTokenClickExpress(apiBaseUrl, token) {
  const res = await fetch(`${apiBaseUrl}validaToken`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await res.json().catch(() => ({}));
  return res.ok && !data?.error;
}

async function buscarPendentes(apiBaseUrl, token, sessionKey, sessionToken) {
  const query = new URLSearchParams({
    sessionKey: sessionKey || '',
    sessionToken: sessionToken || ''
  }).toString();

  const res = await fetch(`${apiBaseUrl}parametrizacao-myzap/pendentes?${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || 'Falha ao consultar pendentes');
  }

  return Array.isArray(data?.result?.mensagens) ? data.result.mensagens : [];
}

async function atualizarStatusFila(apiBaseUrl, token, payload) {
  const res = await fetch(`${apiBaseUrl}parametrizacao-myzap/fila/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

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
    return { ok: false, erro: `JSON inválido da fila: ${e.message}` };
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

  const res = await fetch(`${MYZAP_API_URL}${endpointNormalizado}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apitoken: apiToken,
      sessionkey: sessionKey
    },
    body: JSON.stringify(data)
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    return { ok: false, erro: body?.error || `HTTP ${res.status}` };
  }

  return { ok: true, body };
}

async function startWhatsappQueueWatcher() {
  if (ativo) return;
  ativo = true;

  info('Iniciando watcher da fila MyZap', {
    metadata: { area: 'whatsappQueueWatcher' }
  });

  while (ativo) {
    try {
      const clickApiUrl = normalizeBaseUrl(store.get('clickexpress_apiUrl'));
      const clickUsuario = store.get('clickexpress_usuario');
      const clickSenha = store.get('clickexpress_senha');
      const sessionKey = store.get('myzap_sessionKey');
      const sessionToken = store.get('myzap_apiToken');

      if (!clickApiUrl || !clickUsuario || !clickSenha || !sessionKey || !sessionToken) {
        debug('Watcher MyZap aguardando configuração mínima', {
          metadata: {
            clickApiUrl: !!clickApiUrl,
            clickUsuario: !!clickUsuario,
            clickSenha: !!clickSenha,
            sessionKey: !!sessionKey,
            sessionToken: !!sessionToken
          }
        });
        await delay(5000);
        continue;
      }

      if (!accessToken) {
        accessToken = await loginClickExpress(clickApiUrl, clickUsuario, clickSenha);
      } else {
        const tokenValido = await validaTokenClickExpress(clickApiUrl, accessToken);
        if (!tokenValido) {
          accessToken = await loginClickExpress(clickApiUrl, clickUsuario, clickSenha);
        }
      }

      const pendentes = await buscarPendentes(clickApiUrl, accessToken, sessionKey, sessionToken);
      if (pendentes.length > 0) {
        info('Mensagens pendentes encontradas na fila MyZap', {
          metadata: { quantidade: pendentes.length }
        });
      }

      for (const mensagem of pendentes) {
        if (!ativo) break;

        let novoStatus = 'erro';
        try {
          const envio = await enviarParaMyZap(mensagem, sessionKey, sessionToken);
          novoStatus = envio.ok ? 'enviado' : 'erro';

          if (!envio.ok) {
            warn('Falha ao enviar mensagem para MyZap', {
              metadata: {
                idfila: mensagem?.idfila,
                idempresa: mensagem?.idempresa,
                motivo: envio?.erro || envio?.motivo
              }
            });
          }
        } catch (envioError) {
          warn('Erro inesperado no envio para MyZap', {
            metadata: {
              idfila: mensagem?.idfila,
              idempresa: mensagem?.idempresa,
              error: envioError
            }
          });
        }

        const statusOk = await atualizarStatusFila(clickApiUrl, accessToken, {
          idfila: mensagem?.idfila,
          idempresa: mensagem?.idempresa,
          status: novoStatus
        });

        if (!statusOk) {
          warn('Não foi possível atualizar status da fila MyZap', {
            metadata: {
              idfila: mensagem?.idfila,
              idempresa: mensagem?.idempresa,
              status: novoStatus
            }
          });
        }
      }

      await delay(2000);
    } catch (e) {
      error('Erro no watcher da fila MyZap', {
        metadata: { area: 'whatsappQueueWatcher', error: e }
      });
      accessToken = null;
      await delay(4000);
    }
  }
}

function stopWhatsappQueueWatcher() {
  ativo = false;
  accessToken = null;
  info('Watcher da fila MyZap parado', {
    metadata: { area: 'whatsappQueueWatcher' }
  });
}

module.exports = {
  startWhatsappQueueWatcher,
  stopWhatsappQueueWatcher
};
