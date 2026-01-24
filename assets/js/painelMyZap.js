(async () => {
  try {

    const myzap_diretorio = (await window.api.getStore('myzap_diretorio')) ?? '';
    const myzap_porta = (await window.api.getStore('myzap_porta')) ?? '';
    const myzap_sessionKey = (await window.api.getStore('myzap_sessionKey')) ?? '';
    const myzap_apiToken = (await window.api.getStore('myzap_apiToken')) ?? '';

    const statusConfig = document.getElementById('status-config');
    if (myzap_diretorio && myzap_porta && myzap_sessionKey && myzap_apiToken) {
      statusConfig.textContent = 'Tudo em ordem!';
      statusConfig.classList.remove('bg-secondary');
      statusConfig.classList.add('bg-success');
    }

    const statusInstallation = document.getElementById('status-installation');

    const hasFiles = await window.api.checkDirectoryHasFiles(
      String(myzap_diretorio)
    );

    statusInstallation.textContent = hasFiles.message || 'Erro na configuração!';
    statusInstallation.classList.remove('bg-secondary');
    statusInstallation.classList.add(hasFiles.status === 'success' ? 'bg-success' : 'bg-danger');


    document.getElementById('input-path').value = myzap_diretorio;
    document.getElementById('input-port').value = myzap_porta;
    document.getElementById('input-sessionkey').value = myzap_sessionKey;
    document.getElementById('input-apitoken').value = myzap_apiToken;
  } catch (e) {
    alert('Erro ao carregar configurações: ' + (e?.message || e));
  }
})();

const cfg_myzap = document.getElementById('myzap-config-form');

cfg_myzap.onsubmit = (e) => {
  e.preventDefault();

  const myzap_diretorio = document.getElementById('input-path').value.trim();
  const myzap_porta = document.getElementById('input-port').value.trim();
  const myzap_sessionKey = document.getElementById('input-sessionkey').value.trim();
  const myzap_apiToken = document.getElementById('input-apitoken').value.trim();

  if (!/^\d+$/.test(myzap_porta)) {
    alert('A porta deve conter apenas números');
    return;
  }
  if (myzap_porta.length > 4) {
    alert('A porta deve conter no máximo 4 dígitos');
    return;
  }

  window.api.send('myzap-settings-saved', {
    myzap_diretorio,
    myzap_porta,
    myzap_sessionKey,
    myzap_apiToken
  });

  alert('Configurações salvas!');
  window.close();
};
