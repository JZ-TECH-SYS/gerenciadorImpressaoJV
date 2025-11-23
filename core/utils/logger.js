const fs = require('fs');
const path = require('path');
const os = require('os');

const RETENCAO_DIAS = 7;
const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB por arquivo antes de rotacionar
const LOG_DIR = path.join(os.tmpdir(), 'jv-printer', 'logs');
const LOG_CHANNELS = {
  system: 'log-sistema',
  windows: 'log-win'
};

const LEVEL_LABEL = {
  error: 'ERRO',
  warn: 'AVISO',
  info: 'INFO',
  debug: 'DEBUG'
};

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getLogFilePath(channel = 'system', extension = 'log') {
  ensureLogDir();
  const prefix = LOG_CHANNELS[channel] || LOG_CHANNELS.system;
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `${date}-${prefix}.${extension}`);
}

function rotateFileIfNeeded(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size >= MAX_FILE_BYTES) {
      const rotated = `${filePath}.${Date.now()}`;
      fs.renameSync(filePath, rotated);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Falha ao rotacionar log', error);
    }
  }
}

function sanitizeMetadata(metadata = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    if (value instanceof Error) {
      entries.push(`${key}: ${value.message}`);
      entries.push(`${key}_stack: ${value.stack || 'sem stack'}`);
    } else if (typeof value === 'object') {
      try {
        entries.push(`${key}: ${JSON.stringify(value)}`);
      } catch {
        entries.push(`${key}: [object]`);
      }
    } else {
      entries.push(`${key}: ${value}`);
    }
  }
  return entries.join(' | ');
}

function appendLine(filePath, line) {
  rotateFileIfNeeded(filePath);
  fs.promises.appendFile(filePath, line, 'utf8').catch((error) => {
    console.error('Não foi possível gravar o log', filePath, error.message);
  });
}

function log(message, options = {}) {
  const level = options.level || 'info';
  const metadata = options.metadata || {};
  const channel = options.channel || 'system';
  const timestamp = new Date();
  const levelName = (LEVEL_LABEL[level] || level || 'INFO').toUpperCase();
  const metaText = sanitizeMetadata(metadata);
  const textLine = `[${formatTimestamp(timestamp)}] [${levelName}] ${message}${metaText ? ' | ' + metaText : ''}${os.EOL}`;
  const jsonLine = JSON.stringify({
    timestamp: timestamp.toISOString(),
    level,
    message,
    channel,
    metadata
  }) + os.EOL;

  appendLine(getLogFilePath(channel, 'log'), textLine);
  appendLine(getLogFilePath(channel, 'jsonl'), jsonLine);
}

const info = (message, options = {}) => log(message, { ...options, level: 'info' });
const warn = (message, options = {}) => log(message, { ...options, level: 'warn' });
const error = (message, options = {}) => log(message, { ...options, level: 'error' });
const debug = (message, options = {}) => log(message, { ...options, level: 'debug' });

function logImpressao(impressora, conteudo, jobId = null) {
  const tamanho = typeof conteudo === 'string' ? conteudo.length : null;
  const meta = {
    impressora,
    jobId,
    comprimento: tamanho
  };
  const mensagem = jobId
    ? `IMPRESSAO - Impressora: ${impressora} | JobID: ${jobId}`
    : `IMPRESSAO - Impressora: ${impressora}`;
  log(mensagem, { level: jobId ? 'info' : 'warn', metadata: meta });
}

function limparLogsAntigos() {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  ensureLogDir();
  fs.readdir(LOG_DIR, (err, arquivos) => {
    if (err) return;
    arquivos.forEach((arquivo) => {
      const fullPath = path.join(LOG_DIR, arquivo);
      fs.stat(fullPath, (err, stats) => {
        if (!err && stats.mtimeMs < limite) {
          fs.unlink(fullPath, () => {});
        }
      });
    });
  });
}

function abrirPastaLogs() {
  const { shell } = require('electron');
  ensureLogDir();
  shell.openPath(LOG_DIR);
}

function getCaminhoLogs() {
  ensureLogDir();
  return LOG_DIR;
}

function criarArquivoAjuda() {
  const caminhoAjuda = path.join(LOG_DIR, 'SOLUCAO_PROBLEMAS.txt');
  const conteudoAjuda = `================================================================================
    GUIA DE SOLUCAO DE PROBLEMAS - Sistema de Impressao JV
================================================================================

PROBLEMAS DE PERMISSAO DO WINDOWS

Se o sistema nao conseguir capturar os Job IDs do Windows, execute os comandos abaixo:

COMANDOS PARA EXECUTAR COMO ADMINISTRADOR:

1. Habilitar log de impressao do Windows:
   wevtutil sl Microsoft-Windows-PrintService/Operational /e:true

2. Definir politica de execucao do PowerShell (se necessario):
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

3. Testar se o log esta funcionando:
   powershell -Command "Get-WinEvent -LogName 'Microsoft-Windows-PrintService/Operational' -MaxEvents 1"

COMO EXECUTAR:

1. Abra o Prompt de Comando como Administrador:
   - Pressione Win + R
   - Digite: cmd
   - Pressione Ctrl + Shift + Enter (para executar como admin)

2. Cole e execute cada comando acima

3. Reinicie a aplicacao JV-Printer

LOCALIZACAO DOS LOGS:
${LOG_DIR}

ARQUIVOS DE LOG:
- YYYY-MM-DD-log-sistema.log - Logs do sistema de impressao
- YYYY-MM-DD-log-win.log - Logs dos Job IDs do Windows
- YYYY-MM-DD-log-sistema.jsonl - Linha única em JSON por evento
- YYYY-MM-DD-log-win.jsonl - Linha única em JSON por evento dos jobs

SE AINDA NAO FUNCIONAR:

1. Verifique se a impressora esta funcionando
2. Faca uma impressao de teste
3. Verifique se aparecem eventos no Visualizador de Eventos do Windows
4. Entre em contato com o suporte tecnico

================================================================================
Desenvolvido por JZ-TECH-SYS
Sistema de Gerenciamento de Impressao JV
Data de criacao: ${new Date().toLocaleString('pt-BR')}
================================================================================`;
  try {
    fs.writeFileSync(caminhoAjuda, conteudoAjuda, 'utf8');
    log('📄 Arquivo de ajuda criado: ' + caminhoAjuda, { level: 'info' });
    return caminhoAjuda;
  } catch (error) {
    log('❌ Erro ao criar arquivo de ajuda: ' + error.message, { level: 'error', metadata: { error } });
    return null;
  }
}

// mantém logs limpos, configura help file e garante diretório
limparLogsAntigos();
criarArquivoAjuda();

module.exports = {
  log,
  info,
  warn,
  error,
  debug,
  logImpressao,
  getLogFilePath,
  getCaminhoLogs,
  abrirPastaLogs,
  getLogDir: getCaminhoLogs,
  LOG_DIR
};
