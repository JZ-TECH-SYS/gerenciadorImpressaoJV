// core/api/ticketWatcher.js
const consultarTickets = require('./consultarTickets');
const imprimirHTML     = require('../impressora/imprimirHtml');
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

      const impressoraPadrao = store.get('printer'); // Impressora padrão das configurações
      
      for (const item of tickets) {
        try {
          // Cada item agora é { texto: "...", impressora: "nome" ou null }
          const textoParaImprimir = item.texto || item; // Compatibilidade com formato antigo
          const impressoraEspecifica = item.impressora; // null ou nome da impressora

          log(`Impressão do ticket iniciado. impressora: ${impressoraEspecifica || 'padrão'}`);
          
          // Se vier impressora específica, usa ela; senão usa a padrão
          const printerName = impressoraEspecifica || impressoraPadrao;
          
          if (!printerName) {
            log(`⚠️ Nenhuma impressora definida para este ticket`);
            continue;
          }
          
          log(`🖨️ Imprimindo na: ${printerName} ${impressoraEspecifica ? '(específica)' : '(padrão)'}`);
          
          const resultado = await imprimirHTML({ msg: textoParaImprimir, printerName });
          log(`✅ Ticket impresso com sucesso | Impressora: ${printerName} | JobID: ${resultado.jobId}`);
        } catch (error) {
          log(`❌ Erro ao imprimir ticket: ${error.message}`);
        }
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
