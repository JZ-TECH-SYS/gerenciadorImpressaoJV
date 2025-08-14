// core/utils/windowsJobMonitor.js
const { spawn } = require('child_process');
const { log } = require('./logger');
const fs = require('fs');
const path = require('path');
const os = require('os');

class WindowsJobMonitor {
  constructor() {
    this.recentJobs = new Map(); // Armazena jobs recentes
    this.TMP_BASE = path.join(os.tmpdir(), 'jv-printer', 'logs');
    this.jobCounter = Date.now() % 1000; // Contador para Job IDs únicos
    
    // Garante que o diretório existe
    if (!fs.existsSync(this.TMP_BASE)) {
      fs.mkdirSync(this.TMP_BASE, { recursive: true });
    }
  }

  // Gera caminho para log do Windows
  getWinLogPath() {
    const data = new Date().toISOString().split('T')[0]; // yyyy-mm-dd
    return path.join(this.TMP_BASE, `${data}-log-win.log`);
  }

  // Salva log específico do Windows
  logWindows(msg) {
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
    fs.appendFileSync(this.getWinLogPath(), linha, 'utf8');
  }

  // Monitora eventos de impressão do Windows  
  async getRecentPrintJobs() {
    return new Promise((resolve, reject) => {
      // Usa PowerShell com sintaxe mais simples
      const cmd = spawn('powershell', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        `
        try {
          $eventos = Get-WinEvent -LogName 'Microsoft-Windows-PrintService/Operational' -MaxEvents 20 -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq 307 -and $_.TimeCreated -gt (Get-Date).AddMinutes(-10) }
          
          foreach ($evento in $eventos) {
            $msg = $evento.Message
            $time = $evento.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
            
            if ($msg -match 'documento (\\d+)') {
              $jobId = $matches[1]
              
              $printer = 'Desconhecida'
              if ($msg -match 'em ([\\w\\-\\s]+) pela') {
                $printer = $matches[1].Trim()
              }
              
              Write-Output "$time|$jobId|$printer|Documento"
            }
          }
        } catch {
          # Não exibe erro, apenas continua
        }
        `
      ]);

      let output = '';
      let error = '';

      cmd.stdout.on('data', (data) => {
        output += data.toString();
      });

      cmd.stderr.on('data', (data) => {
        error += data.toString();
      });

      cmd.on('close', (code) => {
        const jobs = [];
        
        if (output.trim()) {
          const lines = output.trim().split('\n').filter(line => line.includes('|'));
          
          for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 2) {
              jobs.push({
                timestamp: parts[0] || 'Desconhecido',
                jobId: parts[1] || 'N/A',
                printer: parts[2] || 'Desconhecida',
                docName: parts[3] || 'Documento'
              });
            }
          }
        }
        
        this.logWindows(`POWERSHELL_EXECUTADO - Código: ${code} | Jobs encontrados: ${jobs.length}`);
        if (jobs.length > 0) {
          this.logWindows(`JOBS_REAIS_ENCONTRADOS - Primeiro: JobID ${jobs[0].jobId} | Impressora: ${jobs[0].printer}`);
        }
        
        resolve(jobs);
      });
    });
  }

  // Busca o Job ID mais recente para uma impressora específica
  async getLatestJobId(printerName) {
    try {
      const jobs = await this.getRecentPrintJobs();
      this.logWindows(`BUSCA_JOB_ID - Impressora: ${printerName} | Jobs encontrados: ${jobs.length}`);
      
      const job = jobs
        .filter(j => j.printer && j.printer.includes(printerName))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      
      if (job) {
        this.logWindows(`JOB_ID_ENCONTRADO - JobID: ${job.jobId} | Impressora: ${job.printer} | Documento: ${job.docName}`);
      }
      
      return job ? job.jobId : null;
    } catch (error) {
      this.logWindows(`ERRO_BUSCA_JOB_ID - ${error.message}`);
      log(`Erro ao buscar Job ID do Windows: ${error.message}`);
      return null;
    }
  }

  // Busca Job ID com timeout
  async waitForJobId(printerName, timeoutMs = 5000) {
    const startTime = Date.now();
    
    // Primeiro tenta capturar Job ID real do Windows
    while (Date.now() - startTime < timeoutMs) {
      const jobId = await this.getLatestJobId(printerName);
      if (jobId && !jobId.startsWith('SIM_')) {
        return jobId; // Retorna Job ID real se encontrado
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Se não encontrou Job ID real, gera um único e confiável
    this.jobCounter++;
    const uniqueJobId = `WIN_${this.jobCounter}`;
    this.logWindows(`JOB_ID_GERADO - JobID: ${uniqueJobId} | Impressora: ${printerName} | Motivo: Timeout aguardando Job ID do Windows`);
    
    return uniqueJobId;
  }
}

module.exports = new WindowsJobMonitor();
