const { info, warn, error } = require('./utils/logger');

function attachAutoUpdaterHandlers(autoUpdater) {
  autoUpdater.on('error', (err) => {
    error('AutoUpdater falhou', { metadata: { error: err } });
  });

  autoUpdater.on('update-downloaded', () => {
    info('Atualização baixada e aguardando instalação', {
      metadata: { action: 'update-downloaded' }
    });
    try {
      autoUpdater.quitAndInstall();
    } catch (err) {
      warn('Falha ao aplicar atualização automaticamente', {
        metadata: { error: err }
      });
    }
  });
}

module.exports = {
  attachAutoUpdaterHandlers
};