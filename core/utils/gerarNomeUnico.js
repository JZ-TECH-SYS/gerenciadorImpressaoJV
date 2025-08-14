function gerarNomeUnico(ext = "tmp") {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 10000);
    return `arquivo_${ts}_${rand}.${ext}`;
}

module.exports = { gerarNomeUnico };
