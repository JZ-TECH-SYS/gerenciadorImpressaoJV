'use strict';
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'assets', 'js', 'painelMyZap.js');
let src = fs.readFileSync(target, 'utf8');

// Mapa exato dos tokens restantes (caracter a caracter conforme o arquivo real)
const fixes = [
  // 'âš  Erro de conexÃ£o' (com dois espacos apos âš)
  ["\u00e2\u0161\u00a0\u00a0Erro de conex\u00c3\u00a3o", "Erro de conexao"],
  ["'â\x9A  Erro de conex\xC3\xA3o'", "'Erro de conexao'"],
  // variantes com encoding duplo
  ["'âŒ Erro ao iniciar sess\xC3\xA3o'", "'Erro ao iniciar sessao'"],
  ["'âŒ Sess\xC3\xA3o encerrada'", "'Sessao encerrada'"],
  ["'âš  Erro ao deletar sess\xC3\xA3o'", "'Erro ao deletar sessao'"],
  ["'âš  Sess\xC3\xA3o j\xC3\xa1 existe'", "'Sessao ja existe'"],
  ["'â³ Sess\xC3\xA3o iniciada, aguardando QR Code'", "'Sessao criada - gerando QR Code...'"],
  ["'âŒ Sess\xC3\xA3o encerrada'", "'Sessao encerrada'"],
];

// Substitui via regex bytes literais no buffer
let buf = Buffer.from(src, 'utf8');
let str = buf.toString('latin1'); // ver como os bytes realmente estao

// Substituicoes diretas por pattern de bytes
const map = [
  ["â\x9a\xa0\xa0Erro de conex\xc3\xa3o",  "Erro de conexao"],
  ["â\x9a\xa0 Erro de conex\xc3\xa3o",     "Erro de conexao"],
  ["\xe2\x9a\xa0\xa0Erro de conex\xc3\xa3o","Erro de conexao"],
  ["\xe2\x9c\x85 Conectado",               "Conectado"],
  ["\xe2\x8c\x9b Aguardando",              "Aguardando"],
  ["\xe2\x9d\x8c Desconectado",            "Desconectado"],
  ["\xe2\x9d\x8c Sess\xc3\xa3o encerrada", "Sessao encerrada"],
  ["\xe2\x9d\x8c Erro ao iniciar sess\xc3\xa3o", "Erro ao iniciar sessao"],
  ["\xe2\x9a\xa0 Erro de conex\xc3\xa3o",  "Erro de conexao"],
  ["\xe2\x9a\xa0 Erro ao deletar sess\xc3\xa3o", "Erro ao deletar sessao"],
  ["\xe2\x84\xb9 Nenhuma sess\xc3\xa3o ativa", "Nenhuma sessao ativa"],
  ["\xe2\x9a\xa0 Sess\xc3\xa3o j\xc3\xa1 existe", "Sessao ja existe"],
  ["\xe2\xb3\x9b Sess\xc3\xa3o iniciada",  "Sessao criada - gerando QR Code..."],
  ["\xf0\x9f\x9a\x80 Iniciando sess\xc3\xa3o...", "Iniciando sessao..."],
  ["\xf0\x9f\xa7\xb9 Encerrando sess\xc3\xa3o...", "Encerrando sessao..."],
];

// Estrategia: ler como binary
let raw = fs.readFileSync(target);
let changed = false;
for (const [from, to] of map) {
  const fromBuf = Buffer.from(from, 'binary');
  const toBuf = Buffer.from(to, 'utf8');
  let idx;
  while ((idx = raw.indexOf(fromBuf)) !== -1) {
    raw = Buffer.concat([raw.slice(0, idx), toBuf, raw.slice(idx + fromBuf.length)]);
    changed = true;
    console.log('  BIN FIX: ' + from.replace(/[\x00-\x1f\x80-\xff]/g, '?').slice(0, 40));
  }
}

// Tambem fix via regex de texto depois de reinterpretar
src = raw.toString('utf8');

// Regex para sobras de emojis quebrados — pegar qualquer statusIndicator.textContent = '...' com chars invalidos
src = src.replace(/statusIndicator\.textContent = '([^']*[\x80-\xff][^']*)'/g, (m, inner) => {
  const clean = inner
    .replace(/[^\x20-\x7e\u00e0-\u00ff ]/g, '') // remove chars de controle
    .replace(/\xc3[\x80-\xbf]/g, (c) => Buffer.from(c, 'latin1').toString('utf8'))
    .replace(/Ã£/g, 'a').replace(/Ã¡/g, 'a').replace(/Ã³/g, 'o')
    .replace(/Ã§/g, 'c').replace(/Ã/g, '').replace(/â€/g, '')
    .trim();
  console.log('  REGEX FIX textContent: ' + inner.slice(0,40).replace(/[\x80-\xff]/g,'?') + ' -> ' + clean);
  return "statusIndicator.textContent = '" + clean + "'";
});

// Fix de comentarios com emojis numerados (1️⃣ etc) - simplesmente remover o emoji
src = src.replace(/\/\/ [^\x20-\x7e\n]+/g, (m) => {
  const cleaned = m.replace(/[^\x20-\x7e\/]/g, '').trim();
  if (cleaned === '//') return '';
  return cleaned;
});

// Fix setTimeout(checkConnection, 5000) que sobrou
src = src.replace(
  /\/\/ opcional.*\n\s*setTimeout\(checkConnection, 5000\);/,
  'startQrPolling();'
);

// Fix check errado se ainda existir
src = src.replace(
  /if \(!response \|\| response\.result !== 'success'\) \{\s*throw new Error\('[^']+'\);\s*\}/,
  `if (!response) {
      throw new Error('Sem resposta do MyZap. Verifique se o servico esta rodando (porta 5555).');
    }
    const resultVal = String(response.result ?? response.status ?? '').toLowerCase();
    if (resultVal === 'error' || resultVal === 'false') {
      throw new Error(response.message || response.messages || 'Falha ao criar sessao no MyZap.');
    }`
);

fs.writeFileSync(target, src, 'utf8');
console.log('\npainelMyZap.js salvo.');
