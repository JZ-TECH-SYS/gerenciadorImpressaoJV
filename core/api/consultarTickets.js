const Store = require("electron-store");
const store = new Store();
const { log } = require('../utils/logger');

async function consultarTickets() {
  const token = store.get('apiToken');
  const api = store.get("apiUrl");
  const idempresa = store.get("idempresa");

  if (!token) {
    log("Token não encontrado");
    return [];
  }

  if (!api) {
    log("URL da API não encontrada");
    return [];
  }

  try {
    log("Consultando tickets na API... " + `${api}cronImpressaoDiretav3/${idempresa}`);
    const res = await fetch(`${api}cronImpressaoDiretav3/${idempresa}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });
    const data = await res.json();
    return Array.isArray(data.result?.texto) ? data.result.texto : [];

  } catch (e) {
    log("Erro ao consultar API:" + e.message);
    return [];
  }
}

module.exports = consultarTickets;
