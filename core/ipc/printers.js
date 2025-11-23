const { warn } = require('../utils/logger');
const listarImpressoras = require('../impressora/listarImpressoras');

function registerPrinterHandlers(ipcMain) {
  ipcMain.handle('printers:list', async () => {
    try {
      const result = await listarImpressoras();
      if (result.status === 'success' && Array.isArray(result.data)) {
        return result.data;
      }
      return [];
    } catch (error) {
      warn('Falha ao listar impressoras via IPC', {
        metadata: { error }
      });
      return [];
    }
  });
}

module.exports = {
  registerPrinterHandlers
};