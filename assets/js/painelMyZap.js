(async () => {
  try {
    document.getElementById('input-path').value = (await window.api.getStore('myzap_diretorio')) ?? '';
    document.getElementById('input-port').value = (await window.api.getStore('myzap_porta')) ?? '';
    document.getElementById('input-sessionkey').value = (await window.api.getStore('myzap_sessionKey')) ?? '';
    document.getElementById('input-apitoken').value = (await window.api.getStore('myzap_apiToken')) ?? '';
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

  window.api.send('myzap-settings-saved', {
    myzap_diretorio,
    myzap_porta,
    myzap_sessionKey,
    myzap_apiToken
  });

  alert('Configurações salvas!');
  window.close();
};
