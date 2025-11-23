// core/api/ticketWatcher.js
const consultarTickets = require('./consultarTickets');
const imprimirHTML     = require('../impressora/imprimirHtml');
const Store            = require('electron-store');
const { info, warn, error, debug } = require('../utils/logger');

const store = new Store();
let ativo   = false;

async function startWatcher() {
  if (ativo) return;
  ativo = true;

  info('🔁 Iniciando watcher de impressão…', {
    metadata: { area: 'ticketWatcher' }
  });

  while (ativo) {
    try {
      const tickets = await consultarTickets();
      debug('Tickets consultados', { metadata: { quantidade: tickets.length } });
      const impressoraPadrao = store.get('printer'); // Impressora padrão das configurações
      
      for (const item of tickets) {
        try {
          // Cada item agora é { texto: "...", impressora: "nome" ou null }
          const textoParaImprimir = item.texto || item; // Compatibilidade com formato antigo
          const impressoraEspecifica = item.impressora; // null ou nome da impressora

          info('Impressão do ticket iniciado', {
            metadata: {
              impressoraSolicitada: impressoraEspecifica || 'padrão',
              ticket: item.id || item.chave || null
            }
          });
          
          // Se vier impressora específica, usa ela; senão usa a padrão
          const printerName = impressoraEspecifica || impressoraPadrao;
          
          if (!printerName) {
            warn('⚠️ Nenhuma impressora definida para este ticket', {
              metadata: { ticket: item.id || item.chave || null }
            });
            continue;
          }
          
          info('🖨️ Enviando para impressora', {
            metadata: {
              impressora: printerName,
              modo: impressoraEspecifica ? 'especifica' : 'padrao'
            }
          });
          
          const resultado = await imprimirHTML({ msg: textoParaImprimir, printerName });
          info('✅ Ticket impresso com sucesso', {
            metadata: {
              impressora: printerName,
              jobId: resultado.jobId,
              ticket: item.id || null,
              origemJob: resultado.source
            }
          });
        } catch (error) {
          error('❌ Erro ao imprimir ticket', {
            metadata: { error, ticket: item?.id || null }
          });
        }
      }
      await delay(500);
    } catch (e) {
      error('❌ Erro no watcher de tickets', {
        metadata: { error: e }
      });
      await delay(3000);
    }
  }
}

function stopWatcher() {
  ativo = false;
  info('⛔ Watcher de impressão parado');
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

module.exports = { startWatcher, stopWatcher };
