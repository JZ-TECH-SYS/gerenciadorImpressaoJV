(() => {
    const logFileSelect = document.getElementById('logFile');
    const logContent = document.getElementById('logContent');
    const logMeta = document.getElementById('logMeta');
    const searchInput = document.getElementById('search');
    const filterInputs = Array.from(document.querySelectorAll('.filters input'));

    let currentFile = '';
    let ticker = null;

    async function refreshLog() {
        if (!currentFile) return;

        const activeLevels = filterInputs.filter((input) => input.checked).map((input) => input.value);
        const searchTerm = searchInput.value.trim();

        const data = await window.logViewer.readLogTail({
            filename: currentFile,
            levelFilters: activeLevels,
            search: searchTerm
        });

        logContent.textContent = data.display.join('\n') || 'Sem registros para mostrar.';
        const updatedAt = new Date(data.meta.mtime).toLocaleString('pt-BR');
        const truncado = data.truncated ? ' (arquivo truncado)' : '';
        logMeta.textContent = `Arquivo: ${currentFile} | Tamanho: ${data.meta.size} bytes | Última gravação: ${updatedAt}${truncado}`;
    }

    function startPolling() {
        stopPolling();
        ticker = setInterval(refreshLog, 1500);
    }

    function stopPolling() {
        if (ticker) {
            clearInterval(ticker);
            ticker = null;
        }
    }

    async function populateFiles() {
        const arquivos = await window.logViewer.listLogFiles();
        logFileSelect.innerHTML = '';
        if (!arquivos.length) {
            const option = document.createElement('option');
            option.textContent = 'Sem arquivos disponíveis';
            logFileSelect.appendChild(option);
            logContent.textContent = 'Não há logs para exibir.';
            logMeta.textContent = '';
            return;
        }

        arquivos
            .sort((a, b) => b.mtime - a.mtime)
            .forEach(({ name }) => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                logFileSelect.appendChild(option);
            });

        currentFile = logFileSelect.value;
        refreshLog();
        startPolling();
    }

    logFileSelect.addEventListener('change', () => {
        currentFile = logFileSelect.value;
        refreshLog();
    });

    filterInputs.forEach((input) => {
        input.addEventListener('change', refreshLog);
    });

    searchInput.addEventListener('input', () => {
        refreshLog();
    });

    window.addEventListener('beforeunload', stopPolling);

    populateFiles();
})();
