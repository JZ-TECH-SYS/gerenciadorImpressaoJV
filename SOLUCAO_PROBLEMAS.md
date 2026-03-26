# 🔧 GUIA DE SOLUÇÃO DE PROBLEMAS - Sistema de Impressão JV

## 📋 PROBLEMAS DE PERMISSÃO DO WINDOWS

Se o sistema não conseguir capturar os Job IDs do Windows, execute os comandos abaixo:

### ⚡ COMANDOS PARA EXECUTAR COMO ADMINISTRADOR:

**1. Habilitar log de impressão do Windows:**
```
wevtutil sl Microsoft-Windows-PrintService/Operational /e:true
```

**2. Definir política de execução do PowerShell (se necessário):**
```
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**3. Testar se o log está funcionando:**
```
powershell -Command "Get-WinEvent -LogName 'Microsoft-Windows-PrintService/Operational' -MaxEvents 1"
```

### 🔍 COMO EXECUTAR:

1. **Abra o Prompt de Comando como Administrador:**
   - Pressione `Win + R`
   - Digite: `cmd`
   - Pressione `Ctrl + Shift + Enter` (para executar como admin)

2. **Cole e execute cada comando acima**

3. **Reinicie a aplicação JV-Printer**

### 📂 LOCALIZAÇÃO DOS LOGS:

Os logs ficam salvos em:
```
%TEMP%\jv-printer\logs\
```

### 📁 ARQUIVOS DE LOG:

- `YYYY-MM-DD-log-sistema.jsonl` - Eventos gerais do aplicativo
- `YYYY-MM-DD-log-impressora.jsonl` - Eventos de impressão e Job IDs
- `YYYY-MM-DD-log-myzap.jsonl` - Eventos do MyZap / WhatsApp

### 🆘 SE AINDA NÃO FUNCIONAR:

1. Verifique se a impressora está funcionando
2. Faça uma impressão de teste
3. Verifique se aparecem eventos no Visualizador de Eventos do Windows
4. Entre em contato com o suporte técnico

---
**Desenvolvido por JZ-TECH-SYS**
**Sistema de Gerenciamento de Impressão JV**
