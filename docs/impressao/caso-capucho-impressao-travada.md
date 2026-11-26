# Caso Capucho: impressão travada congelou o gerenciador (via 128081)

> Chamado de 25/11/2026 (Capucho Lanches, pedido #88463, via 128081). Status: conserto na
> raiz no gerenciador 4.2.3 (branch `fix/impressao-nao-congela`, não publicado), ensaiado no
> Windows com papel em 25/11/2026 (MPT-II, empresa 1). Falta o ok do dono para a `main`.
> Para repetir: [[roteiro-ensaio-impressao-travada]].

## O que aconteceu

Computador DESKTOP-RR2CGVH, impressora "MP-4200 TH" (Bematech) na porta `Bematech_COM4`,
gerenciador 4.2.2. O relógio do PC estava **34 s adiantado** em relação ao servidor. O log local
grava em UTC; abaixo está tudo em horário de Brasília (UTC−3).

| Hora (PC) | Hora (servidor, ≈ PC − 34 s) | Onde | O quê |
|-----------|------------------------------|------|-------|
| 20:13:52.957 | ≈ 20:13:19 | log local | "Impressão do ticket iniciado" (a API já tinha entregado a via: status 5) |
| 20:13:53.091 | | log local | "HTML carregado" |
| 20:13:53.092 | | crash.log | `PRINT_SENDING` (fase `webContents.print`): a última linha antes do silêncio |
| 20:13:53 → 20:19:20 | | todos | **nada por 5,5 min**: nem o callback do print nem o `PRINT_TIMEOUT` de 30 s |
| | 6 min | servidor | nenhuma consulta da fila (`cronImpressaoDiretav3`) vinda da loja |
| 20:19:20 | | log local | "Iniciando watcher de impressão…": o app foi reiniciado (não se sabe se por pessoa ou pelo Windows) |
| | 20:51 | loja | reimpressão manual, 38 min depois. A via 128081 ficou em status 5 (entregue) sem nenhum `POST impressao/resultado` |

Numa via normal da mesma loja o callback do print chega em 1,5–4 s e o "Resultado da via na fila"
uns 5 s depois.

## Causa

O `webContents.print` roda no processo principal do Electron. O driver (MP-4200 TH na COM4) não
devolveu a chamada e **congelou o thread principal**. A prova é que o `PRINT_TIMEOUT`, um
`setTimeout` de 30 s que existia justamente para isso, nunca rodou: com o event loop parado, nenhum
timer dispara. Junto com o thread caíram:

- o laço do `ticketWatcher` (esperava o `imprimirHTML`): a fila parou de ser consultada;
- o resultado da via: nada foi para a API, e a tela da loja ficou em "entregue" sem erro;
- o `await win.loadFile(...)`, que também não tinha limite de tempo.

Nenhum timeout feito no próprio processo resolve isso, porque o processo inteiro está parado.

## Frequência

- Capucho: 2 em 4.261 vias em 30 dias.
- Todas as lojas: 1 em 1.348 vias em 7 dias.

Raro, mas a via some calada e a loja só descobre quando o cliente reclama.

## Decisão do dono

- O servidor **não** reenvia sozinho. Uma via reenviada que já saiu no papel vira via em dobro.
- O conserto é na raiz, no gerenciador: a impressão travada não pode congelar o app nem sumir
  calada, e o gerenciador nunca imprime a mesma via duas vezes por conta própria.
- Reenviar só se não houver outro jeito.

## O conserto (gerenciador 4.2.3)

Cada via, no Windows, imprime num **processo filho de vida curta**: o mesmo `jv-printer.exe` com
`--jv-imprimir=<base>`. O filho não pega o lock de instância única nem sobe bandeja, auto-update,
MyZap ou watchers. Ele abre a janela oculta, carrega o HTML e chama o `webContents.print` com as
mesmas opções de antes (`<title>jv-{idprint}-{n}`, `pageSize`, margens). Se o driver travar, quem
trava é o filho.

O processo principal espera **no máximo 35 s**. Passou disso, ele mata a árvore do filho
(`taskkill /PID <pid> /T /F`) e segue. O resultado chega à API em até ~45 s: 35 s mais uma leitura
da fila do Windows, que leva até 10 s com o PowerShell frio.

O filho anota a fase num arquivo (`carregando` → `imprimindo` → `fim`, uma linha JSON cada,
gravação síncrona que sobrevive ao `kill`). Pela última fase o pai decide:

| Situação | Resultado para a API | A API reentrega? |
|----------|----------------------|------------------|
| `fim` ok | `impresso` + rastreio da fila, como antes | não |
| Windows/Chromium recusou (callback `false`) | `erro`, etapa `antes_spooler`, como antes | sim (até 3×) |
| Travou ou morreu **antes** do print (HTML não carregou) | `erro` `antes_spooler`: nada chegou ao Windows | sim (sem risco de papel) |
| Travou ou morreu **depois** de chamar o print | rastreio de 1 leitura da fila (abaixo) | **não** |

Quando trava depois do print, o papel pode ter saído. Por isso esse caso nunca é tratado como
`antes_spooler` (a API reentregaria) e o gerenciador não reimprime:

- a via `jv-{idprint}-{n}` está na fila do Windows: vale a lógica que já existia (`erro` "parado
  na fila do Windows" + vigia do impresso tardio, ou `impresso` se já aparece como impressa);
- a via não está na fila, ou o PowerShell não responde: `erro` com o motivo, etapa `travou`. A API
  grava "Impressora: impressora travou: sem resposta do Windows em 35 s", a tela mostra o erro e
  **a loja decide reimprimir**.

Com isso, o laço continua consultando a fila no máximo ~45 s depois de uma via travada, e a via
seguinte imprime normalmente (num filho novo).

Arquivos: `core/impressora/imprimirHtml.js` (pai: `imprimirEmProcessoFilho`; filho: `rodarFilho`,
`imprimirNestaJanela`), `main.js` (entrada do filho, antes de qualquer outra coisa),
`core/api/ticketWatcher.js` (erro `travou` → rastreio), `core/impressora/confirmacao.js`
(`rastrearJob` com `travou`). O Linux/CUPS não mudou.

Para ensaiar, `JV_ENSAIO_TRAVAR_IMPRESSAO=1` no ambiente do gerenciador congela o filho logo
antes do print (`Atomics.wait`, o mesmo efeito do driver), e **só na 1ª impressão** depois de
abrir o app.

### Custo

Cada via abre um processo Electron: cerca de 1–2 s a mais e ~100 MB de memória enquanto imprime.
O perfil do Chromium do filho fica em `%TEMP%\jv-printer\impressao-filho`, para não disputar os
arquivos do gerenciador aberto.

## Testes

- Automatizados (`npm test`, 41/41): `test/impressao-travada.test.js` usa filhos `node` de verdade
  que congelam o event loop. Cobre: normal → sucesso e sem sobra de arquivo; travado no print →
  morto no limite, erro `travou` com motivo; travado ao carregar → erro sem `travou`; morreu no
  meio → `travou`; recusa → erro comum. E o laço do `ticketWatcher` ponta a ponta: via travada →
  `POST impressao/resultado` com `erro` e motivo, uma impressão por via, e a via seguinte impressa
  com a consulta saindo logo depois do limite. Em `test/confirmacao-impressao.test.js`, o
  `rastrearJob` com `travou`: fora da fila = erro, na fila = vigia do tardio, PowerShell fora = erro.
- Ensaio real: ver [Ensaio de 25/11/2026](#ensaio-de-25112026).

## Ensaio de 25/11/2026

PC LAPTOP-ASH88EJV, artefato da branch (run `45728827190`, instalado com `/S`), empresa 1,
impressora "MPT-II Recibo (USB)" (USB002, driver HPRT), via de teste `sendPrint/1/80647/all`.
**A impressora não estava conectada de verdade**: sem dispositivo USB, sem porta COM e Bluetooth
em erro. O Windows mostrava "Normal" mesmo assim, por isso o papel não foi provado. Horários de
Brasília; log local em UTC.

| Via | O que se fez | O que aconteceu |
|-----|--------------|-----------------|
| 128110 | normal, sem trava | Filho carregou e entregou ao Windows em 1,1 s (21:33:09.844 → 21:33:10.954, contando a abertura do filho). Via parada na fila ("Normal", 0/1 página, sem impressora): `erro` "parado na fila do Windows" + vigia do tardio, como na 4.2.2 |
| 128112 | `JV_ENSAIO_TRAVAR_IMPRESSAO=1` | Filho pid 29332 congelou em `PRINT_SENDING` às 21:34:34.534. Às 21:35:09.534, `PRINT_TIMEOUT` (`fase: imprimindo`, 35 s), filho morto (conferido: o PID sumiu). Fora da fila do Windows: `erro` etapa `travou`, `POST` às 21:35:10.376, **36,1 s** depois de "Impressão do ticket iniciado". API: entregue 21:34:35 → "Impressora: impressora travou: sem resposta do Windows em 35 s" às 21:35:11, sem reentrega |
| 128114 | mandada 5 s depois da 128112 | Começou às 21:35:10.852, **0,5 s depois do erro**, num filho novo (pid 46740), e foi entregue ao Windows em 0,8 s. API: entregue 21:35:11 (o laço não parou). Ficou parada na fila pela falta da impressora |

Também conferido: heartbeat da 4.2.3 aceito (online); nenhum `print-*` sobrou no
`%TEMP%\jv-printer`, nem do filho morto; perfil do filho com 1,8 MB. No fim, as vias de teste
foram tiradas da fila do Windows e o PC voltou para a 4.2.2 com o `config.json` de antes.

### Com papel (25/11/2026, 22:06)

A mesma MPT-II, agora conectada (USB `VID_0483&PID_5743` presente e `WorkOffline=False`, conferido
antes de cada via). O roteiro rodou inteiro em 50 s: a impressora dorme sozinha para economizar
bateria.

| Via | O que se fez | Log local | API (`filaprint_evento`) |
|-----|--------------|-----------|--------------------------|
| 128120 | normal | Entregue ao Windows em 0,95 s (22:06:28.188 → 22:06:29.142); saiu da fila antes da 1ª leitura com a impressora pronta: `impresso` / `status_impressora` | criada 22:06:28 → entregue 22:06:29 → impresso 22:06:31 |
| 128122 | `JV_ENSAIO_TRAVAR_IMPRESSAO=1` | Filho pid 17364 congelou em `PRINT_SENDING` às 22:06:38.166; `PRINT_TIMEOUT` às 22:07:13.097; fora da fila: `erro` etapa `travou`, `POST` às 22:07:13.967 (**36,1 s**) | criada 22:06:38 → entregue 22:06:38 → erro 22:07:14 "Impressora: impressora travou: sem resposta do Windows em 35 s"; `filaprint.status=3`, `tentativas=1`, **sem nova entrega** |
| 128124 | mandada 6 s depois da 128122 | Começou às 22:07:14.371, **0,4 s depois do erro**, num filho novo (pid 49168); entregue em 0,8 s: `impresso` / `status_impressora` | criada 22:06:44 → entregue 22:07:15 → impresso 22:07:17 |

Papel esperado: **2 recibos**, um da 128120 e um da 128124. A 128122 nunca chegou à fila do Windows
(filho morto antes do print), e a fila ficou vazia no fim. Nenhuma via teve 2 entregas. As vias
128121/128123/128125 são só os registros de item que o `sendPrint .../all` grava como já impressos
(status 2, sem entrega). O papel físico quem confirma é quem estava ao lado da impressora: o Windows
só prova que entregou.

## Riscos e o que fica de fora

- Via que trava **depois** de chegar ao spooler e some da fila quando o filho morre: vira `erro`
  "travou". Se mesmo assim o papel tiver saído, a loja vê o papel e não reimprime; se reimprimir,
  sai em dobro. Foi a escolha do dono (erro explícito em vez de via sumida).
- Via presa em "Spooling" pelo filho morto e apagada pelo Windows muito depois, sem passar por
  "Deleting" na leitura: a vigia do tardio pode marcar como impressa. Não vi isso acontecer; o
  caso da Capucho travou antes de criar o trabalho na fila.
- Driver que trava em todas as vias: cada uma leva 35 s e termina em erro explícito. A fila não
  para, mas a loja precisa olhar a impressora.
- `taskkill` não mata processo preso dentro do driver em modo kernel: o filho fica órfão, e o
  gerenciador segue do mesmo jeito.
