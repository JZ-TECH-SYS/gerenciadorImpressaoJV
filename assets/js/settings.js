(async () => {
  try {
    const selected = (await window.api.getStore('printer')) || '';
    const raw = await window.api.getPrinters();
    const printers = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : [];

    const select = document.getElementById('printer');
    select.innerHTML = '<option value="">Selecione a impressora</option>';

    if (!printers.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Nenhuma impressora encontrada';
      select.appendChild(opt);
    } else {
      printers.forEach((nome) => {
        const opt = document.createElement('option');
        opt.value = nome;
        opt.textContent = nome;
        if (nome === selected) opt.selected = true;
        select.appendChild(opt);
      });
    }

    document.getElementById('idempresa').value = (await window.api.getStore('idempresa')) ?? '';
    document.getElementById('api').value = (await window.api.getStore('apiUrl')) ?? '';
    document.getElementById('token').value = (await window.api.getStore('apiToken')) ?? '';
  } catch (e) {
    alert('Erro ao carregar configurações: ' + (e?.message || e));
  }
})();

const cfg = document.getElementById('cfg');

cfg.onsubmit = (e) => {
  e.preventDefault();

  const idempresa = document.getElementById('idempresa').value.trim();
  const apiUrl = document.getElementById('api').value.trim();
  const apiToken = document.getElementById('token').value.trim();
  const printer = document.getElementById('printer').value;

  if (!apiUrl.startsWith('http')) {
    alert('Link da API inválido');
    return;
  }
  if (!/^\d+$/.test(idempresa)) {
    alert('ID da empresa deve conter apenas números');
    return;
  }

  window.api.send('settings-saved', {
    idempresa,
    apiUrl,
    apiToken,
    printer,
  });

  alert('Configurações salvas!');
  window.close();
};
