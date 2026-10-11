const Store = require("electron-store");
const store = new Store();
const { warn, error, debug } = require('../utils/printerLogger');
const { maquina, VERSAO } = require('../impressora/confirmacao');

// v4.1: além dos tickets, as chaves novas (e opcionais) do contrato. API antiga
// sem elas = fluxo antigo: sem rastreio nem resultado.
const VAZIO = { tickets: [], idprint: null, confirmar: false, cmd: null };

async function consultarTickets() {
  const token = store.get('apiToken');
  const api = store.get("apiUrl");
  const idempresa = store.get("idempresa");

  if (!token) {
    warn("Token não encontrado", {
      metadata: { area: 'consultarTickets', missing: 'token' }
    });
    return VAZIO;
  }

  if (!api) {
    warn("URL da API não encontrada", {
      metadata: { area: 'consultarTickets', missing: 'apiUrl' }
    });
    return VAZIO;
  }

  try {
    const res = await fetch(`${api}cronImpressaoDiretav3/${idempresa}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        // v4.1: gerenciador que confirma o papel (contrato §1)
        'X-JV-Confirma': '1',
        'X-JV-Maquina': maquina(),
        'X-JV-Versao': VERSAO
      }
    });
    const data = await res.json();
    if (!res.ok) {
      warn('Resposta não esperada da API', {
        metadata: { status: res.status, body: data }
      });
    }
    const result = data?.result || {};
    const tickets = Array.isArray(result.texto) ? result.texto : [];
    if (tickets.length) {
      debug('Tickets recebidos', {
        metadata: { quantidade: tickets.length, origem: api }
      });
    }
    return {
      tickets,
      idprint: result.idprint ?? null,
      confirmar: result.confirmar === true,
      cmd: result.cmd || null
    };

  } catch (e) {
    error("Erro ao consultar API", {
      metadata: { area: 'consultarTickets', error: e }
    });
    return VAZIO;
  }
}

module.exports = consultarTickets;
