const { warn } = require('../utils/logger');
const clonarRepositorio = require('../myzap/clonarRepositorio');
const verificarDiretorio = require('../myzap/verificarDiretorio');
const getConnectionStatus = require('../myzap/api/getConnectionStatus');
const iniciarMyZap = require('../myzap/iniciarMyZap');

function registerMyZapHandlers(ipcMain) {
    ipcMain.handle('myzap:checkDirectoryHasFiles', async (event, dirPath) => {
        try {
            const result = await verificarDiretorio(dirPath);
            return result;
        } catch (error) {
            warn('Falha ao verificar diretório via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:cloneRepository', async (event, dirPath, envContent, reinstall = false) => {
        try {
            const result = await clonarRepositorio(dirPath, envContent, reinstall);
            return result;
        } catch (error) {
            warn('Falha ao clonar repositório via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:iniciarMyZap', async (event, dirPath) => {
        try {
            const result = await iniciarMyZap(dirPath);
            return result;
        } catch (error) {
            warn('Falha ao iniciar MyZap via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:getConnectionStatus', async (event) => {
        try {
            const result = await getConnectionStatus();
            return result;
        } catch (error) {
            warn('Falha ao verificar conexão MyZap via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });
}

module.exports = {
    registerMyZapHandlers
};