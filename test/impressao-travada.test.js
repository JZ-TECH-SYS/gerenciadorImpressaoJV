// v4.2.3 — impressão travada não congela o gerenciador (Capucho, 25/11/2026, via 128081).
// Processos filhos DE VERDADE (node) no lugar do Electron: anotam as fases como o filho de
// impressão e, no caso travado, congelam o event loop (Atomics.wait) como o driver congelou.
//   npm test   (node --test test/*.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-printer-test-'));
process.env.TMPDIR = TMP;
process.env.TMP = TMP;
process.env.TEMP = TMP;
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

const storeData = { apiToken: 'tok', apiUrl: 'https://api.test/', idempresa: '1' };
const stub = (nome, exports) => {
  const arquivo = require.resolve(nome);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};
stub('electron', {});
stub('electron-store', class { get(k) { return storeData[k]; } set(k, v) { storeData[k] = v; } });

const { imprimirEmProcessoFilho } = require('../core/impressora/imprimirHtml');

// Filho falso: o mesmo protocolo do rodarFilho (linhas JSON em <base>.fase).
const FILHO = `
const fs = require('fs');
const [base, modo] = process.argv.slice(1);
const marcar = (d) => fs.appendFileSync(base + '.fase', JSON.stringify(d) + '\\n');
const congelar = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
marcar({ fase: 'carregando', pid: process.pid });
if (modo === 'trava_carregando') congelar();
marcar({ fase: 'imprimindo' });
if (modo === 'trava') congelar();
if (modo === 'morre') process.exit(3);
if (modo === 'recusa') marcar({ fase: 'fim', ok: false, erro: 'Print job failed' });
else marcar({ fase: 'fim', ok: true, jobId: 'chromium_1' });
`;
const abertos = [];
const abrirFalso = (modo) => (base) => {
  const filho = spawn(process.execPath, ['-e', FILHO, base, modo], { stdio: 'ignore' });
  abertos.push(filho.pid);
  return filho;
};
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch (_e) { return false; } };
const imprimir = (modo, limiteMs = 800) => imprimirEmProcessoFilho(
  { msg: '<div>Pedido</div>', printerName: 'MP-4200 TH' },
  { abrir: abrirFalso(modo), limiteMs },
);
const sobras = () => fs.readdirSync(path.join(TMP, 'jv-printer')).filter((n) => n.startsWith('print-'));

test('filho: impressão normal → sucesso, sem sobra de arquivo (o HTML tem dado do cliente)', async () => {
  assert.deepEqual(await imprimir('normal', 10000), { success: true, jobId: 'chromium_1', source: 'chromium' });
  assert.deepEqual(sobras(), []);
});

test('filho: travou no print → morto no limite, erro "travou" com motivo', async () => {
  const inicio = Date.now();
  await assert.rejects(imprimir('trava'), (e) => {
    assert.equal(e.travou, true);
    assert.equal(e.message, 'impressora travou: sem resposta do Windows em 1 s');
    return true;
  });
  const ms = Date.now() - inicio;
  assert.ok(ms >= 800 && ms < 3000, `${ms} ms`);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(vivo(abertos.at(-1)), false, 'o filho travado tem que morrer');
  assert.deepEqual(sobras(), []);
});

test('filho: travou antes do print (carregando) → erro sem "travou" (nada chegou ao Windows)', async () => {
  await assert.rejects(imprimir('trava_carregando'), (e) => {
    assert.equal(e.travou, false);
    assert.equal(e.message, 'a comanda não carregou em 1 s');
    return true;
  });
});

test('filho: morreu no meio do print → "travou"; Windows recusou → erro comum (como antes)', async () => {
  await assert.rejects(imprimir('morre', 10000), (e) => e.travou === true && /fechou sem responder \(saída 3\)/.test(e.message));
  await assert.rejects(imprimir('recusa', 10000), (e) => e.travou === false && e.message === 'Print job failed');
});

// ── laço do ticketWatcher: a via travada vira erro e a seguinte imprime ──
test('ticketWatcher: via travada → resultado "erro" com motivo, sem 2ª impressão; consulta segue e a próxima imprime', async () => {
  const modos = ['trava', 'normal'];
  const chamadas = [];
  const real = require.resolve('../core/impressora/imprimirHtml');
  require.cache[real].exports = (opcoes) => {
    chamadas.push(opcoes.printerName);
    return imprimirEmProcessoFilho(opcoes, { abrir: abrirFalso(modos.shift() || 'normal'), limiteMs: 800 });
  };
  const consultas = [];
  let watcher;
  const respostas = [
    { tickets: [{ id: 'a', texto: '<style></style><div>Pedido A</div>', impressora: 'MP-4200 TH' }], idprint: 128081, confirmar: true },
    { tickets: [{ id: 'b', texto: '<style></style><div>Pedido B</div>', impressora: 'MP-4200 TH' }], idprint: 128082, confirmar: true },
  ];
  stub(require.resolve('../core/api/consultarTickets'), async () => {
    consultas.push(Date.now());
    const r = respostas.shift();
    if (!r) watcher.stopWatcher();
    return r || { tickets: [], idprint: null, confirmar: false };
  });
  const posts = [];
  global.fetch = async (url, req) => {
    posts.push({ url, corpo: JSON.parse(req.body) });
    return { ok: true, status: 200 };
  };
  watcher = require('../core/api/ticketWatcher');

  await watcher.startWatcher();
  for (let i = 0; i < 50 && posts.length < 2; i += 1) await new Promise((r) => setTimeout(r, 20));

  assert.equal(chamadas.length, 2, 'uma impressão por via, nunca de novo');
  const [travada, seguinte] = posts.map((p) => p.corpo);
  assert.ok(posts.every((p) => p.url === 'https://api.test/impressao/resultado'));
  assert.equal(travada.idprint, 128081);
  assert.equal(travada.status, 'erro');
  assert.notEqual(travada.etapa, 'antes_spooler'); // antes_spooler a API reentregaria
  assert.equal(travada.erro, 'impressora travou: sem resposta do Windows em 1 s');
  assert.equal(travada.detalhe[0].etapa, 'travou');
  assert.equal(seguinte.idprint, 128082);
  assert.equal(seguinte.status, 'impresso');
  // a consulta seguinte saiu logo depois do limite, não ficou parada
  assert.ok(consultas[1] - consultas[0] < 3000, `${consultas[1] - consultas[0]} ms sem consultar`);
});
