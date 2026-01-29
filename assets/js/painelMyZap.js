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
    document.getElementById('btn-install').disabled = (hasFiles.status === 'success');
    document.getElementById('btn-start').disabled = !(hasFiles.status === 'success');

    if (hasFiles.status === 'success') {
      const start = await window.api.iniciarMyZap(String(myzap_diretorio));
      const btnStart = document.getElementById('btn-start');
      const statusApi = document.getElementById('status-api');

      statusApi.textContent = start.message || 'Erro ao iniciar MyZap!';
      statusApi.classList.remove('bg-secondary');
      statusApi.classList.add(start.status === 'success' ? 'bg-success' : 'bg-danger');
      btnStart.disabled = (start.status !== 'success');
    }


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

function atualizaStatus() {
  window.location.reload();
}

async function installMyZap() {
  const myzap_diretorio = (await window.api.getStore('myzap_diretorio')) ?? '';

  if (!myzap_diretorio) {
    alert('Por favor, salve as configurações antes de instalar o MyZap.');
    return;
  }

  // 1. Elementos da UI
  const btnInstall = document.getElementById('btn-install');
  const btnStart = document.getElementById('btn-start'); // Vamos bloquear esse também por segurança
  const statusBadge = document.getElementById('status-installation');

  // Guardamos o texto original para restaurar em caso de erro
  const originalBtnText = btnInstall.innerHTML;
  const originalBadgeText = statusBadge.textContent;
  const originalBadgeClass = statusBadge.className;

  try {
    btnInstall.disabled = true;
    btnStart.disabled = true;

    btnInstall.innerHTML = `
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            Instalando...
        `;

    statusBadge.textContent = 'Baixando arquivos...';
    statusBadge.className = 'badge bg-warning text-dark status-badge';

    const clone = await window.api.cloneRepository(
      String(myzap_diretorio)
    );

    if (clone.status === 'error') {
      throw new Error(clone.message || 'Erro desconhecido');
    }

    statusBadge.textContent = 'MyZap se encontra no diretório configurado!';
    statusBadge.className = 'badge bg-success status-badge';

    setTimeout(() => {
      alert('MyZap instalado com sucesso!');
      atualizaStatus();
    }, 500);

  } catch (error) {
    console.error(error);
    alert('Erro ao instalar MyZap: ' + error.message);

    btnInstall.innerHTML = originalBtnText;
    btnInstall.disabled = false;

    statusBadge.textContent = 'Falha na instalação';
    statusBadge.className = 'badge bg-danger status-badge';
  }
}