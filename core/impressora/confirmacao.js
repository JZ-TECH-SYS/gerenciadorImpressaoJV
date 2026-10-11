// core/impressora/confirmacao.js
// v4.1 — confirmação de impressão (contrato gerenciador ⇄ API ClickExpress):
// rastreia o trabalho na fila do Windows, devolve o resultado de cada entrega
// (idprint), manda heartbeat a cada 60 s e, sob comando, os logs sanitizados.
// v4.2 — a via que travou na fila do Windows fica vigiada até sair (tardio).
// v4.2.2 — PowerShell frio: a 1ª leitura de cada rastreio tem mais tempo e as
// leituras da abertura (heartbeat, adoção) também, o que já deixa o PowerShell quente.
// REGRA: nada aqui pode quebrar ou atrasar a impressão — toda chamada de rede
// tem timeout e todo erro só vira log.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const Store = require('electron-store');
const { info, warn } = require('../utils/printerLogger');
const { LOG_DIR, getLogDateKey } = require('../utils/logger');
const { version: VERSAO } = require('../../package.json');

const store = new Store();
const isWindows = os.platform() === 'win32';
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Nome da máquina: o MESMO valor vai no header do poll e nos POSTs (a API casa
 * a máquina pelos dois). Header HTTP só aceita ASCII — um caractere fora disso
 * derrubaria o poll inteiro —, então tira acento e troca o resto por '?'.
 */
function maquina() {
  return String(os.hostname() || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, 80);
}

/**
 * Chromium usa o <title> como nome do documento na fila do Windows. Vai no
 * começo do HTML; com <!DOCTYPE> vai logo depois dele (antes do doctype o
 * Chromium cairia em quirks mode e o layout do ticket poderia mudar).
 * O resto do HTML fica idêntico, byte a byte.
 */
function injetarTitulo(html, documento) {
  const tag = `<title>${documento}</title>`;
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html);
  const pos = doctype ? doctype[0].length : 0;
  return html.slice(0, pos) + tag + html.slice(pos);
}

// ── PowerShell (mesmo estilo do listarImpressoras) ─────────────────
// execFile sem shell: nada de aspas do cmd. Timeout mata o processo e a janela
// fica oculta (sem pisca-pisca de console a cada consulta).
const PS_PREFIXO = "$ProgressPreference = 'SilentlyContinue'; "
  + 'try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}; '
  + "$ErrorActionPreference = 'Stop'; ";

function runPowerShell(script, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    if (!isWindows) {
      reject(new Error('PowerShell indisponível fora do Windows'));
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_PREFIXO + script],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout)))
    );
  });
}

// Texto entre aspas simples do PowerShell (aspas simples, inclusive as
// tipográficas, viram duplas).
const psTexto = (s) => `'${String(s).replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`;

const scriptJobs = (impressora) => `Get-PrintJob -PrinterName ${psTexto(impressora)} `
  + "| Select-Object Id, DocumentName, @{n='JobStatus';e={[string]$_.JobStatus}} "
  + '| ConvertTo-Json -Compress';

const SCRIPT_IMPRESSORAS = 'Get-CimInstance Win32_Printer '
  + '| Select-Object Name, PrinterStatus, DetectedErrorState, WorkOffline, PortName, Default '
  + '| ConvertTo-Json -Compress';

// ConvertTo-Json devolve nada (lista vazia), um objeto (1 item) ou um array.
function listaJson(saida) {
  const texto = String(saida || '').replace(/^\uFEFF/, '').trim();
  if (!texto) return [];
  const dado = JSON.parse(texto);
  return Array.isArray(dado) ? dado : [dado];
}

// [string]$_.JobStatus vem com os nomes do enum [Flags] do PrintManagement
// ("Printing, Retained"); se vier o número, traduz para os mesmos nomes.
const JOB_STATUS_BITS = ['Paused', 'Error', 'Deleting', 'Spooling', 'Printing', 'Offline',
  'PaperOut', 'Printed', 'Deleted', 'Blocked', 'UserIntervention', 'Restarted', 'Complete',
  'Retained', 'RenderingLocally'];

