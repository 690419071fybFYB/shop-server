const jwt = require('jsonwebtoken');
module.exports = class extends think.Service {
    getSecurityConfig() {
        return think.config('security') || {};
    }
    getTokenSecret() {
        const config = this.getSecurityConfig();
        return String(config.apiTokenSecret || '').trim();
    }
    getTokenAlgorithm() {
        const config = this.getSecurityConfig();
        return String(config.tokenAlgorithm || 'HS256').trim() || 'HS256';
    }
    getTokenExpiresIn() {
        const config = this.getSecurityConfig();
        return config.apiTokenExpiresIn || '7d';
    }
    /**
     * 根据header中的x-hioshop-token值获取用户id
     */
    getUserId(token) {
        if (!token) {
            return 0;
        }
        const result = this.parse(token);
        if (think.isEmpty(result) || result.user_id <= 0) {
            return 0;
        }
        return result.user_id;
    }
    parse(token) {
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
	async create(userInfo) {
            const secret = this.getTokenSecret();
            if (!secret) {
                throw new Error('missing API_JWT_SECRET');
            }
            const token = jwt.sign(userInfo, secret, {
                algorithm: this.getTokenAlgorithm(),
                expiresIn: this.getTokenExpiresIn()
            });
		    return token;
		}
	/**
	 * 根据值获取用户信息
	 */
	async getUserInfo() {
	    const userId = await this.getUserId();
	    if (userId <= 0) {
	        return null;
	    }
	    const userInfo = await this.model('user').field(['id', 'username', 'nickname', 'gender', 'avatar', 'birthday']).where({
	        id: userId
	    }).find();
	    return think.isEmpty(userInfo) ? null : userInfo;
	}
    async verify(token) {
        const result = await this.parse(token);
        if (think.isEmpty(result)) {
            return false;
        }
        return true;
    }
};
