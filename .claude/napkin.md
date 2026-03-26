# Napkin Runbook

## Curation Rules
1. **[2026-03-25] Curar sem virar diário**
   Do instead: manter só regras recorrentes, com ação concreta e sem histórico de sessão.

## Execution & Validation (Highest Priority)
1. **[2026-03-25] Árvore Git costuma vir suja**
   Do instead: ler o arquivo atual antes de editar e patchar só o trecho necessário, sem reverter mudanças alheias.
2. **[2026-03-25] Impressão Linux deve respeitar o CUPS**
   Do instead: para impressora nomeada, usar `lp`/`lpr`; escrita direta em `/dev/*` só quando o próprio device for escolhido explicitamente.

## Shell & Command Reliability
1. **[2026-03-25] Buscar sempre com `rg`**
   Do instead: usar `rg`/`rg --files` para localizar código e só cair para alternativas se faltar ferramenta.

## Domain Behavior Guardrails
1. **[2026-03-25] Logs precisam seguir o dia local**
   Do instead: gerar o nome do arquivo de log com a data local de Sao Paulo, não com `toISOString()`.
2. **[2026-03-25] Separar eventos de impressão dos logs do sistema**
   Do instead: direcionar discovery de impressoras, watchers de ticket e monitor de job para o canal `printer`.

## User Directives
1. **[2026-03-25] Revisões devem priorizar ruído operacional real**
   Do instead: reduzir logs repetitivos de polling e deixar os registros fortes para falhas, transições e lotes processados.