function textoJobStatus(valor) {
  const s = String(valor ?? '').trim();
  if (!/^\d+$/.test(s)) return s;
  const nomes = JOB_STATUS_BITS.filter((_, i) => Number(s) & (1 << i));
  return nomes.length ? nomes.join(', ') : 'Normal';
}

/** Win32_Printer → status legível do contrato (§3). */
function statusImpressora(p = {}) {
  const st = Number(p.PrinterStatus);
  const det = Number(p.DetectedErrorState);
  if (p.WorkOffline === true || st === 7 || det === 9) return 'Offline';
  if (det === 4) return 'Sem papel';
  if (det === 7) return 'Tampa aberta';
  if ([6, 8, 10, 11].includes(det)) return 'Erro';
  if (st === 6) return 'Parada';
  if ([3, 4, 5].includes(st)) return 'Normal';
  return 'Desconhecido';
}

function impressoraHeartbeat(p) {
  const status = statusImpressora(p);
  return {
    nome: p.Name || '',
    status,
    offline: status === 'Offline',
    erro: ['Normal', 'Desconhecido'].includes(status) ? null : status,
    porta: p.PortName || null,
    padrao: p.Default === true,
  };
}

// ── Rastreio do trabalho na fila ───────────────────────────────────
// jv-1-1 não pode casar com jv-1-10
const casaDocumento = (documento) => new RegExp(`${String(documento).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`);
const ERRO_JOB = /Error|Offline|PaperOut|UserIntervention|Blocked/i;
// "Manter documentos impressos" deixa o trabalho na fila como Printed/Complete:
// isso é papel na mão, não "parado na fila".
const JOB_CONCLUIDO = /Printed|Complete/i;
const ERRO_IMPRESSORA = {
  Offline: 'impressora offline',
  'Sem papel': 'impressora sem papel',
  'Tampa aberta': 'impressora com a tampa aberta',
  Erro: 'impressora com erro',
  Parada: 'impressora parada',
};

/**
 * Decide o destino de UM trabalho que o webContents.print já entregou ao
 * Windows. Puro: PowerShell, espera e relógio são injetados (testável sem
 * Windows nem Electron). Nunca lança e nunca dá alarme falso: se não deu para
 * checar, é impresso/indisponivel.
 * @returns {Promise<{resultado, etapa, erro, confirmacao, visto_na_fila, job_status}>}
 */
async function rastrearJob({
  impressora, documento, runPs = runPowerShell, sleep = delay, agora = Date.now,
  limiteMs = 12000, intervaloMs = 1000, primeiraLeituraMs = 10000,
}) {
  // Depois de um tempo parado (PC recém-ligado) a 1ª consulta passa dos 4 s: cortada, virava
  // "impresso sem prova" com a via presa na fila (Di Tali e Vaqueiro, 11/10). Ela ganha mais
  // tempo, e o prazo de "parado na fila" conta de quando ela voltou.
  let inicio = null;
  let visto = false;
  let jobStatus = null;
  const fim = (resultado, extra) => ({
    resultado, etapa: null, erro: null, confirmacao: null, ...extra, visto_na_fila: visto, job_status: jobStatus,
  });
  try {
    const nome = casaDocumento(documento);
    for (;;) {
      const job = listaJson(await runPs(scriptJobs(impressora), inicio === null ? primeiraLeituraMs : undefined))
        .find((j) => nome.test(String(j.DocumentName || '')));
      if (inicio === null) inicio = agora();
      if (job) {
        visto = true;
        jobStatus = textoJobStatus(job.JobStatus);
        if (ERRO_JOB.test(jobStatus)) return fim('erro', { etapa: 'spooler', erro: jobStatus });
        if (JOB_CONCLUIDO.test(jobStatus)) return fim('impresso', { confirmacao: 'fila_windows' });
      } else if (visto) {
        return fim('impresso', { confirmacao: 'fila_windows' });
      } else {
        // Nunca visto: saiu antes da 1ª olhada (térmica é rápida) ou nem entrou.
        // Quem decide é o estado da impressora.
        const alvo = String(impressora).toLowerCase();
        const p = listaJson(await runPs(SCRIPT_IMPRESSORAS))
          .find((i) => String(i.Name || '').toLowerCase() === alvo);
        const status = p ? statusImpressora(p) : 'Desconhecido';
        if (ERRO_IMPRESSORA[status]) return fim('erro', { etapa: 'spooler', erro: ERRO_IMPRESSORA[status] });
        return fim('impresso', { confirmacao: status === 'Normal' ? 'status_impressora' : 'indisponivel' });
      }
      // Não cancela o trabalho: só avisa que está parado.
      if (agora() - inicio >= limiteMs) return fim('erro', { etapa: 'spooler', erro: 'parado na fila do Windows' });
      await sleep(intervaloMs);
    }
  } catch (_e) {
    return fim('impresso', { confirmacao: 'indisponivel' });
  }
}

