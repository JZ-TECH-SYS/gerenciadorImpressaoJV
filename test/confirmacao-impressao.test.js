// Confirmação de impressão (v4.1) — Node puro, sem Electron nem Windows:
//   npm test   (node --test test/*.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// O logger grava em os.tmpdir(): isola tudo num diretório descartável.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-printer-test-'));
process.env.TMPDIR = TMP;
process.env.TMP = TMP;
process.env.TEMP = TMP;
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

// electron / electron-store só existem dentro do Electron: troca por dublês.
const storeData = { apiToken: 'tok', apiUrl: 'https://api.test/', idempresa: '3' };
const stub = (nome, exports) => {
  const arquivo = require.resolve(nome);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};
stub('electron', {});
stub('electron-store', class { get(k) { return storeData[k]; } set(k, v) { storeData[k] = v; } });

const confirmacao = require('../core/impressora/confirmacao');
const consultarTickets = require('../core/api/consultarTickets');
const { getLogDateKey } = require('../core/utils/logger');
const { version } = require('../package.json');

const fetchOriginal = global.fetch;
test.afterEach(() => { global.fetch = fetchOriginal; });

// ── título ─────────────────────────────────────────────────────────
test('injetarTitulo: fragmento ganha o <title> no começo e o resto fica idêntico', () => {
  const html = '<style>.wrap{font-size:12px}</style><div class="wrap">Pedido de JOÃO\r\n</div>';
  const tag = '<title>jv-118924-1</title>';
  const out = confirmacao.injetarTitulo(html, 'jv-118924-1');
  assert.ok(out.startsWith(tag));
  assert.equal(out.slice(tag.length), html);
});

test('injetarTitulo: HTML completo mantém o doctype na frente (sem quirks mode)', () => {
  const html = '<!DOCTYPE html>\n<html lang="pt-br"><head><meta charset="utf-8"><title>Antigo</title></head><body>á</body></html>';
  const tag = '<title>jv-7-2</title>';
  const out = confirmacao.injetarTitulo(html, 'jv-7-2');
  assert.ok(out.startsWith(`<!DOCTYPE html>${tag}`));
  assert.equal(out.replace(tag, ''), html);
  assert.ok(out.indexOf(tag) < out.indexOf('<title>Antigo')); // o 1º <title> é o que vale
  const semDoctype = '<html><body>x</body></html>';
  assert.equal(confirmacao.injetarTitulo(semDoctype, 'jv-7-2'), tag + semDoctype);
});

// ── rastreio da fila ───────────────────────────────────────────────
// PowerShell falso: Get-PrintJob responde a sequência `filas` (a última se
// repete) e Win32_Printer responde `impressoras`, no formato do ConvertTo-Json
// (nada com 0 itens, objeto solto com 1). Relógio falso: cada chamada "custa"
// 300 ms e o sleep só avança o relógio.
function cenario({ filas = [[]], impressoras = [], falhar = false } = {}) {
  let agora = 0;
  let consulta = 0;
  const scripts = [];
  const json = (lista) => (lista.length ? JSON.stringify(lista.length === 1 ? lista[0] : lista) : '');
  const runPs = async (script) => {
    scripts.push(script);
    agora += 300;
    if (falhar) throw new Error('powershell.exe não encontrado');
    if (script.includes('Win32_Printer')) return json(impressoras);
    const fila = filas[Math.min(consulta, filas.length - 1)];
    consulta += 1;
    return json(fila);
  };
  const rastrear = (extra = {}) => confirmacao.rastrearJob({
    impressora: 'EPSON TM-T20',
    documento: 'jv-118924-1',
    runPs,
    sleep: async (ms) => { agora += ms; },
    agora: () => agora,
    ...extra,
  });
  return { rastrear, scripts, tempo: () => agora };
}
const job = (DocumentName, JobStatus) => ({ Id: 7, DocumentName, JobStatus });
const pronta = { Name: 'EPSON TM-T20', PrinterStatus: 3, DetectedErrorState: 2, WorkOffline: false };

