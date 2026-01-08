# 🖨️ JV-Printer · Gerenciador de Impressões Inteligente

![JV-Printer](build/icon.png)

> Monitoramento contínuo de tickets, impressão automática e rastreabilidade de ponta-a-ponta.

![Electron](https://img.shields.io/badge/Electron-28+-4776E6?style=flat&logo=electron)
![Node.js](https://img.shields.io/badge/Node.js-18+-43853D?style=flat&logo=node.js)
![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D6?style=flat&logo=windows)
![Linux](https://img.shields.io/badge/Linux-Mint%2FUbuntu%2FDebian-FCC624?style=flat&logo=linux)
![MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat)

---

## ✨ Destaques

- 🔄 **Impressão automatizada** — consulta a API, gera o HTML e envia para a impressora em segundos.
- 🆔 **Job ID real do sistema** — captura o identificador do spooler (Windows) ou CUPS (Linux) e grava nos relatórios.
- 🐧 **Multiplataforma** — suporte nativo para Windows 10/11 e Linux (Mint, Ubuntu, Debian).
- 📒 **Logs JSON Lines** — cada evento é salvo como JSON estruturado e exibido na UI em ordem decrescente.
- 🖥️ **App desktop nativo** — bandeja do sistema, notificações, toasts e viewer de logs com “tema Matrix”.
- 🔔 **Atualizador integrado** — builds empacotados com electron-builder + GitHub Releases.

---

## 📦 Instalação

### Usuário final

#### 🪟 Windows
1. Baixe o instalador `jv-printer-Setup-x.y.z.exe` no GitHub Releases.
2. Clique com o botão direito → **Executar como administrador**.
3. Conclua o assistente. O JV-Printer inicia sozinho e fica disponível na bandeja.

#### 🐧 Linux (Mint / Ubuntu / Debian)

**Opção 1 - AppImage (portável):**
```bash
chmod +x jv-printer-x.y.z-x64.AppImage
./jv-printer-x.y.z-x64.AppImage
```

**Opção 2 - .deb (instalador):**
```bash
sudo dpkg -i jv-printer-x.y.z-x64.deb
sudo apt-get install -f  # resolver dependências se necessário
```

### Ambiente de desenvolvimento

```bash
git clone https://github.com/JZ-TECH-SYS/gerenciadorImpressaoJV.git
cd gerenciadorImpressaoJV

npm install          # dependências
npm start            # Electron em modo dev

npm run dist         # gera instalador Windows + latest.yml
npm run dist:linux   # gera AppImage + .deb para Linux
```

**Pré-requisitos:**
- **Windows:** Windows 10/11, Node.js 18+, Git e impressora configurada
- **Linux:** Mint/Ubuntu/Debian, Node.js 18+, Git, CUPS instalado e impressora configurada

---

## ⚙️ Configuração inicial

1. Na primeira execução o app abre automaticamente a tela **Configurações**.
2. Informe a **URL da API**, **ID da empresa** e selecione a **impressora**.
3. Clique em **Salvar**. As demais janelas (logs, teste de impressão, ajuda) ficam no menu do tray.

### Permissões úteis

#### 🪟 Windows (PowerShell como Admin)
```powershell
# Habilitar log do spooler (necessário para capturar Job ID)
wevtutil sl Microsoft-Windows-PrintService/Operational /e:true

# Caso o PowerShell esteja bloqueado
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### 🐧 Linux (Terminal)
```bash
# Verificar se CUPS está rodando
sudo systemctl status cups

# Iniciar CUPS se necessário
sudo systemctl start cups && sudo systemctl enable cups

# Adicionar usuário ao grupo de impressão
sudo usermod -aG lpadmin $USER

# Listar impressoras disponíveis
lpstat -p -d

# Interface web do CUPS (configurar impressoras)
# Acesse: http://localhost:631
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
- **Caminho:**
  - 🪟 Windows: `%TEMP%\jv-printer\logs` (ex.: `C:\Users\<user>\AppData\Local\Temp\jv-printer\logs`)
  - 🐧 Linux: `/tmp/jv-printer/logs`
- **Arquivos:**
  - `YYYY-MM-DD-log-sistema.jsonl` → fluxo geral (API, impressão, erros, toasts)
  - `YYYY-MM-DD-log-win.jsonl` → eventos do monitor de jobs (Windows/CUPS)
  - `SOLUCAO_PROBLEMAS.txt` → guia rápido criado automaticamente (com instruções específicas por SO)
- **Viewer interno:** lê os últimos KB, filtra por nível (erro/aviso/info/debug), busca trechos e mostra o conteúdo de impressão dentro de um bloco `<pre>` com rolagem. Registros mais novos aparecem no topo.

Trecho real:

```json
{"timestamp":"2025-11-23T17:20:14.772Z","level":"info","message":"IMPRESSAO - Impressora: MP-4200 TH | JobID: 884","channel":"system","metadata":{"impressora":"MP-4200 TH","jobId":884,"comprimento":3962,"conteudo":"<style>..."}}
```

---

## 🚀 Releases, CI/CD e auto-update

O pipeline usa **GitHub Actions** + **electron-builder** com builds paralelos para Windows e Linux.

### Artefatos gerados automaticamente

| Plataforma | Formato | Arquivo |
|------------|---------|--------|
| 🪟 Windows | NSIS Installer | `jv-printer-Setup-x.y.z.exe` |
| 🐧 Linux | AppImage | `jv-printer-x.y.z-x64.AppImage` |
| 🐧 Linux | Debian/Ubuntu | `jv-printer-x.y.z-x64.deb` |

### Fluxo de release

1. Ajuste a versão em `package.json` (ou rode `node scripts/bumpVersion.js`).
2. `git commit -am "release: vX.Y.Z" && git push`.
3. O workflow `Build & Release` executa:
   - `build-windows` → gera `.exe` + `latest.yml`
   - `build-linux` → gera `.AppImage` + `.deb` + `latest-linux.yml`
   - `release` → publica todos os artefatos no GitHub Releases com tag `vX.Y.Z`
4. O app chama `autoUpdater.checkForUpdatesAndNotify()` ao iniciar; quando encontra release, baixa em background e mostra toast quando pronto para instalar.

> 🔒 **Repositório privado?** O feed `releases.atom` exige acesso público ou um token. Se o app estiver instalado em máquinas sem autenticação GitHub, o auto-update retornará 404. Solução: tornar o release público ou hospedar os artefatos em um endpoint acessível (S3, CDN etc.) e apontar o updater para lá.

### Build manual

```bash
# Windows
npm run dist

# Linux
npm run dist:linux
```
Os artefatos ficam em `dist/`.
 

---

## 🆘 Troubleshooting rápido

### 🪟 Windows
| Sintoma | Ação sugerida |
|---------|---------------|
| Não captura Job ID | Executar `wevtutil sl Microsoft-Windows-PrintService/Operational /e:true` como admin |
| Impressora não aparece na lista | Verificar se está instalada, ligada e sem filas |
| PowerShell bloqueado | Executar `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` |

### 🐧 Linux
| Sintoma | Ação sugerida |
|---------|---------------|
| Impressora não aparece | Verificar CUPS: `sudo systemctl status cups` e `lpstat -p` |
| Sem permissão para imprimir | Adicionar ao grupo: `sudo usermod -aG lpadmin $USER` + logout/login |
| CUPS não instalado | Instalar: `sudo apt install cups cups-client` |
| Configurar impressora | Acessar interface web: `http://localhost:631` |

### Geral
| Sintoma | Ação sugerida |
|---------|---------------|
| API não responde | Checar conectividade, logs `log-sistema.jsonl` e filtro de busca no viewer |
| Auto-update mostra 404 | Confirmar se o release é público ou configure feed alternativo com token |

---

## 🧱 Stack & arquitetura

- **Electron** para UI desktop + tray + notificações.
- **Node.js + PowerShell/CUPS** para comunicação com o spooler:
  - 🪟 Windows: PowerShell + Windows Event Log
  - 🐧 Linux: CUPS (`lp`, `lpstat`)
- **Electron IPC / preload** para expor `logViewer`, `settings` e `testPrint` às páginas HTML.
- **printJobMonitor** (multiplataforma) para capturar Job IDs reais do sistema operacional.

Fluxo macro:

```text
┌─────────────────────────────────────────────────────────────────────┐
│  API → Ticket → Render HTML → BrowserWindow.silentPrint            │
│                                    ↓                                │
│              ┌─────────────────────┴─────────────────────┐          │
│              │           printJobMonitor                 │          │
│              │  🪟 PowerShell    │    🐧 CUPS (lpstat)   │          │
│              └─────────────────────┬─────────────────────┘          │
│                                    ↓                                │
│                        log JSONL → viewer / suporte                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).

---

**🖨️ Impressão Inteligente • 📊 Rastreabilidade Total • 🚀 Automação Completa**  
JZ-TECH-SYS · JV-Printer
