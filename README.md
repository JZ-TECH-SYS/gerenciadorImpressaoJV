# JV-Printer

Gerenciador desktop para:
- impressao automatica (modulo principal);
- operacao local do MyZap (modulo paralelo).

## Visao geral

O app possui 2 blocos independentes:

1. **Impressao**: loop de tickets, envio para impressora e logs de execucao.
2. **MyZap local**: sincroniza config pela API do ClickExpress, instala/inicia MyZap local quando o modo for `local/fila`.

## Revisao geral do fluxo (estado atual)

### Impressao (intacto)

- Entrada: `main.js`
- Watcher: `core/api/ticketWatcher.js`
- Consulta tickets: `core/api/consultarTickets.js`
- Pipeline de impressao:
  - Windows: `webContents.print({ silent: true })` + tentativa de Job ID real.
  - Linux: escrita local/ESC-POS + fallback CUPS.

Mudancas recentes ficaram concentradas no modulo MyZap. O fluxo principal de impressao continua o mesmo.

### MyZap (automatico, paralelo)

- Fonte da verdade: rota de configuracao da API (`parametrizacao-myzap/config/{idempresa}`).
- Se `modo = web/online`:
  - MyZap local fica desativado;
  - painel mostra aviso de modo online.
- Se `modo = local/fila`:
  - gerenciador instala/sincroniza/inicia MyZap local automaticamente;
  - watchers locais de fila/status ficam ativos.

## Diretorio dinamico do MyZap (Windows/Linux/macOS)

O diretorio do MyZap e decidido automaticamente pelo app:

- Windows: `%LOCALAPPDATA%\\jv-printer\\myzap`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/jv-printer/myzap`
- macOS: `~/Library/Application Support/jv-printer/myzap`

Regra de resiliencia:
- se existir `myzap_diretorio` salvo e for instalacao valida (tem `package.json`), ele e mantido;
- se o caminho salvo estiver invalido, o app volta automaticamente para o caminho padrao do SO.

Implementacao: `core/myzap/autoConfig.js`.

## Sincronizacao e timers

- Sync remoto de config MyZap: **30s**
  - `main.js` (`MYZAP_CONFIG_REFRESH_MS`)
- Tentativa de iniciar watcher de fila local: **30s** (apenas modo local)
- Status passivo MyZap -> API: **10s** (apenas modo local)
- Polling de progresso no painel MyZap: **1s**

## Rotas obrigatorias da API (ClickExpress)

Estas rotas sao necessarias para o gerenciador funcionar no fluxo atual:

1. `GET /parametrizacao-myzap/config/{idempresa}`
2. `GET /parametrizacao-myzap/pendentes?sessionKey=...&sessionToken=...`
3. `POST /parametrizacao-myzap/fila/status`
4. `PUT /parametrizacao-myzap/status`

### Campos esperados na rota de config

Minimo obrigatorio:
- `session_myzap` (ou equivalente para `sessionKey`)
- `key_myzap` (ou equivalente para token MyZap)

Tambem utilizados:
- `session_name`
- `promptid` / `idprompt`
- `ia_ativa`
- `modo_envio` e/ou `modo_envio_id`
- `api_url` e `queue_token` (opcional; se ausente usa api/token principais)

Observacao:
- o parser aceita alias de nomes de campo para tolerar variacoes de payload.

## Endpoints locais do MyZap (localhost:5555)

Consumidos pelo gerenciador:
- `POST /verifyRealStatus`
- `POST /getConnectionStatus`
- `POST /start`
- `POST /deleteSession`
- `POST /admin/ia-manager/update-config`

## Logs

Diretorio:
- Windows: `%TEMP%\\jv-printer\\logs`
- Linux: `/tmp/jv-printer/logs`

Arquivos por canal:
- sistema: `YYYY-MM-DD-log-sistema.jsonl`
- windows jobs: `YYYY-MM-DD-log-win.jsonl`
- myzap: `YYYY-MM-DD-log-myzap.jsonl`

## Como validar rapido

1. Configurar empresa/API/impressora no painel principal.
2. Abrir painel MyZap.
3. Conferir modo:
   - se `online`, painel local fica bloqueado com aviso;
   - se `local/fila`, inicia fluxo automatico local.
4. No modo local, validar:
   - progresso de instalacao/start no painel;
   - status de conexao e QR quando aplicavel;
   - envio de fila e retorno de status na API.

## Desenvolvimento

```bash
git clone https://github.com/JZ-TECH-SYS/gerenciadorImpressaoJV.git
cd gerenciadorImpressaoJV
npm install
npm start
```

## Build

```bash
npm run pack
npm run dist
npm run dist:linux
```

## Arquivos-chave

- `main.js`
- `core/api/ticketWatcher.js`
- `core/api/consultarTickets.js`
- `core/impressora/imprimirHtml.js`
- `core/utils/windowsJobMonitor.js`
- `core/utils/logger.js`
- `core/myzap/autoConfig.js`
- `core/api/whatsappQueueWatcher.js`
- `core/api/myzapStatusWatcher.js`
- `assets/html/painelMyZap.html`
- `assets/js/painelMyZap.js`

## Licenca

MIT.
