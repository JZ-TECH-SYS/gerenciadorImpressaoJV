<h1 align="center">
<br>
  <img src="build/icon.png" alt="JV-Printer" width="120">
<br>
<br>
🖨️ JV-Printer - Sistema de Gerenciamento de Impressão
</h1>

<p align="center">
  <strong>Sistema avançado de gerenciamento e monitoramento de impressão com rastreabilidade completa</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-20+-blue?style=flat&logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/Node.js-18+-green?style=flat&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Windows-10/11-blue?style=flat&logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat" alt="License">
</p>

---

## 🚀 **Funcionalidades Principais**

### ✨ **Impressão Automatizada**
- 🔄 Monitoramento contínuo de API para novos tickets
- 🖨️ Impressão automática em impressoras configuradas
- ⚡ Processamento em tempo real

### 📊 **Rastreabilidade Completa**
- 🆔 **Job IDs do Windows** - Captura automaticamente o ID real da impressão
- 📋 **Logs Duplos** - Sistema próprio + logs nativos do Windows
- 🕐 **Timestamps Brasileiros** - Data/hora em formato pt-BR
- 📄 **Conteúdo HTML** - Registro completo do que foi impresso

### 🛠️ **Interface Amigável**
- 🎛️ Controle via ícone na bandeja do sistema
- ⚙️ Configuração simples de API e impressora
- 📂 Acesso rápido aos logs
- ❓ Sistema de ajuda integrado

---

## 📦 **Instalação**

### **Pré-requisitos**
- Windows 10/11
- Node.js 18+ (apenas para desenvolvimento)
- Impressora configurada no sistema

### **Instalação do Executável (Recomendado)**
1. Baixe o arquivo `jv-printer-setup.exe`
2. **Execute como Administrador** (clique direito → "Executar como administrador")
3. Siga o assistente de instalação
4. O aplicativo será iniciado automaticamente

### **Instalação para Desenvolvimento**
```bash
# Clone o repositório
git clone https://github.com/JZ-TECH-SYS/gerenciadorImpressaoJV.git

# Instale as dependências
npm install

# Execute em modo desenvolvimento
npm start

# Gere o executável
npm run build
```

---

## ⚙️ **Configuração Inicial**

### **1. Primeira Execução**
- O sistema abrirá automaticamente a tela de configurações
- Configure a **URL da API** e **ID da empresa**
- Selecione a **impressora** desejada

### **2. Configuração da Impressora**
```bash
# Compartilhar impressora (opcional - para rede)
1. Painel de Controle → Dispositivos e Impressoras
2. Clique direito na impressora → Propriedades
3. Aba "Compartilhamento" → Marcar "Compartilhar esta impressora"
4. Nome: "impressjv" (recomendado)
```

