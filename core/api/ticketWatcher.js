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
      
      console.log('\n[WATCHER] 🔍 Processando tickets...');
      console.log('[WATCHER] Total de tickets:', tickets.length);
      console.log('[WATCHER] Impressora padrão:', impressoraPadrao);
      
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
            console.warn('[WATCHER] ⚠️ Nenhuma impressora definida!');
            warn('⚠️ Nenhuma impressora definida para este ticket', {
              metadata: { ticket: item.id || item.chave || null }
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
          console.log(`[WATCHER] ✅ Impresso! Job ID: ${resultado.jobId}, Source: ${resultado.source}`);
          info('✅ Ticket impresso com sucesso', {
            metadata: {
              impressora: printerName,
              jobId: resultado.jobId,
              ticket: item.id || null,
              origemJob: resultado.source
            }
          });
        } catch (error) {
          console.error('[WATCHER] ❌ Erro ao imprimir:', error.message);
          error('❌ Erro ao imprimir ticket', {
            metadata: { error, ticket: item?.id || null }
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
