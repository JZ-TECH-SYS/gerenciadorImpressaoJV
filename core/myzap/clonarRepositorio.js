const { spawn } = require('child_process');
const { error: logError } = require("../utils/logger");
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

// Função auxiliar para rodar comandos shell de forma limpa
function rodarComando(comando, args, opcoes = {}) {
    return new Promise((resolve) => {
        const proc = spawn(comando, args, { shell: true, ...opcoes });

        proc.stdout.on('data', (data) => console.log(`[${comando}]: ${data}`));
        proc.stderr.on('data', (data) => console.error(`[${comando}-err]: ${data}`));

        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
    });
}

function verificarDependencia(comando) {
    return new Promise((resolve) => {
        const check = spawn(comando, ['--version'], { shell: true });
        check.on('error', () => resolve(false));
        check.on('close', (code) => resolve(code === 0));
    });
}

function tentarInstalar(programa) {
    const wingetIds = {
        'git': 'Git.Git',
        'node': 'OpenJS.NodeJS.LTS'
    };
    const id = wingetIds[programa];
    if (!id) return Promise.resolve(false);

    return rodarComando('winget', [
        'install', '--id', id, '-e', '--source', 'winget',
        '--accept-package-agreements', '--accept-source-agreements', '--silent'
    ]);
}

async function clonarRepositorio(dirPath) {
    try {
        // 1. Verificações de Ambiente
        if (!(await verificarDependencia('git'))) {
            if (!(await tentarInstalar('git'))) return { status: "error", message: "Falha ao instalar Git." };
        }
        if (!(await verificarDependencia('node'))) {
            if (!(await tentarInstalar('node'))) return { status: "error", message: "Falha ao instalar Node.js." };
        }

        // 2. Clone do Repositório
        const repoUrl = 'https://github.com/JZ-TECH-SYS/myzap.git';
        console.log("Iniciando clone...");
        const clonou = await rodarComando('git', ['clone', repoUrl, dirPath]);

        if (!clonou) {
            return { status: "error", message: "Erro ao clonar o repositório. Verifique se a pasta já existe." };
        }

        // 3. Instalar PNPM Globalmente
        console.log("Instalando pnpm globalmente...");
        const pnpmGlobal = await rodarComando('npm', ['install', '-g', 'pnpm']);
        if (!pnpmGlobal) {
            return { status: "error", message: "Falha ao instalar pnpm globalmente." };
        }

        // 4. Instalar Dependências do Projeto (pnpm install)
        console.log("Instalando dependências do projeto...");
        // Usamos cwd para garantir que o pnpm rode DENTRO da pasta clonada
        const instalouDeps = await rodarComando('pnpm', ['install'], { cwd: dirPath });

        if (!instalouDeps) {
            return {
                status: "error",
                message: "Repositório clonado, mas houve erro ao instalar dependências (pnpm install)."
            };
        }

        // 5. Manipulação do Arquivo ZIP (Configurações)
        console.log("Configurando arquivos de ambiente e banco de dados...");
        const zipPath = path.join(process.cwd(), 'myzap.zip'); // Arquivo na raiz do Electron

        if (!fs.existsSync(zipPath)) {
            return { status: "error", message: "Arquivo myzap.zip não encontrado na raiz do instalador." };
        }

        const zip = new AdmZip(zipPath);
        const tempDir = path.join(dirPath, 'temp_zip');

        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        zip.extractAllTo(tempDir, true);

        // Caminhos de destino
        const envDest = path.join(dirPath, '.env');
        const dbDestDir = path.join(dirPath, 'database');
        const dbDestFile = path.join(dbDestDir, 'db.sqlite');

        // Garantir que a pasta database existe no destino
        if (!fs.existsSync(dbDestDir)) fs.mkdirSync(dbDestDir, { recursive: true });

        // Mover .env
        const tempEnv = path.join(tempDir, '.env');
        if (fs.existsSync(tempEnv)) {
            fs.copyFileSync(tempEnv, envDest);
        }

        // Mover db.sqlite
        const tempDb = path.join(tempDir, 'db.sqlite');
        if (fs.existsSync(tempDb)) {
            fs.copyFileSync(tempDb, dbDestFile);
        }

        // Limpar pasta temporária
        fs.rmSync(tempDir, { recursive: true, force: true });

        // 6. Iniciar o projeto
        console.log("Iniciando MyZap...");
        // Usamos spawn sem await aqui se quisermos que o Electron continue livre, 
        // ou com await se quisermos esperar o processo fechar.
        rodarComando('pnpm', ['start'], { cwd: dirPath });

        return {
            status: "success",
            message: "MyZap instalado, configurado e iniciado com sucesso!"
        };

    } catch (err) {
        logError('Erro crítico no processo de instalação', { metadata: { error: err } });
        return { status: "error", message: `Erro: ${err.message}` };
    }
}

module.exports = clonarRepositorio;