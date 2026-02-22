const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { error: logError, info } = require('./myzapLogger');
const { isPortInUse, getPnpmCommand } = require('./processUtils');

function executarComando(comando, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(comando, args, { cwd, shell: true });

        let stderr = '';

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr.trim() || `Comando "${comando}" finalizou com codigo ${code}.`));
        });
    });
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function aguardarPorta(porta, timeoutMs = 20000, intervalMs = 500) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
        if (await isPortInUse(porta)) {
            return true;
        }
        await wait(intervalMs);
    }
    return false;
}

async function iniciarMyZap(dirPath, options = {}) {
    try {
        const reportProgress = (typeof options.onProgress === 'function')
            ? options.onProgress
            : () => {};
        const porta = 5555;
        reportProgress('Validando se o MyZap ja esta em execucao...', 'check_runtime', {
            percent: 86,
            dirPath,
            porta
        });
        const estaRodando = await isPortInUse(porta);

        if (estaRodando) {
            reportProgress('MyZap ja estava em execucao local.', 'already_running', {
                percent: 95,
                dirPath,
                porta
            });
            return {
                status: 'success',
                message: 'O MyZap ja esta em execucao.'
            };
        }

        reportProgress('Atualizando codigo local do MyZap (git pull)...', 'git_pull', {
            percent: 90,
            dirPath
        });
        const gitDir = path.join(dirPath, '.git');
        if (fs.existsSync(gitDir)) {
            try {
                await executarComando('git', ['pull', 'origin', 'main'], dirPath);
            } catch (gitErr) {
                info('git pull falhou (nao-critico, continuando)', {
                    metadata: { area: 'iniciarMyZap', error: gitErr?.message || String(gitErr) }
                });
            }
        } else {
            info('Diretorio .git nao encontrado, pulando git pull', {
                metadata: { area: 'iniciarMyZap', dirPath }
            });
        }

        const pnpmRunner = await getPnpmCommand();
        if (!pnpmRunner) {
            return {
                status: 'error',
                message: 'PNPM/NPX nao encontrado. Instale Node.js com npm/npx ou PNPM.'
            };
        }

        reportProgress('Subindo processo do MyZap (pnpm start)...', 'run_start', {
            percent: 93,
            dirPath
        });
        const child = spawn(pnpmRunner.command, [...pnpmRunner.prefixArgs, 'start'], {
            cwd: dirPath,
            shell: true,
            detached: false
        });

        child.stdout.on('data', (data) => {
            info('MyZap runtime stdout', {
                metadata: {
                    area: 'iniciarMyZap',
                    output: String(data).trim()
                }
            });
        });
        child.stderr.on('data', (data) => {
            info('MyZap runtime stderr', {
                metadata: {
                    area: 'iniciarMyZap',
                    output: String(data).trim()
                }
            });
        });

        let childError = null;

        child.on('error', (err) => {
            childError = err;
        });

        child.on('exit', (code, signal) => {
            if (typeof code === 'number' && code !== 0) {
                childError = new Error(`MyZap finalizou com codigo ${code} (signal: ${signal || 'nenhum'})`);
            }
        });

        reportProgress('Aguardando MyZap abrir a porta local...', 'wait_port', {
            percent: 96,
            dirPath,
            porta
        });
        const abriuPorta = await aguardarPorta(porta, 20000, 500);

        if (!abriuPorta) {
            return {
                status: 'error',
                message: childError
                    ? `Falha ao iniciar: ${childError.message}`
                    : `MyZap nao abriu a porta ${porta} dentro do tempo esperado.`
            };
        }

        info('MyZap iniciado e porta confirmada', {
            metadata: { porta, dirPath, runner: pnpmRunner.command }
        });
        reportProgress('MyZap iniciado e porta confirmada.', 'ready', {
            percent: 98,
            dirPath,
            porta
        });

        return {
            status: 'success',
            message: 'MyZap iniciado com sucesso!'
        };
    } catch (err) {
        logError('Erro ao gerenciar inicio do MyZap', { metadata: { error: err } });
        return {
            status: 'error',
            message: `Erro: ${err.message}`
        };
    }
}

module.exports = iniciarMyZap;
