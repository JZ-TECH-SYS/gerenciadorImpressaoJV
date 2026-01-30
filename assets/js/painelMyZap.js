(async () => {
  try {

    const myzap_diretorio = (await window.api.getStore('myzap_diretorio')) ?? '';
    const myzap_sessionKey = (await window.api.getStore('myzap_sessionKey')) ?? '';
    const myzap_apiToken = (await window.api.getStore('myzap_apiToken')) ?? '';
    const myzap_envContent = (await window.api.getStore('myzap_envContent')) ?? '';

    const statusConfig = document.getElementById('status-config');
    if (myzap_diretorio && myzap_sessionKey && myzap_apiToken && myzap_envContent) {
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
    setInstalled(hasFiles.status === 'success');
    // document.getElementById('btn-install').disabled = (hasFiles.status === 'success');
    document.getElementById('btn-start').disabled = !(hasFiles.status === 'success');

    if (hasFiles.status === 'success') {
      const statusApi = document.getElementById('status-api');
      statusApi.innerHTML = `
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            Verificando...
        `;

      const start = await window.api.iniciarMyZap(String(myzap_diretorio));
      const btnStart = document.getElementById('btn-start');


      statusApi.textContent = start.message || 'Erro ao iniciar MyZap!';
      statusApi.classList.remove('bg-secondary');
      statusApi.classList.add(start.status === 'success' ? 'bg-success' : 'bg-danger');
      btnStart.disabled = (start.status == 'success');
    }


    document.getElementById('input-path').value = myzap_diretorio;
    document.getElementById('input-sessionkey').value = myzap_sessionKey;
    document.getElementById('input-apitoken').value = myzap_apiToken;
    document.getElementById('input-env').value = myzap_envContent;
  } catch (e) {
    alert('Erro ao carregar configurações: ' + (e?.message || e));
  }
})();

const cfg_myzap = document.getElementById('myzap-config-form');

cfg_myzap.onsubmit = (e) => {
  e.preventDefault();

  const myzap_diretorio = document.getElementById('input-path').value.trim();
  const myzap_sessionKey = document.getElementById('input-sessionkey').value.trim();
  const myzap_apiToken = document.getElementById('input-apitoken').value.trim();
  const myzap_envContent = document.getElementById('input-env').value.trim();

  window.api.send('myzap-settings-saved', {
    myzap_diretorio,
    myzap_sessionKey,
    myzap_apiToken,
    myzap_envContent
  });

  alert('Configurações salvas!');
  window.close();
};

function atualizaStatus() {
  window.location.reload();
}

function setInstalled(isInstalled) {
  const dropdownBtn = document.getElementById("btn-install-dropdown");
  const mainBtn = document.getElementById("btn-install");

  if (isInstalled) {
    dropdownBtn.classList.remove("d-none");
    mainBtn.innerText = "Instalado";
    mainBtn.classList.remove("btn-primary");
    mainBtn.classList.add("btn-success");
    mainBtn.disabled = true;
  } else {
    dropdownBtn.classList.add("d-none");
    mainBtn.innerText = "Instalar";
    mainBtn.classList.remove("btn-success");
    mainBtn.classList.add("btn-primary");
    mainBtn.disabled = false;
  }
}

async function installMyZap() {
  const myzap_diretorio = (await window.api.getStore('myzap_diretorio')) ?? '';
  const myzap_envContent = (await window.api.getStore('myzap_envContent')) ?? '';

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
      String(myzap_diretorio),
      String(myzap_envContent)
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

async function reinstallMyZap() {
  if (!confirm("Deseja reinstalar o MyZap? Isso substituirá a instalação atual.")) {
    return;
  }

  const myzap_diretorio = (await window.api.getStore('myzap_diretorio')) ?? '';
  const myzap_envContent = (await window.api.getStore('myzap_envContent')) ?? '';

  if (!myzap_diretorio) {
    alert('Por favor, salve as configurações antes de re-instalar o MyZap.');
    return;
  }

  // 1. Elementos da UI
  const btnInstall = document.getElementById('btn-install');
  const btnReInstall = document.getElementById('btn-reinstall');
  const btnStart = document.getElementById('btn-start');
  const btnRefresh = document.getElementById('btn-refresh-status');
  const statusBadge = document.getElementById('status-installation');
  const statusRunBadge = document.getElementById('status-api');
  const dropdownBtn = document.getElementById("btn-install-dropdown");

  // Guardamos o texto original para restaurar em caso de erro
  const originalBtnText = btnInstall.innerHTML;
  const originalBadgeText = statusBadge.textContent;
  const originalBadgeClass = statusBadge.className;

  try {
    btnInstall.disabled = true;
    btnStart.disabled = true;
    btnReInstall.disabled = true;
    dropdownBtn.disabled = true;
    btnRefresh.disabled = true;

    btnInstall.innerHTML = `
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            Re-Instalando...
        `;

    statusBadge.textContent = 'Baixando arquivos...';
    statusBadge.className = 'badge bg-warning text-dark status-badge';

    statusRunBadge.textContent = 'Aguardando reinstalação...';
    statusRunBadge.className = 'badge bg-secondary status-badge';

    const clone = await window.api.cloneRepository(
      String(myzap_diretorio),
      String(myzap_envContent),
      true
    );

    if (clone.status === 'error') {
      throw new Error(clone.message || 'Erro desconhecido');
    }

    statusBadge.textContent = 'MyZap se encontra no diretório configurado!';
    statusBadge.className = 'badge bg-success status-badge';

    setTimeout(() => {
      alert('MyZap re-instalado com sucesso!');
      atualizaStatus();
    }, 500);

  } catch (error) {
    console.error(error);
    alert('Erro ao re-instalar MyZap: ' + error.message);

    btnInstall.innerHTML = originalBtnText;
    btnInstall.disabled = false;

    statusBadge.textContent = 'Falha na instalação';
    statusBadge.className = 'badge bg-danger status-badge';
    setTimeout(() => {
      atualizaStatus();
    }, 1500);
  }
}