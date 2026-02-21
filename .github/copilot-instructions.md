# Instrucoes do Copilot para JV-Printer

## Escopo do projeto

- Este repositorio e um gerenciador desktop de impressao.
- O repositorio tambem contem modulo operacional do MyZap (painel e fila) rodando em paralelo.
- Mantenha sugestoes e alteracoes focadas em impressao, configuracao, tray, logs e empacotamento.
- Nao proponha arquitetura ou features fora desse escopo, a menos que seja pedido explicitamente.
- Quando solicitado, documente tambem o modulo MyZap no README sem confundir com backend dedicado.

## Arquitetura principal

- Entrada do processo principal: `main.js`.
- Loop de polling de tickets: `core/api/ticketWatcher.js`.
- Consulta externa de tickets: `core/api/consultarTickets.js`.
- Motor de impressao: `core/impressora/imprimirHtml.js`.
- Monitor de Job ID: `core/utils/windowsJobMonitor.js`.
- Logs e diagnostico: `core/utils/logger.js`.
- Paginas renderer: `assets/html` e `assets/js`.
- APIs privilegiadas para renderer devem passar por preload em `src/loads`.

## Convencoes de codigo

- Use CommonJS (`require`, `module.exports`).
- Prefira `const` e `let`; finalize instrucoes com `;`.
- Mantenha naming e mensagens de log em portugues, seguindo o padrao atual.
- Preserve os fallbacks existentes para Windows e Linux.
- Mantenha mudancas pequenas e consistentes com a organizacao atual.

## Regras do fluxo de impressao

- Preserve prioridade de impressora por ticket:
  - use `item.impressora` quando existir;
  - caso contrario use a impressora padrao salva no store.
- Nao remover a serializacao da fila de impressao no Linux.
- Nao remover a tentativa de capturar Job ID real no Windows antes do fallback.
- Preservar impressao silenciosa (`silent`) no fluxo de producao.

## Erros e logs

- Sempre registrar erros operacionais com metadata.
- Preferir logs estruturados via `logger.js` em vez de `console.log` no fluxo de producao.
- Nao engolir erro sem pelo menos um registro de warning/error.

## UI e IPC

- Evitar acesso direto ao Node.js em scripts renderer.
- Expor novas capacidades via preload + handlers IPC.
- Manter criacao de janelas dentro de `core/windows`.

## Regras de documentacao

- O `README.md` pode cobrir gerenciador de impressao e o modulo MyZap do app.
- Instrucoes de setup, operacao e troubleshooting devem ser diretas e executaveis.
