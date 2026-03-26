// core/api/ticketWatcher.js
const consultarTickets = require('./consultarTickets');
const imprimirHTML     = require('../impressora/imprimirHtml');
const Store            = require('electron-store');
const { info, warn, error, debug } = require('../utils/printerLogger');

const store = new Store();
let ativo   = false;
const RECENT_TICKET_TTL_MS = 15 * 1000;
const recentPrintedTickets = new Map();

function cleanupRecentPrintedTickets(now = Date.now()) {
  for (const [key, timestamp] of recentPrintedTickets.entries()) {
    if ((now - timestamp) > RECENT_TICKET_TTL_MS) {
      recentPrintedTickets.delete(key);
    }
  }
}

function getTicketReference(item) {
  return item?.id || item?.chave || item?.idticket || item?.idTicket || null;
}

function getTicketDedupKey(item, printerName) {
  const reference = getTicketReference(item);
  if (!reference || !printerName) {
    return null;
  }
  return `${reference}::${printerName}`;
}

function wasTicketPrintedRecently(ticketKey, now = Date.now()) {
  cleanupRecentPrintedTickets(now);
  const timestamp = recentPrintedTickets.get(ticketKey);
  return Boolean(timestamp && (now - timestamp) <= RECENT_TICKET_TTL_MS);
}

function markTicketAsPrinted(ticketKey, now = Date.now()) {
  if (!ticketKey) return;
  cleanupRecentPrintedTickets(now);
  recentPrintedTickets.set(ticketKey, now);
}

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
      cleanupRecentPrintedTickets();
      
      console.log('\n[WATCHER] 🔍 Processando tickets...');
      console.log('[WATCHER] Total de tickets:', tickets.length);
      console.log('[WATCHER] Impressora padrão:', impressoraPadrao);
      
      for (const item of tickets) {
        try {
          // Cada item agora é { texto: "...", impressora: "nome" ou null }
          const textoParaImprimir = item.texto || item; // Compatibilidade com formato antigo
          const impressoraEspecifica = item.impressora; // null ou nome da impressora
          const ticketRef = getTicketReference(item);

          info('Impressão do ticket iniciado', {
            metadata: {
              impressoraSolicitada: impressoraEspecifica || 'padrão',
              ticket: ticketRef
            }
          });
          
          // Se vier impressora específica, usa ela; senão usa a padrão
          const printerName = impressoraEspecifica || impressoraPadrao;
          
          if (!printerName) {
            console.warn('[WATCHER] ⚠️ Nenhuma impressora definida!');
            warn('⚠️ Nenhuma impressora definida para este ticket', {
              metadata: { ticket: ticketRef }
            });
            continue;
          }

          const ticketKey = getTicketDedupKey(item, printerName);
          if (ticketKey && wasTicketPrintedRecently(ticketKey)) {
            warn('Ticket repetido ignorado dentro da janela de proteção', {
              metadata: {
                ticket: ticketRef,
                ticketKey,
                impressora: printerName,
                ttlMs: RECENT_TICKET_TTL_MS
              }
            });
            continue;
          }

          // Log detalhado do conteúdo que vai ser impresso
          const temImagem = textoParaImprimir?.includes('data:image');
          const temQRCode = textoParaImprimir?.toLowerCase().includes('qr code');
          const temStyleTag = textoParaImprimir?.toLowerCase().includes('<style');
          const temDivTag = textoParaImprimir?.toLowerCase().includes('<div');
          const temUnicodeEscape = textoParaImprimir?.includes('\\u003C');
          
          console.log(`\n[WATCHER] 📄 Ticket ${tickets.indexOf(item) + 1} - Conteúdo:`);
          console.log(`  - Tamanho: ${textoParaImprimir?.length} caracteres`);
          console.log(`  - Tem <style>? ${temStyleTag}`);
          console.log(`  - Tem <div>? ${temDivTag}`);
          console.log(`  - Tem imagem base64? ${temImagem}`);
          console.log(`  - Tem QR Code? ${temQRCode}`);
          console.log(`  - Tem Unicode escapado (\\u003C)? ${temUnicodeEscape}`);
          console.log(`  - Preview: ${textoParaImprimir?.substring(0, 200)}`);

          if (temUnicodeEscape) {
            console.warn(`  ⚠️ AVISO: HTML contém Unicode escapado! Será decodificado em imprimirHtml.js`);
          }

          if (!temStyleTag || !temDivTag) {
            console.warn(`  ⚠️ AVISO: HTML pode estar corrompido! Faltam tags críticas`);
          }
          
          info('📄 Conteúdo do ticket pronto para impressão', {
            metadata: {
              impressora: printerName,
              tamanhoTexto: textoParaImprimir?.length || 0,
              temImagem,
              temQRCode,
              temStyleTag,
              temDivTag,
              temUnicodeEscape,
              previewPrimeiros200chars: textoParaImprimir?.substring(0, 200) || 'vazio'
            }
          });
          
          console.log(`[WATCHER] 🖨️ Enviando para impressora: ${printerName}`);
          info('🖨️ Enviando para impressora', {
            metadata: {
              impressora: printerName,
              modo: impressoraEspecifica ? 'especifica' : 'padrao'
            }
          });
          
          const resultado = await imprimirHTML({ msg: textoParaImprimir, printerName });
          markTicketAsPrinted(ticketKey);
          console.log(`[WATCHER] ✅ Impresso! Job ID: ${resultado.jobId}, Source: ${resultado.source}`);
          info('✅ Ticket impresso com sucesso', {
            metadata: {
              impressora: printerName,
              jobId: resultado.jobId,
              ticket: ticketRef,
              origemJob: resultado.source,
              ticketKey
            }
          });
        } catch (printErr) {
          console.error('[WATCHER] ❌ Erro ao imprimir:', printErr.message);
          error('❌ Erro ao imprimir ticket', {
            metadata: { error: printErr, ticket: getTicketReference(item) }
          });
        }
      }
      await delay(500);
    } catch (e) {
      console.error('[WATCHER] ❌ Erro no loop:', e.message);
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
