const { execSync, spawn } = require('child_process');
const net = require('net');
const os = require('os');

function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true);
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(false);
        });

        server.listen(port);
    });
}

function parsePids(text) {
    const pids = new Set();
    const matches = String(text || '').match(/\b\d+\b/g) || [];
    for (const match of matches) {
        const pid = Number(match);
        if (Number.isInteger(pid) && pid > 0) {
            pids.add(pid);
        }
    }
    return [...pids];
}

function parsePidsByLine(text) {
    const pids = new Set();
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
        if (/^\d+$/.test(line)) {
            const pid = Number(line);
            if (pid > 0) {
                pids.add(pid);
            }
        }
    }
    return [...pids];
}

function getPidsOnPortWindows(port) {
    try {
        const stdout = execSync(`netstat -ano | findstr :${port}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
        const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const pids = new Set();
        for (const line of lines) {
            const parts = line.split(/\s+/);
            const pid = Number(parts[parts.length - 1]);
            if (Number.isInteger(pid) && pid > 0) {
                pids.add(pid);
            }
        }
        return [...pids];
    } catch (_e) {
        return [];
    }
}

function getPidsOnPortUnix(port) {
    try {
        const stdout = execSync(`lsof -ti tcp:${port}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
        const pids = parsePidsByLine(stdout);
        if (pids.length > 0) {
            return pids;
        }
    } catch (_e) {
        // tenta fuser
    }

    try {
        const stdout = execSync(`fuser ${port}/tcp 2>/dev/null`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
        const afterColon = stdout.includes(':') ? stdout.split(':').pop() : stdout;
        const pids = parsePids(afterColon);
        if (pids.length > 0) {
            return pids;
        }
    } catch (_e) {
        // sem pids
    }

    return [];
}

function getPidsOnPort(port) {
    return os.platform() === 'win32'
        ? getPidsOnPortWindows(port)
        : getPidsOnPortUnix(port);
}

function killPid(pid) {
    if (!pid || pid <= 0) {
        return false;
    }

    try {
        if (os.platform() === 'win32') {
            execSync(`taskkill /T /F /PID ${pid}`, { stdio: ['ignore', 'pipe', 'pipe'] });
        } else {
            execSync(`kill -9 ${pid}`, { stdio: ['ignore', 'pipe', 'pipe'] });
        }
        return true;
    } catch (_e) {
        return false;
    }
}

function killProcessesOnPort(port) {
    const pids = getPidsOnPort(port);
    const killed = [];
    const failed = [];

    for (const pid of pids) {
        if (killPid(pid)) {
            killed.push(pid);
        } else {
            failed.push(pid);
        }
    }

    return {
        pids,
        killed,
        failed
    };
}

function commandExists(command) {
    return new Promise((resolve) => {
        const checker = os.platform() === 'win32' ? 'where' : 'which';
        const child = spawn(checker, [command], { shell: false });
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0));
    });
}

async function getPnpmCommand() {
    if (await commandExists('pnpm')) {
        return {
            command: 'pnpm',
            prefixArgs: []
        };
    }

    if (await commandExists('npx')) {
        return {
            command: 'npx',
            prefixArgs: ['pnpm']
        };
    }

    return null;
}

module.exports = {
    isPortInUse,
    killProcessesOnPort,
    commandExists,
    getPnpmCommand
};