test('rastrearJob: visto na fila e depois sumiu → impresso/fila_windows', async () => {
  const c = cenario({ filas: [[job('jv-118924-1', 'Spooling, Printing')], [job('jv-118924-1', 'Printing')], []] });
  assert.deepEqual(await c.rastrear(), {
    resultado: 'impresso', etapa: null, erro: null, confirmacao: 'fila_windows', visto_na_fila: true, job_status: 'Printing',
  });
  assert.ok(c.scripts[0].includes("Get-PrintJob -PrinterName 'EPSON TM-T20'"));
});

test('rastrearJob: status de erro na fila → erro/spooler com o JobStatus', async () => {
  const r = await cenario({ filas: [[job('jv-118924-1', 'Error, Printing')]] }).rastrear();
  assert.deepEqual(r, {
    resultado: 'erro', etapa: 'spooler', erro: 'Error, Printing', confirmacao: null, visto_na_fila: true, job_status: 'Error, Printing',
  });
  // JobStatus numérico (bit flags) também é entendido
  assert.equal((await cenario({ filas: [[job('jv-118924-1', 64)]] }).rastrear()).erro, 'PaperOut');
  // "Manter documentos impressos": Printed na fila é impresso, não parado
  assert.equal((await cenario({ filas: [[job('jv-118924-1', '128')]] }).rastrear()).confirmacao, 'fila_windows');
});

test('rastrearJob: nunca visto + impressora offline → erro/spooler', async () => {
  const c = cenario({
    filas: [[job('jv-118924-10', 'Printing'), job('Microsoft Word - doc', 'Printing')]], // jv-118924-10 não é a via 1
    impressoras: [{ ...pronta, Name: 'Outra', WorkOffline: false }, { ...pronta, WorkOffline: true }],
  });
  assert.deepEqual(await c.rastrear(), {
    resultado: 'erro', etapa: 'spooler', erro: 'impressora offline', confirmacao: null, visto_na_fila: false, job_status: null,
  });
  const semPapel = await cenario({ impressoras: [{ ...pronta, DetectedErrorState: 4 }] }).rastrear();
  assert.equal(semPapel.erro, 'impressora sem papel');
});

test('rastrearJob: nunca visto + impressora pronta → impresso/status_impressora', async () => {
  const r = await cenario({ impressoras: [{ ...pronta, Name: 'epson tm-t20' }] }).rastrear();
  assert.deepEqual(r, {
    resultado: 'impresso', etapa: null, erro: null, confirmacao: 'status_impressora', visto_na_fila: false, job_status: null,
  });
  // impressora que não aparece no Win32_Printer: não dá para afirmar nada
  assert.equal((await cenario({ impressoras: [] }).rastrear()).confirmacao, 'indisponivel');
  // aspas no nome da impressora não quebram o script
  const c = cenario({ impressoras: [{ ...pronta, Name: "Caixa d'Água" }] });
  assert.equal((await c.rastrear({ impressora: "Caixa d'Água" })).confirmacao, 'status_impressora');
  assert.ok(c.scripts[0].includes("-PrinterName 'Caixa d''Água'"));
});

test('rastrearJob: parado na fila por 12 s → erro/spooler, sem cancelar o trabalho', async () => {
  const c = cenario({ filas: [[job('jv-118924-1', 'Spooling')]] });
  assert.deepEqual(await c.rastrear(), {
    resultado: 'erro', etapa: 'spooler', erro: 'parado na fila do Windows', confirmacao: null, visto_na_fila: true, job_status: 'Spooling',
  });
  assert.ok(c.tempo() >= 12000 && c.tempo() < 14000);
  assert.ok(c.scripts.every((s) => s.includes('Get-PrintJob') && !/Remove-PrintJob|Suspend|Restart/i.test(s)));
});

test('rastrearJob: PowerShell indisponível/falhando → impresso/indisponivel (nunca alarme falso)', async () => {
  assert.deepEqual(await cenario({ falhar: true }).rastrear(), {
    resultado: 'impresso', etapa: null, erro: null, confirmacao: 'indisponivel', visto_na_fila: false, job_status: null,
  });
  const lixo = await confirmacao.rastrearJob({
    impressora: 'X', documento: 'jv-1-1', runPs: async () => 'Get-PrintJob : acesso negado', sleep: async () => {},
  });
  assert.equal(lixo.confirmacao, 'indisponivel');
});

