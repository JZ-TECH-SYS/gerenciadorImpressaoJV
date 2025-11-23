# 🖨️ JV-Printer · Gerenciador de Impressões Inteligente

![JV-Printer](build/icon.png)

> Monitoramento contínuo de tickets, impressão automática e rastreabilidade de ponta-a-ponta.

![Electron](https://img.shields.io/badge/Electron-28+-4776E6?style=flat&logo=electron)
![Node.js](https://img.shields.io/badge/Node.js-18+-43853D?style=flat&logo=node.js)
![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D6?style=flat&logo=windows)
![MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat)

---

## ✨ Destaques

- 🔄 **Impressão automatizada** — consulta a API, gera o HTML e envia para a impressora em segundos.
- 🆔 **Job ID real do Windows** — captura o identificador original do spooler e grava nos relatórios.
- 📒 **Logs JSON Lines** — cada evento é salvo como JSON estruturado e exibido na UI em ordem decrescente.
- 🖥️ **App desktop nativo** — bandeja do sistema, notificações, toasts e viewer de logs com “tema Matrix”.
- 🔔 **Atualizador integrado** — builds empacotados com electron-builder + GitHub Releases.

---

## 📦 Instalação

### Usuário final

1. Baixe o instalador `jv-printer.Setup.x.y.z.exe` no GitHub Releases.
2. Clique com o botão direito → **Executar como administrador**.
3. Conclua o assistente. O JV-Printer inicia sozinho e fica disponível na bandeja.

### Ambiente de desenvolvimento

```bash
git clone https://github.com/JZ-TECH-SYS/gerenciadorImpressaoJV.git
cd gerenciadorImpressaoJV

npm install          # dependências
npm start            # Electron em modo dev

npm run dist         # gera instalador + latest.yml
```

Pré-requisitos: Windows 10/11, Node.js 18+, Git e uma impressora configurada no SO.

---

## ⚙️ Configuração inicial

1. Na primeira execução o app abre automaticamente a tela **Configurações**.
2. Informe a **URL da API**, **ID da empresa** e selecione a **impressora**.
3. Clique em **Salvar**. As demais janelas (logs, teste de impressão, ajuda) ficam no menu do tray.

### Permissões úteis

```powershell
# Habilitar log do spooler (necessário para capturar Job ID)
wevtutil sl Microsoft-Windows-PrintService/Operational /e:true

# Caso o PowerShell esteja bloqueado
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## 🖱️ Operação diária

| Ação | Onde fica | O que faz |
|------|-----------|-----------|
| ⚙️ Configurações | Menu da bandeja | Edita API, impressora, tempo de pooling etc. |
| ▶️ Iniciar | Menu da bandeja | Começa a vigiar a API e imprimir automaticamente |
| ⛔ Parar | Menu da bandeja | Pausa o watcher |
| 📄 Logs | Menu ou atalho | Viewer dark com filtros por nível e busca textual |
| 🧪 Teste de impressão | Menu | Dispara recibo de teste direto na impressora |
| 📁 Abrir pasta | Menu | Abre `%TEMP%\jv-printer\logs` no Explorer |
| ❓ Ajuda | Menu | Gera o arquivo `SOLUCAO_PROBLEMAS.txt` com check-list |

O watcher roda em background. Assim que a API retorna um ticket, o HTML é renderizado num `BrowserWindow` invisível, impresso e, depois, validado pelo `windowsJobMonitor` para capturar o ID original do Windows.

---

## 📚 Logs & diagnósticos

- **Formato:** JSON Lines (`*.jsonl`). Cada linha = um evento (`timestamp`, `level`, `message`, `metadata`).
- **Caminho:** `%TEMP%\jv-printer\logs` (ex.: `C:\Users\<user>\AppData\Local\Temp\jv-printer\logs`).
- **Arquivos:**
  - `YYYY-MM-DD-log-sistema.jsonl` → fluxo geral (API, impressão, erros, toasts)
  - `YYYY-MM-DD-log-win.jsonl` → eventos do monitor de jobs do Windows
  - `SOLUCAO_PROBLEMAS.txt` → guia rápido criado automaticamente
- **Viewer interno:** lê os últimos KB, filtra por nível (erro/aviso/info/debug), busca trechos e mostra o conteúdo de impressão dentro de um bloco `<pre>` com rolagem. Registros mais novos aparecem no topo.

Trecho real:

```json
{"timestamp":"2025-11-23T17:20:14.772Z","level":"info","message":"IMPRESSAO - Impressora: MP-4200 TH | JobID: 884","channel":"system","metadata":{"impressora":"MP-4200 TH","jobId":884,"comprimento":3962,"conteudo":"<style>..."}}
```

---

## 🚀 Releases, CI/CD e auto-update

O pipeline usa **GitHub Actions** + **electron-builder**.

1. Ajuste a versão em `package.json` (ou rode `node scripts/bumpVersion.js`).
2. `git commit -am "release: vX.Y.Z" && git push`.
3. O workflow `Build & Release` executa `npm run dist`, publica `Setup.exe` + `latest.yml` no GitHub Releases e cria a tag `vX.Y.Z`.
4. O app chama `autoUpdater.checkForUpdatesAndNotify()` ao iniciar; quando encontra release assinado, baixa em background e mostra toast quando pronto para instalar.

> 🔒 **Repositório privado?** O feed `releases.atom` exige acesso público ou um token. Se o app estiver instalado em máquinas sem autenticação GitHub, o auto-update retornará 404. Solução: tornar o release público ou hospedar os artefatos em um endpoint acessível (S3, CDN etc.) e apontar o updater para lá.

Para gerar um build manual:

```bash
npm run dist
```

Os artefatos ficam em `dist/`.

---

## 🆘 Troubleshooting rápido

| Sintoma | Ação sugerida |
|---------|---------------|
| Não captura Job ID | Executar comandos de permissão (seção “Configuração”), reiniciar app como admin |
| Impressora não aparece na lista | Verificar se está instalada, ligada e sem filas, depois reabrir configurações |
| API não responde | Checar conectividade, logs `log-sistema.jsonl` e o filtro de busca no viewer |
| Auto-update mostra 404 | Confirmar se o release é público ou configure feed alternativo com token |

---

## 🧱 Stack & arquitetura

- **Electron** para UI desktop + tray + notificações.
- **Node.js + PowerShell** para comunicação com o Windows spooler.
- **Electron IPC / preload** para expor `logViewer`, `settings` e `testPrint` às páginas HTML.
- **Windows Event Log** monitorado por `windowsJobMonitor` (poll + filtros) para casar o Job ID real com a impressão enviada.

Fluxo macro:

```text
API → Ticket → Render HTML → BrowserWindow.silentPrint → windowsJobMonitor → log JSONL → viewer / suporte
```

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).

---

**🖨️ Impressão Inteligente • 📊 Rastreabilidade Total • 🚀 Automação Completa**  
JZ-TECH-SYS · JV-Printer