### **3. Permissões (se necessário)**
Se houver problemas de permissão, execute como administrador:
```cmd
# Habilitar logs do Windows
wevtutil sl Microsoft-Windows-PrintService/Operational /e:true

# Configurar PowerShell (se necessário)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## 🖱️ **Como Usar**

### **Menu da Bandeja do Sistema**
Clique direito no ícone 🖨️ na bandeja:

- **⚙️ Configurações** - Alterar API, impressora, etc.
- **▶️ Iniciar Impressão** - Ativar monitoramento automático
- **⛔ Parar Impressão** - Pausar o serviço
- **📄 Ver Logs** - Visualizar logs em tempo real
- **📁 Abrir Pasta de Logs** - Acessar arquivos de log
- **❓ Ajuda (Problemas)** - Guia de solução de problemas

### **Funcionamento Automático**
1. Configure a API e impressora
2. Clique em "▶️ Iniciar Impressão"
3. O sistema monitora automaticamente a API
4. Novos tickets são impressos instantaneamente
5. Tudo é registrado nos logs

---

## 📋 **Logs e Monitoramento**

### **📂 Localização dos Logs**
```
%TEMP%\jv-printer\logs\
(Geralmente: C:\Users\[USUARIO]\AppData\Local\Temp\jv-printer\logs\)
```

### **📄 Tipos de Arquivos de Log**
- **`YYYY-MM-DD-log-sistema.log`** - Logs do sistema de impressão
- **`YYYY-MM-DD-log-win.log`** - Logs dos Job IDs do Windows
- **`SOLUCAO_PROBLEMAS.txt`** - Guia de ajuda (criado automaticamente)

### **🔍 Exemplo de Log**
```
[13/08/2025, 14:30:25] IMPRESSAO - Impressora: EPSON_L3150 | Tamanho: 1024 chars | JobID: 157
[13/08/2025, 14:30:25] [PRINT-HTML] Conteúdo: <html><body>...conteúdo completo...</body></html>
[13/08/2025, 14:30:26] ✅ SUCESSO → "EPSON_L3150" | Windows JobID: 157
```

---

## 🆘 **Solução de Problemas**

### **❌ Erro: "Não consegue capturar Job IDs"**
1. Execute como administrador
2. Execute: `wevtutil sl Microsoft-Windows-PrintService/Operational /e:true`
3. Reinicie a aplicação

### **❌ Erro: "PowerShell restrito"**
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### **❌ Erro: "Impressora não encontrada"**
1. Verifique se a impressora está instalada e funcionando
2. Faça uma impressão de teste pelo Windows
3. Reconfigure a impressora nas configurações

### **📞 Suporte**
- Clique em **"❓ Ajuda (Problemas)"** no menu para guia detalhado
- Entre em contato com **JZ-TECH-SYS**

---

## 🛠️ **Arquitetura Técnica**

### **📦 Tecnologias Utilizadas**
- **Electron** - Interface desktop multiplataforma
- **Node.js** - Runtime JavaScript
- **PowerShell** - Integração com sistema Windows
- **Windows Event Log** - Captura de Job IDs nativos

### **🔄 Fluxo de Funcionamento**
```
API → Consulta Tickets → Processa HTML → Envia para Impressora → 
Captura Job ID → Registra Logs → Aguarda Próximo Ciclo
```

### **📊 Estrutura de Logs**
```
Sistema: [TIMESTAMP] ACAO - Detalhes | JobID: XXX
Windows: [TIMESTAMP] JOB_ID_CAPTURADO - JobID: XXX | Impressora: YYY
```

---

## 📄 **Licença**

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

## 🚀 Atualizações Automáticas & CI/CD

Projeto configurado com `electron-builder` + `electron-updater` usando **GitHub Releases** via **GitHub Actions**.

### 🔄 Fluxo
1. Atualize `version` em `package.json`.
2. `git commit -am "bump: v2.0.1"`
3. `git push origin main`
4. Workflow:
  - instala deps
  - roda `npm run dist`
  - publica release com `.exe` + `latest.yml`
5. App chama `autoUpdater.checkForUpdatesAndNotify()` ao iniciar.
6. Download concluído → instala (evento `update-downloaded`).

### 🛠️ Local
```
npm run dist
```
Gera instalador e `latest.yml` em `dist`.

### ✅ Benefícios
* Sem acesso remoto a clientes
* Atualização silenciosa
* Histórico de versões organizado

### 🔐 Token
Usa `secrets.GITHUB_TOKEN` (automático) para publicar.

### ♻️ Versão Automática
Cada push em `main` (sem `[skip ci]`) incrementa o patch da versão e cria uma tag `vX.Y.Z` automaticamente.

---

## �👨‍💻 **Desenvolvido por**

**JZ-TECH-SYS**  
Sistema de Gerenciamento de Impressão JV 

node scripts/bumpVersion.js
git add package.json
git commit -m "release: vX.Y.Z"
git push origin main


---

<p align="center">
  <strong>🖨️ Impressão Inteligente • 📊 Rastreabilidade Total • 🚀 Automação Completa</strong>
</p>
