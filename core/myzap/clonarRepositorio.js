const { spawn } = require('child_process');
const { error: logError } = require("../utils/logger");
const path = require('path');
const fs = require('fs');

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

async function clonarRepositorio(dirPath, envContent) {
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

        // 5. Configuração de Arquivos (.env e Banco de Dados)
        console.log("Configurando arquivo .env e banco de dados...");

        // Criar arquivo .env com o conteúdo recebido via parâmetro
        const envDest = path.join(dirPath, '.env');
        fs.writeFileSync(envDest, envContent, 'utf8');

        // Caminhos para o Banco de Dados
        // Origem: core\myzap\database\db.sqlite (dentro do seu projeto Electron)
        // Destino: dirPath\database\db.sqlite
        const dbOrigem = path.join(__dirname, 'database', 'db.sqlite');
        const dbDestDir = path.join(dirPath, 'database');
        const dbDestFile = path.join(dbDestDir, 'db.sqlite');

        // Garantir que a pasta database existe no diretório do MyZap
        if (!fs.existsSync(dbDestDir)) {
            fs.mkdirSync(dbDestDir, { recursive: true });
        }

        // Copiar o banco de dados se a origem existir
        if (fs.existsSync(dbOrigem)) {
            fs.copyFileSync(dbOrigem, dbDestFile);
        } else {
            console.warn("Aviso: Banco de dados original não encontrado em " + dbOrigem);
        }

        // 6. Iniciar o projeto
        console.log("Iniciando MyZap...");
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