// core/impressora/imprimirHtml.js
const { BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { info, debug, warn, error, logImpressao } = require('../utils/logger');
const windowsJobMonitor = require('../utils/windowsJobMonitor');

const isWindows = os.platform() === 'win32';

/**
 * Converte HTML para texto formatado para impressoras térmicas
 * Preserva estrutura básica: negrito, centralização, linhas
 */
function htmlParaTexto(html, largura = 48) {
  // Remove scripts e styles
  let texto = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Processa tags de formatação
  // Centralização - adiciona espaços para centralizar
  texto = texto.replace(/<([^>]+)style="[^"]*text-align:\s*center[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi, (match, tag, content) => {
    const linhas = content.replace(/<[^>]+>/g, '').split('\n');
    return linhas.map(linha => {
      linha = linha.trim();
      const espacos = Math.max(0, Math.floor((largura - linha.length) / 2));
      return ' '.repeat(espacos) + linha;
    }).join('\n');
  });
  
  // Converte tags para texto
  texto = texto
    // Títulos e negrito - mantém em maiúsculas para destaque
    .replace(/<(h[1-3]|strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (match, tag, content) => {
      return content.replace(/<[^>]+>/g, '').toUpperCase();
    })
    // <br> para quebra de linha
    .replace(/<br\s*\/?>/gi, '\n')
    // </p>, </div>, </tr>, </li> para quebra de linha
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    // <hr> para linha de separação
    .replace(/<hr[^>]*>/gi, '\n' + '-'.repeat(largura) + '\n')
    // <td> para tabulação/espaço
    .replace(/<td[^>]*>/gi, '  ')
    // Remove todas as outras tags
    .replace(/<[^>]+>/g, '')
    // Decodifica entidades HTML
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&copy;/gi, '(c)')
    .replace(/&reg;/gi, '(R)')
    .replace(/&#(\d+);/gi, (match, dec) => String.fromCharCode(dec))
    // Normaliza espaços e quebras
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    // Trim cada linha
    .split('\n')
    .map(linha => linha.trim())
    .filter((linha, i, arr) => linha || (i > 0 && arr[i-1])) // Remove linhas vazias consecutivas
    .join('\n')
    .trim();
  
  // Adiciona quebras de linha no final para corte
  texto += '\n\n\n\n';
  
  return texto;
}

/**
 * Imprime texto via comando lp no Linux
 */
async function imprimirViaLp(texto, printerName) {
  const tmpFile = path.join(os.tmpdir(), `jv-print-${Date.now()}.txt`);
  
  try {
    // Salva o texto em arquivo temporário (UTF-8)
    fs.writeFileSync(tmpFile, texto, 'utf8');
    
    // Imprime via lp com raw
    const cmd = `lp -d "${printerName}" -o raw "${tmpFile}"`;
    info('Enviando impressão via lp (Linux)', {
      metadata: { impressora: printerName, comando: cmd }
    });
    
    const { stdout } = await execPromise(cmd);
    
    // Extrai Job ID do output (ex: "request id is POS-80-123")
    const match = stdout.match(/request id is (\S+)/i);
    const jobId = match ? match[1] : `LNX_${Date.now()}`;
    
    // Remove arquivo temporário
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    
    return { success: true, jobId, source: 'lp-linux' };
  } catch (err) {
    // Tenta limpar arquivo temporário
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    throw new Error(`Erro ao imprimir via lp: ${err.message}`);
  }
}

async function imprimirHTML({
  msg,
  printerName,
  widthPx = 576,
  silent = true
}) {
  if (!printerName) throw new Error('Nome da impressora não informado');

  // Log inicial da tentativa de impressão
  logImpressao(printerName, msg, null);
  info('Iniciando impressão HTML', {
    metadata: { impressora: printerName, tamanho: msg.length, tipo: 'html', plataforma: isWindows ? 'windows' : 'linux' }
  });

  // ============ LINUX: Usa impressão via texto puro ============
  if (!isWindows) {
    info('Linux detectado - usando impressão via texto puro (lp)', {
      metadata: { impressora: printerName }
    });
    
    try {
      const texto = htmlParaTexto(msg);
      debug('HTML convertido para texto', {
        metadata: { 
          tamanhoOriginal: msg.length, 
          tamanhoTexto: texto.length,
          preview: texto.substring(0, 200) + '...'
        }
      });
      
      const resultado = await imprimirViaLp(texto, printerName);
      logImpressao(printerName, texto, resultado.jobId);
      
      info('Impressão Linux concluída', {
        metadata: { impressora: printerName, jobId: resultado.jobId }
      });
      
      return resultado;
    } catch (err) {
      error('Falha na impressão Linux via lp', {
        metadata: { impressora: printerName, erro: err.message }
      });
      throw err;
    }
  }

  // ============ WINDOWS: Usa Electron webContents.print() ============
  debug('Windows detectado - usando impressão via Electron', {
    metadata: {
      impressora: printerName,
      snippet: msg.length > 400 ? `${msg.slice(0, 400)}...` : msg
    }
  });

  const win = new BrowserWindow({
    show: false,
    width: widthPx,
    height: 1000,
    webPreferences: { sandbox: false }
  });

  info('Carregando conteúdo HTML no BrowserWindow', {
    metadata: { impressora: printerName }
  });

  await win.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(msg)
  );

  return new Promise(async (resolve, reject) => {
    win.webContents.print(
      {
        silent,
        deviceName: printerName,
        margins: { marginType: 'none' }
      },
      async (success, failureReason) => {
        if (success) {
          // Aguarda um pouco e tenta capturar o Job ID real do Windows
          info('HTML enviado para impressora com sucesso', {
            metadata: { impressora: printerName }
          });
          
          try {
            const windowsJobId = await windowsJobMonitor.waitForJobId(printerName, 3000);
            
            if (windowsJobId) {
              logImpressao(printerName, msg, windowsJobId);
              info('Job confirmado pelo Windows', {
                metadata: { impressora: printerName, jobId: windowsJobId }
              });
              win.close();
              resolve({ success: true, jobId: windowsJobId, source: 'windows' });
            } else {
              // Fallback para ID customizado se não conseguir pegar do Windows
              const fallbackId = `CUSTOM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              logImpressao(printerName, msg, fallbackId);
              warn('Fallback de JobID após tentativa pelo Windows', {
                metadata: { impressora: printerName, jobId: fallbackId }
              });
              win.close();
              resolve({ success: true, jobId: fallbackId, source: 'fallback' });
            }
          } catch (error) {
            warn('Erro ao buscar Job ID do Windows', {
              metadata: { impressora: printerName, error }
            });
            const fallbackId = `ERROR_${Date.now()}`;
            logImpressao(printerName, msg, fallbackId);
            win.close();
            resolve({ success: true, jobId: fallbackId, source: 'error' });
          }
        } else {
          const erro = failureReason || 'Erro desconhecido na impressão';
          error('Falha ao imprimir HTML', {
            metadata: { impressora: printerName, erro }
          });
          win.close();
          reject(new Error(erro));
        }
      }
    );
  });
}

module.exports = imprimirHTML;