// ── agregação por idprint ──────────────────────────────────────────
test('agregarResultados: com várias vias vale a confirmação mais fraca', () => {
  const via = (c) => ({ impressora: 'A', resultado: 'impresso', confirmacao: c });
  assert.deepEqual(confirmacao.agregarResultados([via('fila_windows'), via('status_impressora')]), {
    status: 'impresso', etapa: null, erro: null, confirmacao: 'status_impressora', impressora: 'A',
  });
  assert.equal(confirmacao.agregarResultados([via('fila_windows'), via('indisponivel'), via('status_impressora')]).confirmacao, 'indisponivel');
  assert.equal(confirmacao.agregarResultados([via('fila_windows')]).confirmacao, 'fila_windows');
});

test('agregarResultados: qualquer erro ⇒ erro; antes_spooler só se TODAS as falhas foram antes', () => {
  const ok = { impressora: 'A', resultado: 'impresso', confirmacao: 'fila_windows' };
  const antes = { impressora: 'B', resultado: 'erro', etapa: 'antes_spooler', erro: 'nenhuma impressora definida para este ticket' };
  const spooler = { impressora: 'C', resultado: 'erro', etapa: 'spooler', erro: 'x'.repeat(900) };
  assert.deepEqual(confirmacao.agregarResultados([ok, antes]), {
    status: 'erro', etapa: 'antes_spooler', erro: antes.erro, confirmacao: null, impressora: 'B',
  });
  const misto = confirmacao.agregarResultados([spooler, ok, antes]);
  assert.equal(misto.etapa, 'spooler');
  assert.equal(misto.erro, 'x'.repeat(500)); // texto da 1ª falha, até 500
  assert.equal(misto.impressora, 'C');
});

// ── logs sob comando ───────────────────────────────────────────────
test('sanitizarLinha: tira debug e chaves proibidas em qualquer nível', () => {
  assert.equal(confirmacao.sanitizarLinha('{"level":"debug","message":"x"}'), null);
  assert.equal(confirmacao.sanitizarLinha('não é json'), null);
  assert.equal(
    confirmacao.sanitizarLinha(JSON.stringify({ level: 'info', metadata: { lista: [{ senha: '1', x: 2 }], api_key: 'k', preview: 'p' } })),
    '{"level":"info","metadata":{"lista":[{"x":2}]}}'
  );
});

