module.exports = class extends think.Service {
    async uploadHttpsImage(remoteUrl, operatorId = 0) {
        const normalizedOperatorId = Number(operatorId || 0);
        const cosService = think.service('cos', 'admin');
        try {
            const cosUrl = await cosService.fetchAndUpload(remoteUrl);
            console.info(`[uploadHttpsImage] operator=${normalizedOperatorId} target=${remoteUrl} result=success`);
            return cosUrl;
        } catch (error) {
            console.warn(`[uploadHttpsImage] operator=${normalizedOperatorId} target=${remoteUrl} result=failed reason=${error && error.message ? error.message : 'unknown'}`);
            throw error;
        }
    }
};
