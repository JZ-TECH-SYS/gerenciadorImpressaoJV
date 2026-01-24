const { warn } = require('../utils/logger');
const verificarDiretorio = require('../myzap/verificarDiretorio');

function registerMyZapHandlers(ipcMain) {
    ipcMain.handle('myzap:checkDirectoryHasFiles', async (event, dirPath) => {
        try {
            console.log('IPC recebido para verificar diretório MyZap:', dirPath);
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
}

module.exports = {
    registerMyZapHandlers
};