// ── Resultado por idprint (contrato §2) ────────────────────────────
const FORCA = ['indisponivel', 'status_impressora', 'fila_windows'];

/** Junta as vias de uma entrega numa resposta só. */
function agregarResultados(detalhe) {
  const falhas = detalhe.filter((d) => d.resultado === 'erro');
  if (falhas.length) {
    return {
      status: 'erro',
      etapa: falhas.every((f) => f.etapa === 'antes_spooler') ? 'antes_spooler' : 'spooler',
      erro: String(falhas[0].erro || 'erro sem descrição').slice(0, 500),
      confirmacao: null,
      impressora: falhas[0].impressora || null,
    };
  }
  // Com várias vias vale a confirmação mais fraca.
  const confirmacao = FORCA[Math.min(...detalhe.map((d) => Math.max(0, FORCA.indexOf(d.confirmacao))))];
  return { status: 'impresso', etapa: null, erro: null, confirmacao, impressora: detalhe[0].impressora || null };
}

const ultimosErros = [];
/** Anel com os 5 últimos erros de impressão (vai no heartbeat). */
function registrarErro(erro, idprint = null) {
  ultimosErros.unshift({ em: new Date().toISOString(), erro: String(erro || '').slice(0, 500), idprint: idprint ?? null });
  ultimosErros.splice(5);
}

function configApi() {
  const apiUrl = store.get('apiUrl');
  const token = store.get('apiToken');
  const idempresa = Number(store.get('idempresa'));
  return apiUrl && token && idempresa ? { apiUrl, token, idempresa } : null;
}

