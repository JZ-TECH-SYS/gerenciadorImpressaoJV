# Roteiro de ensaio: impressão travada (gerenciador 4.2.3)

> Guia para o dono repetir no notebook com a impressora o ensaio do conserto do
> [[caso-capucho-impressao-travada]]. Branch `fix/impressao-nao-congela`, sem publicar na `main`.
> Escrito em 25/11/2026. O ensaio de 25/11 ficou sem o papel: a impressora não estava conectada.

O roteiro prova três coisas no Windows de verdade:

- **A, normal:** a via sai no papel e a API recebe "impresso".
- **B, travada:** em até 45 s a API recebe "erro" com motivo, o gerenciador continua consultando e
  a via seguinte sai no papel.
- **Sem dobro:** nenhuma via sai duas vezes.

Comandos pensados para rodar do WSL (o Claude chama o Windows pelo `powershell.exe`). Use **só a
empresa 1 "CapuchoLanchesTeste"**, nunca loja real. Gasta 2 a 3 recibos.

## 0. Antes de começar

1. **A impressora existe de verdade.** O driver HPRT da MPT-II mostra "Normal" no Windows mesmo
   desligada ou sem cabo. Confira se há dispositivo (USB "Suporte de impressão USB" ou porta COM
   do Bluetooth), não só a fila:
   ```powershell
   Get-PnpDevice -PresentOnly | Where-Object { $_.Class -in 'USB','Printer','Ports' } | Select Status, Class, FriendlyName
   Get-Printer | Select Name, PortName, PrinterStatus, JobCount
   ```
   Se não houver dispositivo, imprima uma página de teste pelo Windows antes de seguir.
2. **A fila do Windows da impressora está vazia** (`Get-PrintJob -PrinterName '<impressora>'`). Uma
   via `jv-*` antiga fica na frente e as do ensaio não saem. Se tiver, decida antes o que fazer com ela.
3. **Anote o estado atual** para desfazer no fim: a versão instalada e uma cópia do
   `%APPDATA%\jv-printer\config.json` (guarde em Documentos, não no `%TEMP%`).
   ```powershell
   (Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | ? DisplayName -like '*jv*printer*').DisplayVersion
   Copy-Item "$env:APPDATA\jv-printer\config.json" "$env:USERPROFILE\Documents\config.json.antes-do-ensaio"
   ```
   No `config.json` confira `idempresa = 1`, a `apiUrl` de produção e `printer` = a impressora
   do teste.
4. **Ninguém mais consome a fila da empresa 1:** `GET impressao/gerenciadores/1` (com o token do
   gerenciador) deve mostrar só esta máquina. Outra máquina online leva as vias do ensaio.

## 1. Gerar e instalar o artefato da branch (sem soltar para a frota)

Só a `main` publica release. Disparado na branch, o workflow gera só os artefatos do run.

```bash
cd ~/jztech/gerenciadorImpressaoJV          # ou a worktree da branch
gh workflow run release.yml --ref fix/impressao-nao-congela
gh run list --workflow release.yml --limit 1              # espera o build-windows ficar "success" (~3 min)
D=/mnt/c/Users/<voce>/Downloads/jv-printer-ensaio-4.2.3; mkdir -p "$D"
gh run download <id-do-run> -n windows-artifacts -D "$D"   # jv-printer-Setup-4.2.3.exe
```

O run de 25/11 (`45728827190`) já tem o artefato, enquanto o GitHub o mantiver.

Feche o gerenciador (bandeja → Sair, ou `Stop-Process -Name jv-printer -Force`) e instale em silêncio:

```powershell
Start-Process -Wait -FilePath "C:\Users\<voce>\Downloads\jv-printer-ensaio-4.2.3\jv-printer-Setup-4.2.3.exe" -ArgumentList '/S'
(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | ? DisplayName -like '*jv*printer*').DisplayVersion   # 4.2.3
```

A instalação não mexe no `config.json`. O auto-update não volta para a 4.2.2, porque a última
release (4.2.2) é menor que 4.2.3.

## 2. Como mandar uma via de teste

A rota pública cria uma via do pedido inteiro na fila da empresa 1. O pedido 80647 é da loja de
teste e tem total R$ 13:

```bash
curl -s "https://api-clickexpress.jztech.com.br/public/sendPrint/1/80647/all"   # {"result":[<idprint>],"error":false}
```

Anote o `idprint` devolvido: o documento na fila do Windows vai se chamar `jv-<idprint>-1`.

## 3. Caso A: impressão normal

1. Abra o gerenciador normal: `Start-Process "$env:LOCALAPPDATA\Programs\jv-printer\jv-printer.exe"`.
2. Mande **uma** via (passo 2).
3. O que deve acontecer:
   - o recibo sai no papel;
   - no log local, de 1 a 2 s entre "Impressão do ticket iniciado" e "HTML enviado para impressora
     com sucesso" (o tempo inclui abrir o processo filho), e depois "Resultado da via na fila" com
     `resultado: impresso` e confirmação `fila_windows` ou `status_impressora`;
   - na tela **Parametrização → Fila de impressão**: impresso ✓;
   - na API, `getFilaPrintHistorico/1/80647`: criada → entregue → impresso.