test('montarLogs: hoje/ontem + crash.log, sanitizado, mais novo primeiro, dentro do teto', async () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'logs-'));
  const agora = new Date('2026-10-11T15:00:00Z');
  const hoje = getLogDateKey(agora);
  const ontem = getLogDateKey(new Date(agora.getTime() - 24 * 60 * 60 * 1000));
  const linha = (level, message, metadata = {}) => JSON.stringify({
    timestamp: '2026-10-11T12:00:00.000Z', level, message, channel: 'printer', metadata,
  });
  const escrever = (nome, linhas, mtime) => {
    const arquivo = path.join(dir, nome);
    fs.writeFileSync(arquivo, `${linhas.join('\n')}\n`);
    fs.utimesSync(arquivo, mtime, mtime);
  };
  escrever(`${ontem}-log-impressora.jsonl`, [linha('info', 'ontem-1'), linha('info', 'ontem-2')], 1000);
  escrever(`${hoje}-log-impressora.jsonl.1760000000000`, [linha('info', 'hoje-girado')], 2000);
  escrever('crash.log', [JSON.stringify({ timestamp: '2026-10-11T12:00:00.000Z', level: 'PRINT_ATTEMPT', impressora: 'EPSON' })], 3000);
  escrever(`${hoje}-log-impressora.jsonl`, [
    linha('info', 'hoje-1', { conteudo: '<div>Cliente JOÃO</div>', impressora: 'EPSON' }),
    linha('debug', 'Tickets consultados', { quantidade: 0 }),
    linha('warn', 'hoje-2', {
      previewPrimeiros200chars: '<div>', conteudoOriginal: '<style>',
      body: { apiToken: 's3cr3t', headers: { Authorization: 'Bearer x' }, ok: 1 },
    }),
    '{"linha quebrada',
  ], 4000);
  // fora do envio, mesmo sendo os mais recentes
  escrever('2026-10-08-log-impressora.jsonl', [linha('info', 'velho')], 5000);
  escrever(`${hoje}-log-myzap.jsonl`, [linha('info', 'myzap')], 6000);
  escrever('config.json', ['{"level":"info","message":"config"}'], 7000);

  const texto = await confirmacao.montarLogs({ dir, agora });
  const ordem = texto.trim().split('\n').map((l) => (l.startsWith('#') ? l : (JSON.parse(l).message || JSON.parse(l).level)));
  assert.deepEqual(ordem, [
    `# ${hoje}-log-impressora.jsonl`, 'hoje-2', 'hoje-1',
    '# crash.log', 'PRINT_ATTEMPT',
    `# ${hoje}-log-impressora.jsonl.1760000000000`, 'hoje-girado',
    `# ${ontem}-log-impressora.jsonl`, 'ontem-2', 'ontem-1',
  ]);
  assert.doesNotMatch(texto, /debug|JOÃO|s3cr3t|Bearer|conteudo|preview|apiToken|Authorization|velho|myzap|config/i);
  assert.match(texto, /"body":\{"headers":\{\},"ok":1\}/); // o resto do objeto continua

  const curto = await confirmacao.montarLogs({ dir, agora, limiteBytes: 200 });
  assert.ok(Buffer.byteLength(curto) <= 200);
  assert.deepEqual(curto.trim().split('\n').map((l) => (l.startsWith('#') ? l : JSON.parse(l).message)), [
    `# ${hoje}-log-impressora.jsonl`, 'hoje-2',
  ]);
});

// ── poll e POSTs ───────────────────────────────────────────────────
function mockFetch(resposta) {
  const chamadas = [];
  global.fetch = async (url, opts) => {
    chamadas.push({ url, opts });
    const { body = {}, status = 200 } = typeof resposta === 'function' ? resposta() : resposta;
    return { ok: status < 400, status, json: async () => body };
  };
  return chamadas;
}
const VAZIO = { tickets: [], idprint: null, confirmar: false, cmd: null };

test('consultarTickets: manda os headers novos e lê idprint/confirmar/cmd', async () => {
  const ticket = { texto: '<div>1</div>', impressora: null };
  const chamadas = mockFetch({ body: { result: { texto: [ticket], idprint: 118924, confirmar: true, cmd: 'enviar_logs' }, error: false } });
  assert.deepEqual(await consultarTickets(), { tickets: [ticket], idprint: 118924, confirmar: true, cmd: 'enviar_logs' });
  const { url, opts } = chamadas[0];
  assert.equal(url, 'https://api.test/cronImpressaoDiretav3/3');
  assert.equal(opts.headers.Authorization, 'Bearer tok');
  assert.equal(opts.headers['X-JV-Confirma'], '1');
  assert.equal(opts.headers['X-JV-Versao'], version);
  assert.equal(opts.headers['X-JV-Maquina'], confirmacao.maquina());
});

test('consultarTickets: resposta antiga (sem as chaves novas) continua funcionando', async () => {
  mockFetch({ body: { result: { texto: ['<div>velho</div>'] }, error: false } });
  assert.deepEqual(await consultarTickets(), { ...VAZIO, tickets: ['<div>velho</div>'] });
  mockFetch({ body: { result: { texto: false, cmd: 'enviar_logs' }, error: false } });
  assert.deepEqual(await consultarTickets(), { ...VAZIO, cmd: 'enviar_logs' });
  mockFetch({ body: { result: '', error: 'token inválido' }, status: 401 });
  assert.deepEqual(await consultarTickets(), VAZIO);
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  assert.deepEqual(await consultarTickets(), VAZIO);
});

