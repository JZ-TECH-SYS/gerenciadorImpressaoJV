const fs = require('fs');
const path = require('path');
const os = require('os');

const RETENCAO_DIAS = 7;
const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB por arquivo antes de rotacionar
const LOG_DIR = path.join(os.tmpdir(), 'jv-printer', 'logs');
const LOG_TIMEZONE = 'America/Sao_Paulo';
const WRITE_PLAIN_LOG = false; // padroniza saída em JSON Lines
const LOG_CHANNELS = {
  system: 'log-sistema',
  printer: 'log-impressora',
  windows: 'log-impressora',
  myzap: 'log-myzap'
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
    timeZone: LOG_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getLogDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const map = parts.reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return `${map.year}-${map.month}-${map.day}`;
}

function getLogFilePath(channel = 'system', extension = 'log') {
  ensureLogDir();
  const prefix = LOG_CHANNELS[channel] || LOG_CHANNELS.system;
  const date = getLogDateKey();
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

function prepararConteudoParaLog(conteudo, { maxLength = 24 * 1024 } = {}) {
  if (typeof conteudo !== 'string') return null;
  const normalized = conteudo.replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const remainder = normalized.length - maxLength;
  return `${normalized.slice(0, maxLength)}\n... [truncado: +${remainder} caracteres]`;
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
  const jsonLine = JSON.stringify({
    timestamp: timestamp.toISOString(),
    level,
    message,
    channel,
    metadata
  }) + os.EOL;

  if (WRITE_PLAIN_LOG) {
    const levelName = (LEVEL_LABEL[level] || level || 'INFO').toUpperCase();
    const metaText = sanitizeMetadata(metadata);
    const textLine = `[${formatTimestamp(timestamp)}] [${levelName}] ${message}${metaText ? ' | ' + metaText : ''}${os.EOL}`;
    appendLine(getLogFilePath(channel, 'log'), textLine);
  }
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
  const conteudoLog = prepararConteudoParaLog(conteudo);
  if (conteudoLog) {
    meta.conteudo = conteudoLog;
  }
  log(mensagem, { level: jobId ? 'info' : 'warn', channel: 'printer', metadata: meta });
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
  const isWindows = os.platform() === 'win32';
  
  const conteudoWindows = `================================================================================
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
- YYYY-MM-DD-log-sistema.jsonl - Eventos gerais do aplicativo
- YYYY-MM-DD-log-impressora.jsonl - Eventos de impressao e Job IDs
- YYYY-MM-DD-log-myzap.jsonl - Eventos do MyZap / WhatsApp
- YYYY-MM-DD-log-impressora.log - Versao texto puro da impressao (se habilitada)

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

  const conteudoLinux = `================================================================================
    GUIA DE SOLUCAO DE PROBLEMAS - Sistema de Impressao JV
================================================================================

CONFIGURACAO DO CUPS (Linux Mint / Ubuntu / Debian)

Se o sistema nao conseguir imprimir ou detectar impressoras, verifique:

COMANDOS PARA EXECUTAR NO TERMINAL:

1. Verificar se o CUPS esta instalado e rodando:
   sudo systemctl status cups

2. Iniciar o servico CUPS se necessario:
   sudo systemctl start cups
   sudo systemctl enable cups

3. Listar impressoras disponiveis:
   lpstat -p -d

4. Verificar se sua impressora esta instalada:
   lpstat -a

5. Fazer uma impressao de teste:
   echo "Teste JV-Printer" | lp -d NOME_DA_SUA_IMPRESSORA

6. Acessar interface web do CUPS:
   Abra o navegador em: http://localhost:631

INSTALACAO DO CUPS (se nao estiver instalado):

   sudo apt update
   sudo apt install cups cups-client

PERMISSOES:

1. Adicionar seu usuario ao grupo lpadmin:
   sudo usermod -aG lpadmin $USER

2. Fazer logout e login novamente para aplicar

LOCALIZACAO DOS LOGS:
${LOG_DIR}

ARQUIVOS DE LOG:
- YYYY-MM-DD-log-sistema.jsonl - Eventos gerais do aplicativo
- YYYY-MM-DD-log-impressora.jsonl - Eventos de impressao
- YYYY-MM-DD-log-myzap.jsonl - Eventos do MyZap / WhatsApp
- YYYY-MM-DD-log-impressora.log - Versao texto puro da impressao (se habilitada)

SE AINDA NAO FUNCIONAR:

1. Verifique se a impressora esta ligada e conectada
2. Faca uma impressao de teste via interface do CUPS (localhost:631)
3. Verifique os logs do CUPS: sudo cat /var/log/cups/error_log
4. Entre em contato com o suporte tecnico

================================================================================
Desenvolvido por JZ-TECH-SYS
Sistema de Gerenciamento de Impressao JV
Data de criacao: ${new Date().toLocaleString('pt-BR')}
================================================================================`;

  const conteudoAjuda = isWindows ? conteudoWindows : conteudoLinux;
  
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
  getLogDateKey,
  getCaminhoLogs,
  abrirPastaLogs,
  criarArquivoAjuda,
  getLogDir: getCaminhoLogs,
  LOG_DIR
};
