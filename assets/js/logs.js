(() => {
    const logFileSelect = document.getElementById('logFile');
    const logContent = document.getElementById('logContent');
    const logMeta = document.getElementById('logMeta');
    const searchInput = document.getElementById('search');
    const pauseBtn = document.getElementById('pauseBtn');
    const scrollStatus = document.getElementById('scrollStatus');
    const filterInputs = Array.from(document.querySelectorAll('.filters input'));

    let currentFile = '';
    let ticker = null;
    let isPaused = false;
    let isUserScrolling = false;
    let lastLogCount = 0;
    
    const LEVEL_CLASSES = ['error', 'warn', 'info', 'debug'];

    const escapeHtml = (value) =>
        String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

    const formatMetadata = (metadata = {}) => {
        const result = { lines: [], content: '' };
        if (typeof metadata !== 'object' || !metadata) return result;

        Object.entries(metadata).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            if (key === 'conteudo' && typeof value === 'string') {
                result.content = value;
                return;
            }
            if (value instanceof Error) {
                result.lines.push(`${key}: ${value.message}`);
                return;
            }
            if (typeof value === 'object') {
                try {
                    result.lines.push(`${key}: ${JSON.stringify(value)}`);
                } catch {
                    result.lines.push(`${key}: [object]`);
                }
                return;
            }
            result.lines.push(`${key}: ${value}`);
        });

        return result;
    };

    const createLogLineElement = (line) => {
        const element = document.createElement('div');
        element.classList.add('log-line');

        let level = 'info';
        let timestamp = '';
        let message = line;
        let metadata = { lines: [], content: '' };

        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                level = (parsed.level || level).toLowerCase();
                timestamp = parsed.timestamp
                    ? new Date(parsed.timestamp).toLocaleString('pt-BR', { hour12: false })
                    : '';
                message = parsed.message || message;
                metadata = formatMetadata(parsed.metadata || {});
            } catch (error) {
                metadata.lines = ['Falha ao interpretar JSON: ' + error.message];
            }
        } else {
            const match = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
            if (match) {
                timestamp = match[1];
                const parsedLevel = match[2].toLowerCase();
                level = LEVEL_CLASSES.includes(parsedLevel) ? parsedLevel : level;
                message = match[3];
            }
        }

        if (!LEVEL_CLASSES.includes(level)) {
            level = 'info';
        }

        const metaHtml = metadata.lines.length
            ? `<div class="log-meta">${metadata.lines
                  .map((line) => `<span>${escapeHtml(line)}</span>`)
                  .join('<br>')}</div>`
            : '';
        const contentHtml = metadata.content
            ? `<pre class="log-content">${escapeHtml(metadata.content)}</pre>`
            : '';

        element.classList.add(level);
        element.innerHTML = `
            <div class="log-header">
                <span class="log-time">${escapeHtml(timestamp)}</span>
                <span class="log-level ${level}">${escapeHtml(level.toUpperCase())}</span>
            </div>
            <div class="log-message">${escapeHtml(message)}</div>
            ${metaHtml}
            ${contentHtml}
        `;

        return element;
    };

    // Detecta se o usuário está no final do scroll
    const isAtBottom = () => {
        const threshold = 100; // pixels de tolerância
        return (
            logContent.scrollHeight - logContent.scrollTop - logContent.clientHeight < threshold
        );
    };

    // Atualiza o status visual
    const updateScrollStatus = () => {
        const atBottom = isAtBottom();
        const status = isPaused 
            ? '⏸️ Atualização pausada' 
            : atBottom 
                ? '⚙️ Auto-atualização ativa | Você está no final do log'
                : '👆 Você está analisando acima | Não recarregando automaticamente';
        
        scrollStatus.textContent = status;
    };

    // Renderização inteligente - só atualiza se não estiver scrollando ou se estiver no final
    const renderLogLines = (lines, smartRender = false) => {
        if (!lines.length) {
            logContent.innerHTML = '';
            logContent.textContent = 'Sem registros para mostrar.';
            lastLogCount = 0;
            return;
        }

        const atBottom = isAtBottom();
        const lineCountChanged = lines.length !== lastLogCount;

        // Se é renderização inteligente e o usuário está scrollando acima, não atualiza
        if (smartRender && !atBottom && lineCountChanged) {
            updateScrollStatus();
            return;
        }

        // Renderiza tudo de novo (reverso chronológico)
        logContent.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const ordered = [...lines].reverse();
        
        ordered.forEach((line) => {
            fragment.appendChild(createLogLineElement(line));
        });
        
        logContent.appendChild(fragment);
        lastLogCount = lines.length;

        // Volta para o final se estava lá antes
        if (atBottom || !smartRender) {
            setTimeout(() => {
                logContent.scrollTop = logContent.scrollHeight;
            }, 0);
        }

        updateScrollStatus();
    };

    async function refreshLog() {
        if (!currentFile || isPaused) return;

        const activeLevels = filterInputs.filter((input) => input.checked).map((input) => input.value);
        const searchTerm = searchInput.value.trim();

        const data = await window.logViewer.readLogTail({
            filename: currentFile,
            levelFilters: activeLevels,
            search: searchTerm
        });

        // Renderização inteligente
        renderLogLines(data.display, true);
        
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

    // Detecta movimento do scroll
    logContent.addEventListener('scroll', () => {
        updateScrollStatus();
    }, { passive: true });

    // Botão pausar/retomar
    pauseBtn.addEventListener('click', () => {
        isPaused = !isPaused;
        pauseBtn.textContent = isPaused ? '▶️ Retomar' : '⏸️ Pausar';
        pauseBtn.style.background = isPaused ? '#664444' : '#447a3d';
        
        if (!isPaused) {
            refreshLog();
            startPolling();
        } else {
            stopPolling();
        }
        
        updateScrollStatus();
    });

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
        lastLogCount = 0;
        isPaused = false;
        pauseBtn.textContent = '⏸️ Pausar';
        pauseBtn.style.background = '#447a3d';
        refreshLog();
        startPolling();
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
