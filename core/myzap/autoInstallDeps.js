/**
 * Modulo de auto-instalacao de dependencias (Git e Node.js).
 *
 * No Windows: baixa instaladores oficiais via HTTPS e executa silenciosamente.
 * No Linux:   usa o gerenciador de pacotes do sistema (apt, dnf, pacman).
 *
 * Cada funcao retorna { ok: boolean, message: string }.
 */

const { spawn, execSync } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { info, warn, error: logError } = require('./myzapLogger');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Segue redirecionamentos HTTPS e salva o arquivo no disco.
 * Suporta ate 10 redirecionamentos.
 */
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const maxRedirects = 10;
        let redirectCount = 0;

        function doRequest(currentUrl) {
            const client = currentUrl.startsWith('https') ? https : http;
            client.get(currentUrl, (res) => {
                // Seguir redirecionamentos (301, 302, 303, 307, 308)
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    redirectCount++;
                    if (redirectCount > maxRedirects) {
                        reject(new Error('Limite de redirecionamentos excedido'));
                        return;
                    }
                    let nextUrl = res.headers.location;
                    if (nextUrl.startsWith('/')) {
                        const parsed = new URL(currentUrl);
                        nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
                    }
                    res.resume();
                    doRequest(nextUrl);
                    return;
                }

                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode} ao baixar ${currentUrl}`));
                    return;
                }

                const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
                let downloadedBytes = 0;

                const file = fs.createWriteStream(destPath);
                res.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (onProgress && totalBytes > 0) {
                        const pct = Math.round((downloadedBytes / totalBytes) * 100);
                        onProgress(pct, downloadedBytes, totalBytes);
                    }
                });
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve(destPath)));
                file.on('error', (err) => {
                    fs.unlink(destPath, () => {});
                    reject(err);
                });
            }).on('error', reject);
        }

        doRequest(url);
    });
}

/**
 * Executa um comando e aguarda finalizacao.
 * Retorna { ok: boolean, code: number, stdout: string, stderr: string }
 */
function runCommand(command, args, options = {}) {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';

        const proc = spawn(command, args, { shell: true, ...options });

        if (proc.stdout) {
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
        }
        if (proc.stderr) {
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
        }

        proc.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }));
        proc.on('error', (err) => resolve({ ok: false, code: -1, stdout, stderr: err.message }));
    });
}

/**
 * Atualiza o PATH do processo atual para incluir novos caminhos
 * de instalacoes recem-feitas (sem precisar reiniciar o app).
 */
function refreshPathWindows() {
    try {
        // Pega PATH atualizado do registro do sistema
        const systemPath = execSync(
            'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path',
            { stdio: ['ignore', 'pipe', 'pipe'] }
        ).toString();

        const userPath = execSync(
            'reg query "HKCU\\Environment" /v Path',
            { stdio: ['ignore', 'pipe', 'pipe'] }
        ).toString();

        const extractValue = (regOutput) => {
            const match = regOutput.match(/REG_(?:EXPAND_)?SZ\s+(.+)/i);
            return match ? match[1].trim() : '';
        };

        const newPathStr = [extractValue(systemPath), extractValue(userPath)]
            .filter(Boolean)
            .join(';');

        if (newPathStr) {
            process.env.PATH = newPathStr;
            info('PATH do processo atualizado apos instalacao', {
                metadata: { area: 'autoInstallDeps' }
            });
        }
    } catch (err) {
        warn('Nao foi possivel atualizar PATH do processo', {
            metadata: { area: 'autoInstallDeps', error: err.message }
        });
    }
}

// ─── Instalacao do Git ─────────────────────────────────────────────────────────

/**
 * Busca a URL do instalador mais recente do Git para Windows (64-bit).
 * Usa a API do GitHub para pegar o release mais recente.
 */
function getGitInstallerUrl() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/git-for-windows/git/releases/latest',
            headers: { 'User-Agent': 'JV-Printer-App' }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    const asset = release.assets.find((a) =>
                        a.name.match(/Git-.*-64-bit\.exe$/i)
                    );
                    if (asset) {
                        resolve(asset.browser_download_url);
                    } else {
                        reject(new Error('Nao encontrou instalador 64-bit do Git no release'));
                    }
                } catch (err) {
                    reject(new Error(`Erro ao parsear resposta do GitHub: ${err.message}`));
                }
            });
        }).on('error', reject);
    });
}

async function installGitWindows(reportProgress) {
    reportProgress('Buscando versao mais recente do Git...', 'installing_git', { percent: 12 });

    let installerUrl;
    try {
        installerUrl = await getGitInstallerUrl();
    } catch (err) {
        logError('Falha ao buscar URL do instalador do Git', {
            metadata: { area: 'autoInstallDeps', error: err.message }
        });
        return { ok: false, message: `Falha ao buscar instalador do Git: ${err.message}` };
    }

    const tmpDir = os.tmpdir();
    const installerPath = path.join(tmpDir, 'git-installer.exe');

    reportProgress('Baixando instalador do Git...', 'installing_git', { percent: 15 });
    info('Baixando Git', { metadata: { area: 'autoInstallDeps', url: installerUrl } });

    try {
        await downloadFile(installerUrl, installerPath, (pct) => {
            reportProgress(`Baixando Git... ${pct}%`, 'installing_git', { percent: 15 + Math.round(pct * 0.1) });
        });
    } catch (err) {
        logError('Falha ao baixar instalador do Git', {
            metadata: { area: 'autoInstallDeps', error: err.message }
        });
        return { ok: false, message: `Falha ao baixar Git: ${err.message}` };
    }

    reportProgress('Instalando Git (silencioso)...', 'installing_git', { percent: 26 });
    info('Executando instalador do Git silenciosamente', { metadata: { area: 'autoInstallDeps' } });

    // Instalacao silenciosa do Git — /VERYSILENT nao mostra janela, /NORESTART evita reiniciar
    const result = await runCommand(installerPath, [
        '/VERYSILENT',
        '/NORESTART',
        '/NOCANCEL',
        '/SP-',
        '/CLOSEAPPLICATIONS',
        '/RESTARTAPPLICATIONS',
        '/COMPONENTS=icons,ext\\reg\\shellhere,assoc,assoc_sh'
    ]);

    // Limpa instalador
    try { fs.unlinkSync(installerPath); } catch (_e) { /* ok */ }

    if (!result.ok) {
        logError('Instalacao do Git falhou', {
            metadata: { area: 'autoInstallDeps', code: result.code, stderr: result.stderr }
        });
        return { ok: false, message: `Instalacao do Git falhou (code ${result.code})` };
    }

    // Atualiza PATH para reconhecer o git recem-instalado
    refreshPathWindows();

    info('Git instalado com sucesso', { metadata: { area: 'autoInstallDeps' } });
    return { ok: true, message: 'Git instalado com sucesso!' };
}

async function installGitLinux(reportProgress) {
    reportProgress('Instalando Git via gerenciador de pacotes...', 'installing_git', { percent: 15 });

    // Detecta gerenciador de pacotes
    let cmd, args;
    try {
        execSync('which apt-get', { stdio: 'ignore' });
        cmd = 'sudo';
        args = ['apt-get', 'install', '-y', 'git'];
    } catch (_e1) {
        try {
            execSync('which dnf', { stdio: 'ignore' });
            cmd = 'sudo';
            args = ['dnf', 'install', '-y', 'git'];
        } catch (_e2) {
            try {
                execSync('which pacman', { stdio: 'ignore' });
                cmd = 'sudo';
                args = ['pacman', '-S', '--noconfirm', 'git'];
            } catch (_e3) {
                return {
                    ok: false,
                    message: 'Nenhum gerenciador de pacotes suportado encontrado (apt/dnf/pacman). Instale o Git manualmente.'
                };
            }
        }
    }

    const result = await runCommand(cmd, args);
    if (!result.ok) {
        return { ok: false, message: `Falha ao instalar Git via ${args[0]}: ${result.stderr}` };
    }

    info('Git instalado com sucesso via gerenciador de pacotes', { metadata: { area: 'autoInstallDeps' } });
    return { ok: true, message: 'Git instalado com sucesso!' };
}

// ─── Instalacao do Node.js ─────────────────────────────────────────────────────

const NODE_LTS_VERSION = '22.14.0';
const NODE_INSTALLER_URL_WIN = `https://nodejs.org/dist/v${NODE_LTS_VERSION}/node-v${NODE_LTS_VERSION}-x64.msi`;

async function installNodeWindows(reportProgress) {
    const tmpDir = os.tmpdir();
    const installerPath = path.join(tmpDir, `node-v${NODE_LTS_VERSION}-x64.msi`);

    reportProgress('Baixando Node.js LTS...', 'installing_node', { percent: 30 });
    info('Baixando Node.js', { metadata: { area: 'autoInstallDeps', url: NODE_INSTALLER_URL_WIN } });

    try {
        await downloadFile(NODE_INSTALLER_URL_WIN, installerPath, (pct) => {
            reportProgress(`Baixando Node.js... ${pct}%`, 'installing_node', { percent: 30 + Math.round(pct * 0.1) });
        });
    } catch (err) {
        logError('Falha ao baixar instalador do Node.js', {
            metadata: { area: 'autoInstallDeps', error: err.message }
        });
        return { ok: false, message: `Falha ao baixar Node.js: ${err.message}` };
    }

    reportProgress('Instalando Node.js (silencioso)...', 'installing_node', { percent: 42 });
    info('Executando instalador do Node.js silenciosamente', { metadata: { area: 'autoInstallDeps' } });

    // msiexec com /qn = totalmente silencioso, /norestart evita reboot
    const result = await runCommand('msiexec', [
        '/i', `"${installerPath}"`,
        '/qn',
        '/norestart',
        'ADDLOCAL=ALL'
    ]);

    // Limpa instalador
    try { fs.unlinkSync(installerPath); } catch (_e) { /* ok */ }

    if (!result.ok) {
        logError('Instalacao do Node.js falhou', {
            metadata: { area: 'autoInstallDeps', code: result.code, stderr: result.stderr }
        });
        return { ok: false, message: `Instalacao do Node.js falhou (code ${result.code})` };
    }

    // Atualiza PATH para reconhecer o node recem-instalado
    refreshPathWindows();

    info('Node.js instalado com sucesso', { metadata: { area: 'autoInstallDeps' } });
    return { ok: true, message: 'Node.js instalado com sucesso!' };
}

async function installNodeLinux(reportProgress) {
    reportProgress('Instalando Node.js via gerenciador de pacotes...', 'installing_node', { percent: 32 });

    // Tenta NodeSource setup para versao recente, senao usa pacote padrao
    let cmd, args;
    try {
        execSync('which apt-get', { stdio: 'ignore' });
        // Usa nodejs do repositorio padrao (mais simples e seguro)
        cmd = 'sudo';
        args = ['apt-get', 'install', '-y', 'nodejs', 'npm'];
    } catch (_e1) {
        try {
            execSync('which dnf', { stdio: 'ignore' });
            cmd = 'sudo';
            args = ['dnf', 'install', '-y', 'nodejs', 'npm'];
        } catch (_e2) {
            try {
                execSync('which pacman', { stdio: 'ignore' });
                cmd = 'sudo';
                args = ['pacman', '-S', '--noconfirm', 'nodejs', 'npm'];
            } catch (_e3) {
                return {
                    ok: false,
                    message: 'Nenhum gerenciador de pacotes suportado encontrado. Instale o Node.js manualmente.'
                };
            }
        }
    }

    const result = await runCommand(cmd, args);
    if (!result.ok) {
        return { ok: false, message: `Falha ao instalar Node.js via ${args[0]}: ${result.stderr}` };
    }

    info('Node.js instalado com sucesso via gerenciador de pacotes', { metadata: { area: 'autoInstallDeps' } });
    return { ok: true, message: 'Node.js instalado com sucesso!' };
}

// ─── API publica ───────────────────────────────────────────────────────────────

/**
 * Instala o Git automaticamente se nao estiver no sistema.
 * @param {function} reportProgress - callback de progresso
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function installGit(reportProgress = () => {}) {
    if (os.platform() === 'win32') {
        return installGitWindows(reportProgress);
    }
    return installGitLinux(reportProgress);
}

/**
 * Instala o Node.js automaticamente se nao estiver no sistema.
 * @param {function} reportProgress - callback de progresso
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function installNode(reportProgress = () => {}) {
    if (os.platform() === 'win32') {
        return installNodeWindows(reportProgress);
    }
    return installNodeLinux(reportProgress);
}

module.exports = {
    installGit,
    installNode
};