## 4. Caso B: impressão travada

`JV_ENSAIO_TRAVAR_IMPRESSAO=1` no ambiente do gerenciador congela o processo filho logo antes do
`webContents.print`, como o driver da Capucho congelou. **Só a 1ª impressão depois de abrir o app
trava**; a seguinte já sai normal.

1. Feche o gerenciador. Com ele aberto, uma 2ª abertura só foca a janela e não pega a variável.
2. Abra com a variável:
   ```powershell
   $env:JV_ENSAIO_TRAVAR_IMPRESSAO = '1'; Start-Process "$env:LOCALAPPDATA\Programs\jv-printer\jv-printer.exe"
   ```
3. Mande a **via 1** e, 5 s depois, a **via 2** (passo 2 duas vezes).
4. Enquanto a via 1 trava, dá para ver o filho congelado:
   ```powershell
   Get-CimInstance Win32_Process | ? { $_.Name -eq 'jv-printer.exe' -and $_.CommandLine -like '*--jv-imprimir=*' } | Select ProcessId, CreationDate
   ```
5. O que deve acontecer:
   - **via 1:** não sai papel. No `crash.log`, `PRINT_SENDING` e, 35 s depois, `PRINT_TIMEOUT` com
     `fase: imprimindo` e `motivo: impressora travou: sem resposta do Windows em 35 s`. No log de
     impressão: "Impressão sem resposta: processo de impressão encerrado" → "Resultado da via que
     travou" (`etapa: travou`) → "Resultado da impressão enviado" (`status: erro`), **em até 45 s**
     depois de "Impressão do ticket iniciado". O processo filho some (o PID do passo 4 não existe
     mais). Na tela: erro "Impressora: impressora travou: sem resposta do Windows em 35 s";
   - **via 2:** começa menos de 1 s depois do erro da via 1, num filho novo, sai no papel e vira
     "impresso". É a prova de que o gerenciador seguiu consultando;
   - **sem dobro:** no `getFilaPrintHistorico` a via 1 tem um único "entregue" e o "erro", sem nova
     entrega, e nada da via 1 sai no papel depois. Quem decide reimprimir é a loja: reimprimir pela
     tela deve sair normal.
6. Para repetir o travamento, feche e abra de novo com a variável.

## 5. Onde olhar

| O quê | Onde |
|-------|------|
| Log de impressão (JSON por linha, **hora em UTC**) | `%TEMP%\jv-printer\logs\AAAA-MM-DD-log-impressora.jsonl` |
| Trilha síncrona (sobrevive a travamento e kill) | `%TEMP%\jv-printer\logs\crash.log`: `PRINT_ATTEMPT`, `PRINT_SENDING`, `PRINT_SUCCESS`, `PRINT_TIMEOUT` (com `pid` do filho) |
| Fila do Windows | `Get-PrintJob -PrinterName '<impressora>'` (documento `jv-<idprint>-<n>`) |
| Tela da loja | ClickExpress → Parametrização → Fila de impressão (etapas e eventos de cada via) |
| API | `getFilaPrintHistorico/1/<idpedidovenda>`, `impressao/gerenciadores/1` (heartbeat, versão) |
| Banco | `filaprint` (status 5 = entregue esperando resultado, `erro`, `confirmacao`) e `filaprint_evento` |

No filho travado, as linhas de log assíncronas logo antes do travamento se perdem (ex.: "pageSize
explicito calculado"). O `crash.log` guarda a trilha síncrona.

## 6. Desfazer

1. Feche o gerenciador (`Stop-Process -Name jv-printer -Force`).
2. Tire da fila do Windows as vias de teste que sobraram, para não saírem no papel depois:
   `Get-PrintJob -PrinterName '<impressora>' | ? DocumentName -like 'jv-<idprint>-*' | Remove-PrintJob`.
3. Volte a versão de antes, a não ser que vá publicar a 4.2.3 logo em seguida:
   ```bash
   gh release download v4.2.2 -R JZ-TECH-SYS/gerenciadorImpressaoJV -p 'jv-printer-Setup-4.2.2.exe' -D /mnt/c/Users/<voce>/Downloads/jv-printer-restaurar
   ```
   ```powershell
   Start-Process -Wait -FilePath "C:\Users\<voce>\Downloads\jv-printer-restaurar\jv-printer-Setup-4.2.2.exe" -ArgumentList '/S'
   ```
4. Restaure o `config.json` guardado no passo 0. Ele também tira da vigia do tardio as vias do ensaio.
5. Apague as pastas baixadas e `%TEMP%\jv-printer\impressao-filho`, o perfil do Chromium do filho
   (~2 MB).
6. Se o gerenciador estava aberto antes, abra de novo **sem** a variável: um `Start-Process` numa
   janela nova do PowerShell não herda o `$env:` da anterior.

## 7. Publicar

Merge da branch na `main` = release automático para **todas** as lojas em até 45 min. Só com o ok
do dono, depois deste roteiro passar com papel.
