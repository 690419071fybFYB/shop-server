const Base = require('./base.js');
module.exports = class extends Base {
    async loginAction() {
        const username = this.post('username');
        const password = this.post('password');
        const admin = await this.model('admin').where({
            username: username
        }).find();
        if (think.isEmpty(admin)) {
            return this.fail(401, '用户名或密码不正确!');
        }
        if (think.md5(password + '' + admin.password_salt) !== admin.password) {
            return this.fail(400, '用户名或密码不正确!!');
        }
        // 更新登录信息
        await this.model('admin').where({
            id: admin.id
        }).update({
            last_login_time: parseInt(Date.now() / 1000),
            last_login_ip: this.ctx.ip
        });
        const TokenSerivce = this.service('token', 'admin');
        let sessionData = {}
        sessionData.user_id = admin.id
        const sessionKey = await TokenSerivce.create(sessionData);
        if (think.isEmpty(sessionKey)) {
            return this.fail('登录失败');
        }
        const rbacService = this.service('rbac', 'admin');
        const authContext = await rbacService.getAuthContext(admin.id);
        const userInfo = {
            id: admin.id,
            username: admin.username,
            name: admin.name || admin.username
        };
        return this.success({
            token: sessionKey,
            userInfo: userInfo,
            roles: authContext.role_keys,
            permissions: authContext.permissions
        });
    }
};
