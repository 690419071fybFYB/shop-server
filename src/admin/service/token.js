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
    getTokenAlgorithm() {
        const config = this.getSecurityConfig();
        return String(config.tokenAlgorithm || 'HS256').trim() || 'HS256';
    }
    getTokenExpiresIn() {
        const config = this.getSecurityConfig();
        return config.adminTokenExpiresIn || '12h';
    }
    /**
     * 根据header中的x-hioshop-token值获取用户id
     */
    async getUserId() {
        const token = think.token;
        if (!token) {
            return 0;
        }

        const result = await this.parse();
        if (think.isEmpty(result) || result.user_id <= 0) {
            return 0;
        }

        return result.user_id;
    }

    /**
     * 根据值获取用户信息
     */
    async getUserInfo() {
        const userId = await this.getUserId();
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

    async parse(token = think.token) {
        const secret = this.getTokenSecret();
        if (!secret) {
            return null;
        }
        if (token) {
            try {
                return jwt.verify(token, secret, {
                    algorithms: [this.getTokenAlgorithm()]
                });
            } catch (err) {
                return null;
            }
        }
        return null;
    }

    async verify() {
        const result = await this.parse();
        if (think.isEmpty(result)) {
            return false;
        }

        return true;
    }

    async getAccessToken(forceRefresh = false) {
        if (!forceRefresh && cachedAccessToken && Date.now() < cachedAccessTokenExpireAt) {
            return cachedAccessToken;
        }
        const options = {
            method: 'GET',
            url: 'https://api.weixin.qq.com/cgi-bin/token',
            qs: {
                grant_type: 'client_credential',
                secret: think.config('weixin.secret'),
                appid: think.config('weixin.appid')
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
