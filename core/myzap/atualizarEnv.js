const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const iniciarMyZap = require('./iniciarMyZap');
const { info, error } = require('../utils/logger');

/**
 * Atualiza o .env e reinicia o serviço se necessário
 */
async function atualizarEnv(dirPath, envContent) {
    try {
        const envPath = path.join(dirPath, '.env');

        // 1. Verifica se o projeto está instalado (se a pasta existe)
        if (!fs.existsSync(dirPath)) {
            return { status: 'error', message: 'Projeto não instalado no diretório informado.' };
        }

        // 2. Escreve o novo conteúdo no arquivo .env
        fs.writeFileSync(envPath, envContent, 'utf8');
        info('Arquivo .env atualizado com sucesso.');

        // 3. Tenta matar o processo na porta 5555 para garantir o restart
        try {
            // No Windows, buscamos o PID da porta 5555 e matamos
            const stdout = execSync('netstat -ano | findstr :5555').toString();
            const pid = stdout.split(/\s+/).filter(Boolean).pop();

            if (pid && pid !== '0') {
                info(`Reiniciando MyZap: Finalizando processo antigo (PID: ${pid})`);
                execSync(`taskkill /F /PID ${pid}`);
                // Pequena pausa para o SO liberar a porta
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (e) {
            // Se cair aqui, a porta já estava livre, então não faz nada
        }

        // 4. Inicia o MyZap com as novas configs
        const result = await iniciarMyZap(dirPath);

        return {
            status: 'success',
            message: 'Configurações aplicadas e serviço reiniciado!'
        };

    } catch (err) {
        error('Erro ao atualizar .env', { metadata: { error: err } });
        return { status: 'error', message: `Erro ao atualizar: ${err.message}` };
    }
}

module.exports = atualizarEnv;