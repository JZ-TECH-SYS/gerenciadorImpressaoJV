// core/api/ticketWatcher.js
const consultarTickets = require('./consultarTickets');
const imprimirHTML     = require('../impressora/imprimirHtml').default;
const Store            = require('electron-store');
const { log }          = require('../utils/logger');

const store = new Store();
let ativo   = false;

async function startWatcher() {
  if (ativo) return;
  ativo = true;

  log('🔁 Iniciando watcher de impressão…');

  while (ativo) {
    try {
      const tickets = await consultarTickets();
      log(`📥 Tickets recebidos: ${tickets.length}`);

      const printerName = store.get('printer');   // string simples
      for (const texto of tickets) {
        await imprimirHTML({ msg: texto, printerName });
        log('✅ Ticket impresso');
      }
      await delay(500);
    } catch (e) {
      log('❌ Erro no watcher: ' + e.message);
      await delay(3000);
    }
  }
}

function stopWatcher() {
  ativo = false;
  log('⛔ Watcher de impressão parado');
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

module.exports = { startWatcher, stopWatcher };
