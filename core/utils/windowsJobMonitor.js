// core/utils/windowsJobMonitor.js
const { spawn } = require('child_process');
const { log } = require('./logger');

class WindowsJobMonitor {
  constructor() {
    this.recentJobs = new Map(); // Armazena jobs recentes
    this.jobCounter = Date.now() % 1000; // Contador para Job IDs únicos
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
      let stderrData = '';

      cmd.stdout.on('data', (data) => {
        output += data.toString();
      });

      cmd.stderr.on('data', (data) => {
        stderrData += data.toString();
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
        
        log('POWERSHELL_EXECUTADO', {
          channel: 'windows',
          metadata: { codigo: code, jobs: jobs.length }
        });
        if (stderrData.trim()) {
          log('POWERSHELL_STDERR', {
            channel: 'windows',
            metadata: { saida: stderrData }
          });
        }
        if (jobs.length > 0) {
          log('JOBS_REAIS_ENCONTRADOS', {
            channel: 'windows',
            metadata: {
              jobId: jobs[0].jobId,
              impressora: jobs[0].printer
            }
          });
        }
        
        resolve(jobs);
      });
    });
  }

  // Busca o Job ID mais recente para uma impressora específica
  async getLatestJobId(printerName) {
    try {
      const jobs = await this.getRecentPrintJobs();
      log('BUSCA_JOB_ID', {
        channel: 'windows',
        metadata: { impressora: printerName, quantidade: jobs.length }
      });
      
      const job = jobs
        .filter(j => j.printer && j.printer.includes(printerName))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      
      if (job) {
        log('JOB_ID_ENCONTRADO', {
          channel: 'windows',
          metadata: { jobId: job.jobId, impressora: job.printer, documento: job.docName }
        });
      }
      
      return job ? job.jobId : null;
    } catch (error) {
      log('ERRO_BUSCA_JOB_ID', {
        channel: 'windows',
        metadata: { error }
      });
      log(`Erro ao buscar Job ID do Windows: ${error.message}`, {
        metadata: { area: 'windowsJobMonitor', error }
      });
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
    log('JOB_ID_GERADO', {
      channel: 'windows',
      metadata: { jobId: uniqueJobId, impressora: printerName, motivo: 'timeout' }
    });
    
    return uniqueJobId;
  }
}

module.exports = new WindowsJobMonitor();
