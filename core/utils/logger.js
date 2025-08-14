const fs = require('fs');
const path = require('path');
const os = require('os');

const RETENCAO_DIAS = 7;
const TMP_BASE = path.join(os.tmpdir(), 'jv-printer', 'logs');

if (!fs.existsSync(TMP_BASE)) {
  fs.mkdirSync(TMP_BASE, { recursive: true });
}

function getLogPath() {
  const data = new Date().toISOString().split('T')[0]; // yyyy-mm-dd
  return path.join(TMP_BASE, `${data}-log-sistema.log`);
}

function log(msg) {
  const agora = new Date();
  const timestamp = agora.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const linha = `[${timestamp}] ${msg}${os.EOL}`;
  fs.appendFileSync(getLogPath(), linha, 'utf8');
}

function logImpressao(impressora, conteudo, jobId = null) {
  const agora = new Date();
  const timestamp = agora.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  const jobInfo = jobId ? ` | JobID: ${jobId}` : '';
  const tamanho = conteudo ? ` | Tamanho: ${conteudo.length} chars` : '';
  const linha = `[${timestamp}] IMPRESSAO - Impressora: ${impressora}${tamanho}${jobInfo}${os.EOL}`;
  
  fs.appendFileSync(getLogPath(), linha, 'utf8');
}

function limparLogsAntigos() {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;

  fs.readdir(TMP_BASE, (err, arquivos) => {
    if (err) return;

    arquivos.forEach(arquivo => {
      const fullPath = path.join(TMP_BASE, arquivo);
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
  shell.openPath(TMP_BASE);
}

function getCaminhoLogs() {
  return TMP_BASE;
}

function criarArquivoAjuda() {
  const { app } = require('electron');
  const appPath = app ? app.getAppPath() : process.cwd();
  const caminhoAjuda = path.join(appPath, 'SOLUCAO_PROBLEMAS.txt');
  
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
${TMP_BASE}

ARQUIVOS DE LOG:
- YYYY-MM-DD-log-sistema.log - Logs do sistema de impressao
- YYYY-MM-DD-log-win.log - Logs dos Job IDs do Windows

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
    log('📄 Arquivo de ajuda criado: ' + caminhoAjuda);
  } catch (error) {
    log('❌ Erro ao criar arquivo de ajuda: ' + error.message);
  }
}

// limpa ao carregar
limparLogsAntigos();

// cria arquivo de ajuda ao inicializar
criarArquivoAjuda();

module.exports = { log, getLogPath, logImpressao, abrirPastaLogs, getCaminhoLogs, criarArquivoAjuda };