test('maquina: header só com ASCII e até 80 caracteres', (t) => {
  const hostname = os.hostname;
  t.after(() => { os.hostname = hostname; });
  os.hostname = () => `CAIXA-JOÃO-😀-${'x'.repeat(100)}`;
  const m = confirmacao.maquina();
  assert.match(m, /^[\x20-\x7E]{80}$/);
  assert.ok(m.startsWith('CAIXA-JOAO-??-'));
});

test('enviarResultado: um POST com o corpo do contrato; 400/401 não repetem', async () => {
  let status = 200;
  const chamadas = mockFetch(() => ({ status }));
  const detalhe = [{
    impressora: 'EPSON TM-T20', documento: 'jv-118924-1', visto_na_fila: true, job_status: 'Printing',
    resultado: 'impresso', etapa: null, erro: null, confirmacao: 'fila_windows', ms: 1830,
  }];
  const envio = confirmacao.enviarResultado(118924, detalhe);
  assert.equal(confirmacao.enviosPendentes(), 1); // o updater espera por isso
  await envio;
  assert.equal(confirmacao.enviosPendentes(), 0);
  assert.equal(chamadas[0].url, 'https://api.test/impressao/resultado');
  assert.equal(chamadas[0].opts.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(chamadas[0].opts.body), {
    idempresa: 3, maquina: confirmacao.maquina(), versao: version, idprint: 118924, status: 'impresso',
    etapa: null, erro: null, confirmacao: 'fila_windows', impressora: 'EPSON TM-T20', detalhe,
  });
  status = 400;
  await confirmacao.enviarResultado(118924, detalhe);
  status = 401;
  await confirmacao.enviarResultado(118924, detalhe);
  assert.equal(chamadas.length, 3);
});

test('heartbeat: corpo do contrato, com os 5 últimos erros (mais novo primeiro)', async (t) => {
  t.after(() => confirmacao.stopHeartbeat());
  Object.assign(storeData, { printer: 'EPSON TM-T20', printer_paper_mm: 80, impressao_pausadaPeloUsuario: true });
  for (let i = 1; i <= 7; i += 1) confirmacao.registrarErro(`erro ${i}`, i);
  let chegou;
  const primeiro = new Promise((res) => { chegou = res; });
  global.fetch = async (url, opts) => { chegou({ url, corpo: JSON.parse(opts.body) }); return { ok: true, status: 200 }; };
  confirmacao.startHeartbeat();
  const { url, corpo } = await primeiro;
  assert.equal(url, 'https://api.test/impressao/heartbeat');
  assert.equal(corpo.idempresa, 3);
  assert.equal(corpo.so, process.platform);
  assert.equal(corpo.impressora_padrao, 'EPSON TM-T20');
  assert.equal(corpo.papel_mm, 80);
  assert.equal(corpo.pausada, true);
  assert.ok(Array.isArray(corpo.impressoras));
  if (process.platform !== 'win32') assert.deepEqual(corpo.impressoras, []);
  assert.deepEqual(corpo.ultimos_erros.map((e) => e.erro), ['erro 7', 'erro 6', 'erro 5', 'erro 4', 'erro 3']);
  assert.equal(corpo.ultimos_erros[0].idprint, 7);
});

test('statusImpressora: Win32_Printer → texto legível', () => {
  const s = (p) => confirmacao.statusImpressora({ PrinterStatus: 3, DetectedErrorState: 2, WorkOffline: false, ...p });
  assert.equal(s({}), 'Normal');
  assert.equal(s({ PrinterStatus: 7 }), 'Offline');
  assert.equal(s({ DetectedErrorState: 7 }), 'Tampa aberta');
  assert.equal(s({ DetectedErrorState: 8 }), 'Erro');
  assert.equal(s({ PrinterStatus: 6 }), 'Parada');
  assert.equal(s({ PrinterStatus: 2, DetectedErrorState: 0 }), 'Desconhecido');
});

test('ticketWatcher carrega sem Electron e começa ocioso', () => {
  const { isPrinting } = require('../core/api/ticketWatcher');
  assert.equal(isPrinting(), false);
});
