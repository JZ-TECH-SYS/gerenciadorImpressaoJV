const Store = require("electron-store");
const store = new Store();
const { warn, error, debug } = require('../utils/logger');

async function consultarTickets() {
  const token = store.get('apiToken');
  const api = store.get("apiUrl");
  const idempresa = store.get("idempresa");

  if (!token) {
    warn("Token não encontrado", {
      metadata: { area: 'consultarTickets', missing: 'token' }
    });
    return [];
  }

  if (!api) {
    warn("URL da API não encontrada", {
      metadata: { area: 'consultarTickets', missing: 'apiUrl' }
    });
    return [];
  }

  try {
    const res = await fetch(`${api}cronImpressaoDiretav3/${idempresa}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!res.ok) {
      warn('Resposta não esperada da API', {
        metadata: { status: res.status, body: data }
      });
    }
    const tickets = Array.isArray(data.result?.texto) ? data.result.texto : [];
    debug('Tickets recebidos', {
      metadata: { quantidade: tickets.length, origem: api }
    });
    return tickets;

  } catch (e) {
    error("Erro ao consultar API", {
      metadata: { area: 'consultarTickets', error: e }
    });
    return [];
  }
}

module.exports = consultarTickets;
