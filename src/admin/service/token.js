const jwt = require('jsonwebtoken');
const httpClient = require('../../common/utils/http');

const ACCESS_TOKEN_GUARD_SECONDS = 120;
let cachedAccessToken = '';
let cachedAccessTokenExpireAt = 0;

module.exports = class extends think.Service {
    getSecurityConfig() {
        return think.config('security') || {};
    }
    getTokenSecret() {
        const config = this.getSecurityConfig();
        return String(config.adminTokenSecret || '').trim();
    }
    getLegacyTokenSecrets() {
        const config = this.getSecurityConfig();
        const legacy = config.adminTokenLegacySecrets;
        if (Array.isArray(legacy)) {
            return legacy.map((item) => String(item || '').trim()).filter(Boolean);
        }
        if (typeof legacy === 'string') {
            return legacy.split(',').map((item) => String(item || '').trim()).filter(Boolean);
        }
        return [];
    }
    getVerifySecrets() {
        const merged = [this.getTokenSecret(), ...this.getLegacyTokenSecrets()].filter(Boolean);
        return [...new Set(merged)];
    }
    getTokenAlgorithm() {
        const config = this.getSecurityConfig();
        return String(config.tokenAlgorithm || 'HS256').trim() || 'HS256';
    }
    getTokenExpiresIn() {
        const config = this.getSecurityConfig();
        return config.adminTokenExpiresIn || '12h';
    }
    getWeixinConfig() {
        const config = think.config('weixin') || {};
        return {
            appid: String(config.appid || '').trim(),
            secret: String(config.secret || '').trim()
        };
    }
    ensureWeixinConfig(requiredKeys = [], scene = 'admin.token') {
        const config = this.getWeixinConfig();
        const missing = (Array.isArray(requiredKeys) ? requiredKeys : [])
            .map((key) => String(key || '').trim())
            .filter((key) => key && !config[key]);
        if (missing.length > 0) {
            throw new Error(`[${scene}] missing config: ${missing.join(', ')}`);
        }
        return config;
    }
    /**
     * 根据header中的x-hioshop-token值获取用户id
     */
    async getUserId(token = '') {
        if (!token) {
            return 0;
        }

        const result = await this.parse(token);
        if (think.isEmpty(result) || result.user_id <= 0) {
            return 0;
        }

        return result.user_id;
    }

    /**
     * 根据值获取用户信息
     */
    async getUserInfo(token = '') {
        const userId = await this.getUserId(token);
        if (userId <= 0) {
            return null;
        }

        const userInfo = await this.model('admin').where({id: userId}).find();

        return think.isEmpty(userInfo) ? null : userInfo;
    }

    async create(userInfo) {
        const secret = this.getTokenSecret();
        if (!secret) {
            throw new Error('missing ADMIN_JWT_SECRET');
        }
        const token = jwt.sign(userInfo, secret, {
            algorithm: this.getTokenAlgorithm(),
            expiresIn: this.getTokenExpiresIn()
        });
        return token;
    }

    async parse(token = '') {
        const secrets = this.getVerifySecrets();
        if (secrets.length === 0) {
            return null;
        }
        if (token) {
            for (const secret of secrets) {
                try {
                    return jwt.verify(token, secret, {
                        algorithms: [this.getTokenAlgorithm()]
                    });
                } catch (err) {
                    continue;
                }
            }
            return null;
        }
        return null;
    }

    async verify(token = '') {
        const result = await this.parse(token);
        if (think.isEmpty(result)) {
            return false;
        }

        return true;
    }

    async getAccessToken(forceRefresh = false) {
        const weixinConfig = this.ensureWeixinConfig(['appid', 'secret'], 'admin.token.getAccessToken');
        if (!forceRefresh && cachedAccessToken && Date.now() < cachedAccessTokenExpireAt) {
            return cachedAccessToken;
        }
        const options = {
            method: 'GET',
            url: 'https://api.weixin.qq.com/cgi-bin/token',
            qs: {
                grant_type: 'client_credential',
                secret: weixinConfig.secret,
                appid: weixinConfig.appid
            }
        };
        try {
            const sessionData = await httpClient.requestJson(options);
            if (!sessionData.access_token) {
                return '';
            }
            const expiresIn = Number(sessionData.expires_in || 7200);
            const safeSeconds = Math.max(60, expiresIn - ACCESS_TOKEN_GUARD_SECONDS);
            cachedAccessToken = sessionData.access_token;
            cachedAccessTokenExpireAt = Date.now() + safeSeconds * 1000;
            return cachedAccessToken;
        } catch (err) {
            return '';
        }
    }
};
