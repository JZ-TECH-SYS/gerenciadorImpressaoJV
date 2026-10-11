// core/api/ticketWatcher.js
const consultarTickets = require('./consultarTickets');
const imprimirHTML     = require('../impressora/imprimirHtml');
const confirmacao      = require('../impressora/confirmacao');
const Store            = require('electron-store');
const { info, warn, error, debug } = require('../utils/printerLogger');

const store = new Store();
let ativo   = false;
// v4.1: true durante um ciclo (consulta + impressão + rastreio). O updater
// espera ficar ocioso antes do quitAndInstall.
let ocupado = false;
const RECENT_TICKET_TTL_MS = 15 * 1000;
const recentPrintedTickets = new Map();

// v4 — status para a UI (semaforo/aba Impressao). APENAS contadores
// aditivos: nenhuma linha da logica de impressao foi alterada.
let ultimaConsultaEm = null;
let ultimaImpressaoEm = null;
let ultimoTicketRef = null;
let impressoesHoje = 0;
let diaContagem = new Date().toDateString();
let ultimoErroImpressao = null;

function registrarImpressaoOk(ticketRef) {
  const hoje = new Date().toDateString();
  if (hoje !== diaContagem) { diaContagem = hoje; impressoesHoje = 0; }
  impressoesHoje += 1;
  ultimaImpressaoEm = new Date().toISOString();
  ultimoTicketRef = ticketRef ?? null;
  ultimoErroImpressao = null;
}

function getPrintingStatus() {
  return {
    ativo,
    ultimaConsultaEm,
    ultimaImpressaoEm,
    ultimoTicketRef,
    impressoesHoje: (new Date().toDateString() === diaContagem) ? impressoesHoje : 0,
    ultimoErroImpressao
  };
}

/** v4.1: true enquanto há ciclo de impressão ou resultado a caminho da API. */
function isPrinting() {
  return ocupado || confirmacao.enviosPendentes() > 0;
}

// Uma via do `detalhe` do POST impressao/resultado; `r` sobrescreve os padrões.
function novaVia(impressora, documento, inicio, r) {
  return {
    impressora, documento, visto_na_fila: false, job_status: null,
    etapa: null, erro: null, confirmacao: null, ...r, ms: Date.now() - inicio
  };
}

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
    ocupado = true;
    try {
      const { tickets, idprint, confirmar, cmd } = await consultarTickets();
      ultimaConsultaEm = new Date().toISOString();
      if (cmd === 'enviar_logs') confirmacao.enviarLogs();
      if (tickets.length) {
        debug('Tickets consultados', { metadata: { quantidade: tickets.length } });
      }
      // v4.1: com `confirmar` a API deixou a comanda "entregue" e espera o
      // resultado desta entrega. Sem ele: exatamente o fluxo antigo.
      const reportar = confirmar && idprint != null;
      const detalhe = [];
      const impressoraPadrao = store.get('printer'); // Impressora padrão das configurações
      cleanupRecentPrintedTickets();
      
      console.log('\n[WATCHER] 🔍 Processando tickets...');
      console.log('[WATCHER] Total de tickets:', tickets.length);
      console.log('[WATCHER] Impressora padrão:', impressoraPadrao);
      
      for (const [indice, item] of tickets.entries()) {
        const inicio = Date.now();
        let printerName = null;
        let documento = null;
        let via = null; // destino desta via (só vai para a API com `reportar`)
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
          printerName = impressoraEspecifica || impressoraPadrao;
          
          if (!printerName) {
            // v4.1: deixou de ser silencioso — é falha (antes do spooler).
            throw new Error('nenhuma impressora definida para este ticket');
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
            via = { resultado: 'impresso', confirmacao: 'indisponivel' };
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
          
          // Windows + confirmar: o <title> vira o nome do trabalho na fila.
          documento = reportar && process.platform === 'win32' ? `jv-${idprint}-${indice + 1}` : null;
          const msg = documento ? confirmacao.injetarTitulo(textoParaImprimir, documento) : textoParaImprimir;
          const resultado = await imprimirHTML({ msg, printerName, paperWidthMm: Number(store.get('printer_paper_mm')) || null });
          // Chegou ao spooler/CUPS: daqui em diante nunca é "antes_spooler"
          // (reentregar duplicaria o papel).
          via = { resultado: 'impresso', confirmacao: 'indisponivel' };
          markTicketAsPrinted(ticketKey);
          registrarImpressaoOk(ticketRef);
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
          if (documento) {
            // Windows + confirmar: rastreio da fila (limitado a ~12 s; nunca lança).
            via = await confirmacao.rastrearJob({ impressora: printerName, documento });
            info('Resultado da via na fila', { metadata: { idprint, documento, impressora: printerName, ...via } });
            if (via.resultado === 'erro') {
              ultimoErroImpressao = { em: new Date().toISOString(), erro: via.erro, ticket: ticketRef };
              confirmacao.registrarErro(via.erro, idprint);
            }
          }
        } catch (printErr) {
          ultimoErroImpressao = { em: new Date().toISOString(), erro: printErr.message, ticket: getTicketReference(item) };
          console.error('[WATCHER] ❌ Erro ao imprimir:', printErr.message);
          error('❌ Erro ao imprimir ticket', {
            metadata: { error: printErr, ticket: getTicketReference(item) }
          });
          if (!via) {
            const motivo = printErr?.message || String(printErr);
            via = { resultado: 'erro', etapa: 'antes_spooler', erro: motivo };
            confirmacao.registrarErro(motivo, idprint);
          }
        } finally {
          if (via) detalhe.push(novaVia(printerName, documento, inicio, via));
        }
      }
      if (reportar && detalhe.length) {
        confirmacao.enviarResultado(idprint, detalhe); // sem await: não segura a próxima consulta
        confirmacao.vigiarTardio(idprint, detalhe); // v4.2: via travada na fila do Windows fica vigiada
      }
      ocupado = false;
      await delay(500);
    } catch (e) {
      console.error('[WATCHER] ❌ Erro no loop:', e.message);
      error('❌ Erro no watcher de tickets', {
        metadata: { error: e }
      });
      ocupado = false;
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

module.exports = { startWatcher, stopWatcher, getPrintingStatus, isPrinting };
