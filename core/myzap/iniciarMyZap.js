const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { error: logError } = require("../utils/logger");

/**
 * Verifica se a porta está em uso
 */
function verificarPorta(porta) {
    return new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true); // Porta ocupada (Projeto rodando)
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(false); // Porta livre (Projeto parado)
        });

        server.listen(porta);
    });
}

/**
 * Inicia o MyZap via pnpm start
 */
async function iniciarMyZap(dirPath) {
    try {
        const porta = 5555;
        const estaRodando = await verificarPorta(porta);

        if (estaRodando) {
            console.log(`MyZap já está ativo na porta ${porta}.`);
            return {
                status: "success",
                message: "O MyZap já está em execução."
            };
        }

        console.log("Iniciando MyZap...");

        // Iniciamos o processo de forma independente (detached)
        // para que ele não morra se o processo principal sofrer refresh
        const child = spawn('pnpm', ['start'], {
            cwd: dirPath,
            shell: true,
            detached: false // Mude para true se quiser que ele sobreviva ao fechar o Electron
        });

        // Logs básicos para o console do terminal
        child.stdout.on('data', (data) => console.log(`[MyZap-API]: ${data}`));
        child.stderr.on('data', (data) => console.error(`[MyZap-Err]: ${data}`));

        // Aguarda um curto período para garantir que o processo não morreu no boot
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({
                    status: "success",
                    message: "MyZap iniciado com sucesso!"
                });
            }, 3000);

            child.on('error', (err) => {
                clearTimeout(timeout);
                resolve({
                    status: "error",
                    message: `Falha ao iniciar: ${err.message}`
                });
            });
        });

    } catch (err) {
        logError('Erro ao gerenciar início do MyZap', { metadata: { error: err } });
        return {
            status: "error",
            message: `Erro: ${err.message}`
        };
    }
}

module.exports = iniciarMyZap;