const Store = require("electron-store");
const store = new Store();
const { warn, error, debug } = require('../../utils/logger');

async function startSession() {
    const token = store.get('myzap_apiToken');
    const api = "http://localhost:5555/";
    const session = store.get("myzap_sessionKey");

    if (!token) {
        warn("Token não encontrado", {
            metadata: { area: 'startSession', missing: 'token' }
        });
        return null;
    }

    if (!session) {
        warn("Session não encontrada", {
            metadata: { area: 'startSession', missing: 'session' }
        });
        return null;
    }

    try {
        debug("Iniciando sessão MyZap", {
            metadata: { area: 'startSession', session }
        });

        const res = await fetch(`${api}start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                sessionkey: 1
            },
            body: JSON.stringify({ session })
        });

        const data = await res.json();
        return data;

    } catch (e) {
        error("Erro ao iniciar sessão MyZap", {
            metadata: { area: 'startSession', error: e }
        });
        return null;
    }
}

module.exports = startSession;