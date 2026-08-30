# JV Printer v4 — versão suprema (30/08/2026)

O v4.0.0 transplanta para este app a **plataforma inteira do gerenciadorMyzap v2.3.x**
(Runtime Pack do MyZap com troca atômica + rollback, supervisor real, janela única com
semáforo, auto-update do app a cada 45min e do motor a cada 6h, instalador perUser sem UAC,
Setup LITE no feed + FULL offline) — **mantendo o subsistema de IMPRESSÃO intocado**.

## O que NÃO mudou (zona sagrada — zero regressão)

`core/impressora/*` (imprimirHtml com ESC/POS Linux + Electron print Windows, crash-hardening),
`core/api/ticketWatcher.js` (poll 500ms, dedup 15s, impressora por ticket), `consultarTickets`,
`listarImpressoras`, `printerLogger`, `windowsJobMonitor`. As únicas mudanças são **aditivas**:
contadores `getPrintingStatus()` (hoje/última/último erro) para o semáforo e a pausa de
impressão **persistida** (respeitada no auto-start). O main preserva `crashReporter`, os
switches de GPU e os handlers `render/child-process-gone` das térmicas.

## O que este app ganhou

- **Motor pelo canal compartilhado** (`github.com/JZ-TECH-SYS/myzap/releases`): mesmo pack
  do gerenciadorMyzap; dir próprio `%LOCALAPPDATA%\jv-printer\{myzap, myzap-data, myzap-packs}`.
  Upgrade legado→pack **migra os dados automaticamente** (validado ao vivo nesta máquina,
  sessões preservadas). Fim do `.env` comitado com TOKEN compartilhado (migração adota o
  token instalado).
- **UI**: abas Início | **Impressão** | WhatsApp | Mensagens | Configurações | Ajuda.
  Aba Impressão: seletor + salvar (religa na hora) + **Teste de impressão** (mesmo caminho
  da produção) + switch com status. Semáforo prioriza impressão (sem impressora = problema;
  pausada/erro recente = atenção). Bandeja: 10 → 5 itens (com Pausar impressão).
- Supervisor de verdade no lugar do loop de ensure de 20s; fila com pausas recuperáveis;
  Electron **pinado 40.6.0** (antes `"*"` flutuante); diagnóstico-para-clipboard com bloco
  de impressão.

## Referências

Toda a documentação da plataforma vale aqui:
[VERSAO_SUPREMA](https://github.com/JZ-TECH-SYS/gerenciadorMyzap/blob/main/docs/VERSAO_SUPREMA.md) ·
[RUNTIME_PACK](https://github.com/JZ-TECH-SYS/gerenciadorMyzap/blob/main/docs/RUNTIME_PACK.md) ·
[OPERACAO_E_SUPORTE](https://github.com/JZ-TECH-SYS/gerenciadorMyzap/blob/main/docs/OPERACAO_E_SUPORTE.md).
Publicação deste app: push na `main` (LITE+FULL); motor: tag `v*` no repo myzap.
