/**
 * Utilitarios de parsing compartilhados entre modulos.
 * Extraido de autoConfig.js e updateIaConfig.js para evitar duplicacao.
 */

/**
 * Interpreta valores booleanos "humanos" (ex: '1', 'sim', 'true', 'ativo').
 * @param {*} value - Valor a interpretar
 * @param {boolean} defaultValue - Valor padrao se nao reconhecido
 * @returns {boolean}
 */
function parseBooleanLike(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const normalized = String(value).trim().toLowerCase();

    if (['1', 'true', 'sim', 'yes', 'y', 'on', 'ativo'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'nao', 'no', 'off', 'inativo'].includes(normalized)) {
        return false;
    }

    return defaultValue;
}

/**
 * Normaliza uma URL base garantindo que termina com '/'.
 * @param {string} url
 * @returns {string}
 */
function normalizeBaseUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.endsWith('/') ? url : `${url}/`;
}

module.exports = {
    parseBooleanLike,
    normalizeBaseUrl
};
