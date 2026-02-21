const { warn, info } = require('../myzap/myzapLogger');
const clonarRepositorio = require('../myzap/clonarRepositorio');
const verificarDiretorio = require('../myzap/verificarDiretorio');
const getConnectionStatus = require('../myzap/api/getConnectionStatus');
const startSession = require('../myzap/api/startSession');
const deleteSession = require('../myzap/api/deleteSession');
const verifyRealStatus = require('../myzap/api/verifyRealStatus');
const updateIaConfig = require('../myzap/api/updateIaConfig');
const iniciarMyZap = require('../myzap/iniciarMyZap');
const {
    prepareAutoConfig,
    ensureMyZapReadyAndStart
} = require('../myzap/autoConfig');
const {
    getUltimosPendentesMyZap,
    startWhatsappQueueWatcher,
    stopWhatsappQueueWatcher,
    getWhatsappQueueWatcherStatus
} = require('../api/whatsappQueueWatcher');

function registerMyZapHandlers(ipcMain) {
    info('IPC MyZap handlers registrados', {
        metadata: { area: 'ipcMyzap' }
    });

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

    ipcMain.handle('myzap:prepareAutoConfig', async (_event, forceRemote = false) => {
        try {
            info('IPC myzap:prepareAutoConfig recebido', {
                metadata: { area: 'ipcMyzap', forceRemote }
            });
            return await prepareAutoConfig({ forceRemote });
        } catch (error) {
            warn('Falha ao preparar configuracao automatica do MyZap via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:ensureStarted', async (_event, forceRemote = false) => {
        try {
            info('IPC myzap:ensureStarted recebido', {
                metadata: { area: 'ipcMyzap', forceRemote }
            });
            return await ensureMyZapReadyAndStart({ forceRemote });
        } catch (error) {
            warn('Falha ao iniciar MyZap automaticamente via IPC', {
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

    ipcMain.handle('myzap:verifyRealStatus', async (event) => {
        try {
            const result = await verifyRealStatus();
            return result;
        } catch (error) {
            warn('Falha ao verificar status real MyZap via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:startSession', async (event) => {
        try {
            const result = await startSession();
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

    ipcMain.handle('myzap:deleteSession', async (event) => {
        try {
            const result = await deleteSession();
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

    ipcMain.handle('myzap:updateIaConfig', async (event, mensagemPadrao) => {
        try {
            const result = await updateIaConfig(mensagemPadrao);
            return result;
        } catch (error) {
            warn('Falha ao atualizar configuracao de IA MyZap via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:startQueueWatcher', async () => {
        try {
            info('IPC myzap:startQueueWatcher recebido', {
                metadata: { area: 'ipcMyzap' }
            });
            return await startWhatsappQueueWatcher();
        } catch (error) {
            warn('Falha ao iniciar watcher de fila MyZap via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:stopQueueWatcher', async () => {
        try {
            info('IPC myzap:stopQueueWatcher recebido', {
                metadata: { area: 'ipcMyzap' }
            });
            return stopWhatsappQueueWatcher();
        } catch (error) {
            warn('Falha ao parar watcher de fila MyZap via IPC', {
                metadata: { error }
            });
            return {
                status: 'error',
                message: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:getQueueWatcherStatus', async () => {
        try {
            return getWhatsappQueueWatcherStatus();
        } catch (error) {
            warn('Falha ao obter status do watcher de fila MyZap via IPC', {
                metadata: { error }
            });
            return {
                ativo: false,
                processando: false,
                ultimoLote: 0,
                ultimaExecucaoEm: null,
                ultimoErro: error.message || String(error)
            };
        }
    });

    ipcMain.handle('myzap:getQueuePendentes', async () => {
        try {
            return getUltimosPendentesMyZap();
        } catch (error) {
            warn('Falha ao obter pendentes da fila MyZap via IPC', {
                metadata: { error }
            });
            return [];
        }
    });
}

module.exports = {
    registerMyZapHandlers
};
