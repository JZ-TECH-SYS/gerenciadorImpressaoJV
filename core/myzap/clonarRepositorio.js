const { spawn } = require('child_process');
const { error: logError } = require("../utils/logger");

// 1. Verifica se existe
function verificarDependencia(comando) {
    return new Promise((resolve) => {
        const check = spawn(comando, ['--version']);
        check.on('error', () => resolve(false));
        check.on('close', (code) => resolve(code === 0));
    });
}

// 2. Tenta instalar via Winget (Apenas Windows)
function tentarInstalar(programa) {
    return new Promise((resolve) => {
        console.log(`Tentando instalar ${programa}...`);

        // IDs oficiais do Winget
        const wingetIds = {
            'git': 'Git.Git',
            'node': 'OpenJS.NodeJS.LTS' // Versão LTS é mais segura
        };

        const id = wingetIds[programa];
        if (!id) return resolve(false);

        // Comando para instalar silenciosamente e aceitar termos
        const install = spawn('winget', [
            'install',
            '--id', id,
            '-e',
            '--source', 'winget',
            '--accept-package-agreements',
            '--accept-source-agreements',
            '--silent' // Tenta não abrir janelas, mas pode pedir permissão de Admin
        ]);

        install.stdout.on('data', (data) => console.log(`Instalando ${programa}: ${data}`));
        install.stderr.on('data', (data) => console.log(`Log Instalação: ${data}`));

        install.on('close', (code) => {
            // Winget retorna 0 para sucesso
            resolve(code === 0);
        });

        install.on('error', (err) => {
            console.error(err);
            resolve(false);
        });
    });
}

async function clonarRepositorio(dirPath) {
    try {
        // --- BLOCO DE VERIFICAÇÃO E INSTALAÇÃO DO GIT ---
        let gitExiste = await verificarDependencia('git');

        if (!gitExiste) {
            // Tenta instalar
            const instalou = await tentarInstalar('git');
            if (!instalou) {
                return {
                    status: "error",
                    message: "Erro: Git não encontrado e falha na instalação automática. Por favor, instale o Git manualmente."
                };
            }
        }

        // --- BLOCO DE VERIFICAÇÃO E INSTALAÇÃO DO NODE ---
        let nodeExiste = await verificarDependencia('node');

        if (!nodeExiste) {
            const instalou = await tentarInstalar('node');
            if (instalou) {
                return {
                    status: "error",
                    message: "Node.js instalado com sucesso! Por favor, FECHE e ABRA o aplicativo novamente."
                };
            } else {
                return {
                    status: "error",
                    message: "Erro: Node.js não encontrado e falha na instalação automática."
                };
            }
        }

        // --- EXECUÇÃO DO CLONE (Se chegou aqui, tudo existe) ---
        return new Promise((resolve) => {
            const repoUrl = 'https://github.com/JZ-TECH-SYS/myzap.git';
            const git = spawn('git', ['clone', repoUrl, dirPath], { shell: true });

            let errorOutput = '';

            git.stderr.on('data', (data) => errorOutput += data.toString());
            git.on('error', (err) => {
                logError('Erro git', { metadata: { error: err } });
                resolve({ status: "error", message: err.message });
            });

            git.on('close', (code) => {
                if (code === 0) {
                    resolve({ status: "success", message: "MyZap foi instalado!" });
                } else {
                    resolve({
                        status: "error",
                        message: `Erro ao clonar (Código ${code}): ${errorOutput}`
                    });
                }
            });
        });

    } catch (err) {
        logError('Erro crítico', { metadata: { error: err } });
        return { status: "error", message: `Erro: ${err.message}` };
    }
}

module.exports = clonarRepositorio;