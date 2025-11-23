(() => {
  const printerSelect = document.getElementById('printerSelect');
  const testType = document.getElementById('testType');
  const preview = document.getElementById('preview');
  const btnPrint = document.getElementById('btnPrint');
  const btnText = document.getElementById('btnText');
  const resultado = document.getElementById('resultado');
  const customTextArea = document.getElementById('customTextArea');
  const customContent = document.getElementById('customContent');
  const printerCount = document.getElementById('printerCount');

  const templates = {
    simple: `        <style>
            @page {
                size: 80mm auto;
                margin: 0;
            }
            body {
                font-family: monospace;
                font-size: 12pt;
                margin: 10px;
                padding: 0;
            }
        </style>
        <div style="text-align: center;">
            <h2>TESTE DE IMPRESSÃO</h2>
            <p>Data: ${new Date().toLocaleString('pt-BR')}</p>
            <p>─────────────────────</p>
            <p>✅ Impressora funcionando!</p>
            <p>─────────────────────</p>
        </div>`,
    ticket: `        <style>
            @page {
                size: 200mm auto;
                margin: 0;
                padding: 0;
            }
            body {
                font-family: monospace;
                font-size: 12pt;
                margin: 0 0 0 0;
                padding: 0;
                white-space: pre;
                line-height: 1.05;
                font-weight: bold;
            }
            .titulo {
                text-align: center;
                font-weight: bold;
                font-size: 12pt;
                margin: 6px 0;
            }
            .linha {
                border-bottom: 2px dashed #000;
                margin: 0px 0;
            }
            .wrap {
                width: 100%;
            }
        </style>
<div class="wrap">
<div class="titulo">TESTE DE PEDIDO</div>
Pedido de(a) João Silva

Tipo: Teste
Mesa: 01

N Pedido: 99999
Data: ${new Date().toLocaleString('pt-BR')}
__________________________________________

3 - Produto Teste 1
Obs: Item de teste

2 - Produto Teste 2
__________________________________________

Total: R$ 0,00
</div>`
  };

  async function loadPrinters() {
    console.log('[FRONTEND] Carregando impressoras...');
    const printers = await window.testPrint.getPrinters();
    console.log('[FRONTEND] Impressoras recebidas:', printers);

    printerSelect.innerHTML = '';
    printerCount.textContent = printers.length;

    if (printers.length === 0) {
      printerSelect.innerHTML = '<option value="">❌ Nenhuma impressora encontrada</option>';
      const badge = document.querySelector('.stat-card .badge');
      if (badge) {
        badge.className = 'badge bg-danger';
        badge.textContent = 'Erro';
      }
      return;
    }

    printers.forEach((p, index) => {
      const option = document.createElement('option');
      option.value = p;
      option.textContent = `${index + 1}. ${p}`;
      printerSelect.appendChild(option);
    });

    const defaultPrinter = await window.testPrint.getDefaultPrinter();
    console.log('[FRONTEND] Impressora padrão:', defaultPrinter);
    if (defaultPrinter) {
      printerSelect.value = defaultPrinter;
    }
  }

  function updatePreview() {
    const type = testType.value;

    if (type === 'custom') {
      customTextArea.style.display = 'block';
      const content = customContent.value || 'Digite seu HTML personalizado...';
      preview.textContent = content;
    } else {
      customTextArea.style.display = 'none';
      preview.textContent = templates[type] || 'Selecione um tipo de teste';
    }
  }

  async function print() {
    const printer = printerSelect.value;
    if (!printer) {
      showAlert('⚠️ Por favor, selecione uma impressora antes de continuar!', 'warning');
      return;
    }

    const type = testType.value;
    let content = '';

    if (type === 'custom') {
      content = customContent.value;
      if (!content.trim()) {
        showAlert('⚠️ Digite o conteúdo HTML personalizado antes de imprimir!', 'warning');
        return;
      }
    } else {
      content = templates[type];
    }

    btnPrint.disabled = true;
    btnText.innerHTML = '<span class="loader"></span> Imprimindo...';

    try {
      const result = await window.testPrint.print(printer, content);
      if (result.success) {
        showAlert(
          `<strong>✅ Impresso com sucesso!</strong><br><br>
                        <strong>Impressora:</strong> ${printer}<br>
                        <strong>Job ID:</strong> ${result.jobId}<br>
                        <strong>Fonte:</strong> ${result.source}`,
          'success'
        );
      } else {
        showAlert(`<strong>❌ Falha na impressão</strong><br><br>${result.error}`, 'danger');
      }
    } catch (error) {
      showAlert(`<strong>❌ Erro ao imprimir</strong><br><br>${error.message}`, 'danger');
    } finally {
      btnPrint.disabled = false;
      btnText.textContent = '🖨️ Imprimir Teste';
    }
  }

  function showAlert(message, type) {
    const alertClass =
      type === 'success' ? 'alert-success' : type === 'danger' ? 'alert-danger' : 'alert-warning';

    resultado.style.display = 'block';
    resultado.className = `alert ${alertClass}`;
    resultado.innerHTML = message;

    setTimeout(() => {
      resultado.style.display = 'none';
    }, 8000);
  }

  testType.addEventListener('change', updatePreview);
  customContent.addEventListener('input', updatePreview);
  btnPrint.addEventListener('click', print);

  loadPrinters();
  updatePreview();
})();