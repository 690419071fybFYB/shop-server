const profile = require('../../common/utils/profile');

module.exports = class extends think.Controller {
	async __before() {
		// 根据token值获取用户id
		const token = this.ctx.header['x-hioshop-token'] || '';
		const tokenSerivce = think.service('token', 'api');
		think.userId = tokenSerivce.getUserId(token);
		const controller = String(this.ctx.controller || '').toLowerCase();
		const action = String(this.ctx.action || '').toLowerCase();
		const publicControllers = (think.config('publicController') || []).map((item) => String(item || '').toLowerCase());
		const publicActions = (think.config('publicAction') || []).map((item) => String(item || '').toLowerCase());
		const profileRequiredControllers = (think.config('profileRequiredController') || []).map((item) => String(item || '').toLowerCase());
		const profileRequiredActions = (think.config('profileRequiredAction') || []).map((item) => String(item || '').toLowerCase());
		const routeKey = `${controller}/${action}`;
		const isPublic = publicControllers.includes(controller) || publicActions.includes(routeKey);
		if (!isPublic && think.userId <= 0) {
			return this.fail(401, '请先登录');
		}
		const requireProfile = profileRequiredControllers.includes(controller) || profileRequiredActions.includes(routeKey);
		if (requireProfile && think.userId > 0) {
			const userInfo = await this.model('user').where({ id: think.userId }).field('nickname,mobile').find();
			if (!profile.isProfileComplete(userInfo)) {
				return this.fail(412, '请先完善登录资料');
			}
		}
	}
	/**
	 * 获取时间戳
	 * @returns {Number}
	 */
	getTime() {
		return parseInt(Date.now() / 1000);
	}
	/**
	 * 获取当前登录用户的id
	 * @returns {*}
	 */
	getLoginUserId() {
		const token = this.ctx.header['x-hioshop-token'] || '';
		const tokenSerivce = think.service('token', 'api');
		return tokenSerivce.getUserId(token);
	}
};