async function postApi(rota, corpo, timeoutMs) {
  const cfg = configApi();
  if (!cfg) return null;
  return fetch(`${cfg.apiUrl}${rota}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ idempresa: cfg.idempresa, maquina: maquina(), versao: VERSAO, ...corpo }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

let pendentes = 0;
const enviosPendentes = () => pendentes;

/**
 * POST impressao/resultado sem segurar a próxima consulta: 5 s de timeout e no
 * máximo 1 nova tentativa (só para rede/5xx). Nunca lança.
 */
async function enviarResultado(idprint, detalhe) {
  pendentes += 1;
  try {
    const corpo = { idprint, ...agregarResultados(detalhe), detalhe };
    let falha = null;
    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      if (tentativa > 1) await delay(2000);
      try {
        const res = await postApi('impressao/resultado', corpo, 5000);
        if (!res) return;
        if (res.ok || res.status === 400) {
          // 400 = a comanda não está mais "entregue": nada a fazer.
          info('Resultado da impressão enviado', { metadata: { idprint, status: corpo.status, http: res.status } });
          return;
        }
        if (res.status < 500) {
          warn('API recusou o resultado da impressão', { metadata: { idprint, http: res.status } });
          return;
        }
        falha = `HTTP ${res.status}`;
      } catch (e) {
        falha = e?.message || String(e);
      }
    }
    warn('Não foi possível enviar o resultado da impressão', { metadata: { idprint, status: corpo.status, error: falha } });
  } catch (e) {
    warn('Erro ao montar o resultado da impressão', { metadata: { idprint, error: e?.message || String(e) } });
  } finally {
    pendentes -= 1;
  }
}

// ── Heartbeat (contrato §3) ────────────────────────────────────────
let heartbeatTimer = null;
let heartbeatOk = true;

async function enviarHeartbeat() {
  try {
    if (!configApi()) return;
    let impressoras = [];
    try {
      // 20 s: o 1º heartbeat sai na abertura, com o PowerShell frio (em 4 s o painel ficava
      // "sem impressoras"); não segura nada, a impressão não espera por ele.
      impressoras = listaJson(await runPowerShell(SCRIPT_IMPRESSORAS, 20000)).map(impressoraHeartbeat);
    } catch (_e) { impressoras = []; }
    const res = await postApi('impressao/heartbeat', {
      so: process.platform,
      impressora_padrao: store.get('printer') || null,
      papel_mm: Number(store.get('printer_paper_mm')) || null,
      pausada: store.get('impressao_pausadaPeloUsuario') === true,
      impressoras,
      ultimos_erros: ultimosErros,
      vias_travadas: viasTravadas(),
    }, 5000);
    if (res && !res.ok) throw new Error(`HTTP ${res.status}`);
    if (!heartbeatOk) info('Heartbeat da impressão voltou a responder');
    heartbeatOk = true;
  } catch (e) {
    // Só loga a troca ok → falha (API fora não enche o log a cada minuto).
    if (heartbeatOk) warn('Falha no heartbeat da impressão', { metadata: { error: e?.message || String(e) } });
    heartbeatOk = false;
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  enviarHeartbeat();
  heartbeatTimer = setInterval(enviarHeartbeat, 60 * 1000);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// ── v4.2: impresso tardio (a via travada sai depois) ───────────────
// Erro "spooler" não cancela nada: a via fica na fila do Windows e sai sozinha
// quando a impressora volta — e a API ficaria com "erro" para sempre (ensaio de
// 11/10: a 118987 travou com a MPT-II desligada e imprimiu ao religar). Cada via
// travada fica vigiada, persistida no store (sobrevive a reinício e atualização),
// até sair da fila:
//   sumiu com a impressora pronta            → impresso (tardio)
//   sumiu com a impressora parada, ou vista
//   "Deleting"                                → tirada da fila sem imprimir
// Um passo a cada 5 s, só enquanto houver via vigiada; desiste depois de 24 h.
const CHAVE_TARDIOS = 'impressao_tardios';
const TARDIO_INTERVALO_MS = 5000;
// Via em movimento na impressora (imprimindo, sendo apagada) muda a qualquer momento:
// olha mais vezes. Na MPT-II sem papel o "Deleting" do cancelamento durou 5,8 s.
const TARDIO_RAPIDO_MS = 1500;
const JOB_ATIVO = /Printing|Deleting|Spooling/i;
const TARDIO_VALIDADE_MS = 24 * 60 * 60 * 1000;
const JOB_SAINDO = /Deleting|Deleted/i;

const listaTardios = () => {
  const lista = store.get(CHAVE_TARDIOS);
  return Array.isArray(lista) ? lista : [];
};

/**
 * Destino das vias vigiadas a partir de uma leitura das filas. Puro.
 * @param {Array} lista [{ idprint, desde, vias: [{ impressora, documento, ultimo, saiu_em, removida }] }]
 * @param {Map} leituras impressora → { jobs, status }; impressora sem leitura = sem decisão nesta volta
 * @returns {{ lista: Array, envios: Array<{ idprint, status, impressora, saiu_em }> }}
 *   envios se repetem a cada volta até a API responder (quem chama tira da lista)
 */
function decidirTardios(lista, leituras, agora) {
  const envios = [];
  const fica = [];
  for (const t of lista) {
    if (agora - t.desde > TARDIO_VALIDADE_MS) continue; // desiste: segue erro na tela
    const vias = t.vias.map((v) => {
      if (v.saiu_em) return v;
      const leitura = leituras.get(v.impressora);
      if (!leitura) return v;
      const job = leitura.jobs.find((j) => casaDocumento(v.documento).test(String(j.DocumentName || '')));
      if (job) {
        const st = textoJobStatus(job.JobStatus);
        const visto = {
          ...v,
          ultimo: st,
          job_id: Number(job.Id) || v.job_id || null,
          paginas: Number(job.TotalPages) ? `${Number(job.PagesPrinted) || 0}/${Number(job.TotalPages)}` : (v.paginas || null),
        };
        // "manter documentos impressos": fica na fila como Printed/Complete = papel
        return JOB_CONCLUIDO.test(st) ? { ...visto, saiu_em: agora } : visto;
      }
      // Sumiu da fila. Não foi papel se: estava sendo apagada; a impressora está
      // parada (o Windows sabe); ou uma via anterior segue na fila — a fila imprime em
      // ordem, então esta foi cancelada (sem papel a MPT-II diz "sem erro" e a via da
      // frente fica em "Printing": a de trás só sai da fila se alguém tirar).
      const naFrente = v.job_id != null && leitura.jobs.some((j) => Number(j.Id) < v.job_id
        && !JOB_CONCLUIDO.test(textoJobStatus(j.JobStatus)));
      const removida = JOB_SAINDO.test(v.ultimo || '') || Boolean(ERRO_IMPRESSORA[leitura.status]) || naFrente;
      return { ...v, saiu_em: agora, removida };
    });
    fica.push({ ...t, vias });
    if (vias.every((v) => v.saiu_em)) {
      const removida = vias.find((v) => v.removida);
      envios.push({
        idprint: t.idprint,
        status: removida ? 'erro' : 'impresso',
        impressora: (removida || vias[0]).impressora || null,
        saiu_em: Math.max(...vias.map((v) => v.saiu_em)),
      });
    }
  }
  return { lista: fica, envios };
}

// Uma chamada ao PowerShell por volta: a fila de cada impressora vigiada + o estado de
// todas. Impressora que não responde fica fora de `filas` (sem decisão nesta volta).
const scriptLeitura = (impressoras) => '$f = @{}; '
  + `foreach ($n in @(${impressoras.map(psTexto).join(', ')})) { `
  + "try { $f[$n] = @(Get-PrintJob -PrinterName $n | Select-Object Id, DocumentName, "
  + "@{n='JobStatus';e={[string]$_.JobStatus}}, PagesPrinted, TotalPages) } catch { } }; "
  + '@{ impressoras = @(Get-CimInstance Win32_Printer '
  + '| Select-Object Name, PrinterStatus, DetectedErrorState, WorkOffline); filas = $f } '
  + '| ConvertTo-Json -Compress -Depth 4';

const comoLista = (v) => {
  if (Array.isArray(v)) return v;
  return v ? [v] : [];
};

/** Fila de cada impressora + estado dela (o estado decide entre papel e "tirada da fila"). */
async function lerFilas(impressoras, runPs = runPowerShell) {
  const leituras = new Map();
  let dado;
  try {
    dado = JSON.parse(String(await runPs(scriptLeitura(impressoras))).replace(/^\uFEFF/, '').trim() || '{}');
  } catch (_e) {
    return leituras; // PowerShell falhou: sem decisão nesta volta
  }
  const estados = new Map(comoLista(dado.impressoras).map((p) => [String(p.Name || '').toLowerCase(), statusImpressora(p)]));
  impressoras.forEach((impressora) => {
    const filas = dado.filas || {};
    if (!Object.prototype.hasOwnProperty.call(filas, impressora)) return;
    leituras.set(impressora, {
      jobs: comoLista(filas[impressora]),
      status: estados.get(String(impressora).toLowerCase()) || 'Desconhecido',
    });
  });
  return leituras;
}

/** Próxima volta: mais cedo se alguma via está em movimento na impressora. */
const intervaloTardios = (lista) => (lista.some((t) => t.vias.some((v) => !v.saiu_em && JOB_ATIVO.test(v.ultimo || '')))
  ? TARDIO_RAPIDO_MS
  : TARDIO_INTERVALO_MS);

/** Vias ainda travadas, para o heartbeat (a tela mostra o que o Windows diz delas). */
const viasTravadas = () => listaTardios().flatMap((t) => t.vias.filter((v) => !v.saiu_em).map((v) => ({
  idprint: t.idprint,
  impressora: v.impressora,
  status: v.ultimo || null,
  paginas: v.paginas || null,
  desde: new Date(t.desde).toISOString(),
}))).slice(0, 20);

/** POST do aviso tardio. true = a API decidiu (aceitou ou recusou): sai da vigia. */
async function enviarTardio(e) {
  try {
    const res = await postApi('impressao/resultado', {
      idprint: e.idprint,
      status: e.status,
      tardio: true,
      impressora: e.impressora,
      atraso_ms: Math.max(0, Date.now() - e.saiu_em), // a API grava a hora em que a via saiu
      ...(e.status === 'impresso'
        ? { confirmacao: 'fila_windows' }
        : { etapa: 'removido', erro: 'tirada da fila do Windows sem imprimir' }),
    }, 5000);
    if (!res || res.status >= 500) return false;
    info(res.ok ? 'Via travada saiu da fila do Windows: API avisada' : 'API recusou o aviso da via travada', {
      metadata: { idprint: e.idprint, status: e.status, http: res.status },
    });
    return true;
  } catch (_e) {
    return false; // rede: tenta de novo na próxima volta
  }
}

let tardioTimer = null;
let tardioRodando = false;

function agendarTardios(ms = TARDIO_INTERVALO_MS) {
  if (tardioTimer || !listaTardios().length) return;
  tardioTimer = setTimeout(() => {
    tardioTimer = null;
    passoTardios();
  }, ms);
  tardioTimer.unref?.(); // não segura o processo sozinho (no Electron o app já segura)
}

async function passoTardios({ runPs = runPowerShell } = {}) {
  if (tardioRodando) return;
  tardioRodando = true;
  try {
    const lista = listaTardios();
    if (!lista.length) return;
    const impressoras = [...new Set(lista.flatMap((t) => t.vias.filter((v) => !v.saiu_em).map((v) => v.impressora)))];
    const leituras = impressoras.length ? await lerFilas(impressoras, runPs) : new Map();
    const { lista: nova, envios } = decidirTardios(lista, leituras, Date.now());
    const resolvidas = new Set();
    for (const e of envios) {
      if (await enviarTardio(e)) resolvidas.add(e.idprint);
    }
    // via travada que entrou enquanto esta volta lia as filas não se perde
    const atual = listaTardios();
    const antes = new Set(lista.map((t) => t.idprint));
    const final = [...nova.filter((t) => !resolvidas.has(t.idprint)), ...atual.filter((t) => !antes.has(t.idprint))];
    // só grava o que mudou (com via imprimindo a volta é a cada 1,5 s)
    if (JSON.stringify(final) !== JSON.stringify(atual)) store.set(CHAVE_TARDIOS, final);
  } catch (e) {
    warn('Falha ao vigiar via travada na fila do Windows', { metadata: { error: e?.message || String(e) } });
  } finally {
    tardioRodando = false;
    agendarTardios(intervaloTardios(listaTardios()));
  }
}

/**
 * Entrega com via travada na fila do Windows (erro "spooler"): guarda as vias para
 * vigiar a saída. Só quando todas foram vistas na fila — via que nunca apareceu
 * não tem como ser vigiada. Nunca lança.
 */
function vigiarTardio(idprint, detalhe) {
  try {
    const travadas = detalhe.filter((d) => d.resultado === 'erro' && d.etapa === 'spooler');
    if (!travadas.length || !travadas.every((d) => d.visto_na_fila && d.documento && d.impressora)) return;
    const lista = listaTardios().filter((t) => t.idprint !== idprint);
    lista.push({
      idprint,
      desde: Date.now(),
      vias: travadas.map((d) => ({
        impressora: d.impressora, documento: d.documento, ultimo: d.job_status || null, saiu_em: null, removida: false,
      })),
    });
    store.set(CHAVE_TARDIOS, lista.slice(-200));
    info('Via travada na fila do Windows: vigiando até sair', { metadata: { idprint, vias: travadas.length } });
    agendarTardios();
  } catch (e) {
    warn('Falha ao guardar via travada', { metadata: { idprint, error: e?.message || String(e) } });
  }
}

const SCRIPT_TODAS_AS_FILAS = 'Get-Printer | ForEach-Object { Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue } '
  + "| Where-Object { $_.DocumentName -like 'jv-*' } "
  + "| Select-Object PrinterName, DocumentName, @{n='JobStatus';e={[string]$_.JobStatus}} "
  + '| ConvertTo-Json -Compress';

/**
 * Vias jv-* que já estavam na fila quando o gerenciador abriu (versão anterior, que
 * não vigiava, ou app fechado no meio do rastreio) entram na vigia. A API só aceita
 * o aviso de comanda com erro, entregue ou impressa sem prova; as outras ela recusa e
 * saem da lista. 30 s: roda na abertura, com o PC às vezes recém-ligado.
 */
async function adotarTravadas(runPs = runPowerShell, agora = Date.now()) {
  const vigiadas = new Set(listaTardios().map((t) => t.idprint));
  const novas = new Map();
  for (const j of listaJson(await runPs(SCRIPT_TODAS_AS_FILAS, 30000))) {
    const m = /^jv-(\d+)-\d+/.exec(String(j.DocumentName || ''));
    const st = textoJobStatus(j.JobStatus);
    if (!m || !j.PrinterName || JOB_CONCLUIDO.test(st) || vigiadas.has(Number(m[1]))) continue;
    const t = novas.get(m[1]) || { idprint: Number(m[1]), desde: agora, adotada: true, vias: [] };
    t.vias.push({ impressora: j.PrinterName, documento: m[0], ultimo: st, saiu_em: null, removida: false });
    novas.set(m[1], t);
  }
  if (novas.size) {
    store.set(CHAVE_TARDIOS, [...listaTardios(), ...novas.values()].slice(-200));
    info('Vias jv-* já paradas na fila do Windows: vigiando até sair', { metadata: { idprints: [...novas.keys()] } });
  }
  return novas.size;
}

function startVigiaTardia() {
  if (!isWindows) return;
  adotarTravadas()
    .catch((e) => warn('Falha ao ler as filas do Windows na abertura', { metadata: { error: e?.message || String(e) } }))
    .finally(() => agendarTardios(TARDIO_INTERVALO_MS));
}

function stopVigiaTardia() {
  clearTimeout(tardioTimer);
  tardioTimer = null;
}

// ── Logs sob comando (contrato §4) ─────────────────────────────────
const CHAVE_PROIBIDA = /^conteudo|^preview|token|senha|password|secret|api_?key|authorization/i;

function limparChaves(valor) {
  if (Array.isArray(valor)) return valor.map(limparChaves);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(Object.entries(valor)
    .filter(([k]) => !CHAVE_PROIBIDA.test(k))
    .map(([k, v]) => [k, limparChaves(v)]));
}

/** Uma linha de log → linha segura para sair da máquina, ou null (descarta). */
function sanitizarLinha(linha) {
  // filtro barato antes do JSON.parse: o log de ontem pode ter milhares de debug
  if (!linha.trim() || linha.includes('"level":"debug"')) return null;
  try {
    const obj = JSON.parse(linha);
    if (!obj || typeof obj !== 'object' || obj.level === 'debug') return null;
    return JSON.stringify(limparChaves(obj));
  } catch (_e) {
    return null; // linha que não dá para sanitizar não sai
  }
}

async function lerFim(arquivo, maxBytes) {
  const fh = await fs.promises.open(arquivo, 'r');
  try {
    const { size } = await fh.stat();
    const inicio = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - inicio);
    await fh.read(buf, 0, buf.length, inicio);
    const texto = buf.toString('utf8');
    return inicio > 0 ? texto.slice(texto.indexOf('\n') + 1) : texto; // 1ª linha veio cortada
  } finally {
    await fh.close();
  }
}

/**
 * Logs de impressão de hoje e ontem (atuais e girados) + fim do crash.log,
 * sanitizados, do mais novo para o mais antigo, até `limiteBytes`. Lê arquivo a
 * arquivo, assíncrono, para não travar o processo principal (onde a impressão
 * roda).
 */
async function montarLogs({ dir = LOG_DIR, agora = new Date(), limiteBytes = 300 * 1024 } = {}) {
  const dias = [getLogDateKey(agora), getLogDateKey(new Date(agora.getTime() - 24 * 60 * 60 * 1000))];
  const padrao = new RegExp(`^(${dias.join('|')})-log-impressora\\.jsonl(\\.\\d+)?$`);
  const arquivos = [];
  for (const nome of await fs.promises.readdir(dir).catch(() => [])) {
    if (nome !== 'crash.log' && !padrao.test(nome)) continue;
    try {
      arquivos.push({ nome, mtime: (await fs.promises.stat(path.join(dir, nome))).mtimeMs });
    } catch (_e) { /* sumiu no meio */ }
  }
  arquivos.sort((a, b) => b.mtime - a.mtime); // mais novo primeiro (girado = conteúdo mais antigo)

  let saida = '';
  let bytes = 0;
  for (const { nome } of arquivos) {
    const arquivo = path.join(dir, nome);
    const texto = await (nome === 'crash.log' ? lerFim(arquivo, 100 * 1024) : fs.promises.readFile(arquivo, 'utf8'))
      .catch(() => '');
    const linhas = texto.split(/\r?\n/).map(sanitizarLinha).filter(Boolean).reverse();
    if (!linhas.length) continue;
    for (const linha of [`# ${nome}`, ...linhas]) {
      const tamanho = Buffer.byteLength(linha) + 1;
      if (bytes + tamanho > limiteBytes) return saida;
      saida += `${linha}\n`;
      bytes += tamanho;
    }
  }
  return saida;
}

let ultimoEnvioLogs = 0;

/** cmd 'enviar_logs' do poll: no máximo 1 envio por minuto, sem bloquear nada. */
function enviarLogs() {
  if (Date.now() - ultimoEnvioLogs < 60 * 1000) return;
  ultimoEnvioLogs = Date.now();
  (async () => {
    const conteudo = await montarLogs();
    const res = await postApi('impressao/logs', { conteudo }, 15000);
    info('Logs da impressão enviados sob comando', {
      metadata: { http: res ? res.status : null, bytes: Buffer.byteLength(conteudo) },
    });
  })().catch((e) => warn('Falha ao enviar logs da impressão', { metadata: { error: e?.message || String(e) } }));
}

module.exports = {
  VERSAO,
  maquina,
  injetarTitulo,
  rastrearJob,
  statusImpressora,
  agregarResultados,
  registrarErro,
  enviarResultado,
  enviosPendentes,
  startHeartbeat,
  stopHeartbeat,
  sanitizarLinha,
  montarLogs,
  enviarLogs,
  decidirTardios,
  lerFilas,
  intervaloTardios,
  viasTravadas,
  vigiarTardio,
  adotarTravadas,
  passoTardios,
  startVigiaTardia,
  stopVigiaTardia,
};
