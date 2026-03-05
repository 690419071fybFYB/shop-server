const profile = require('../../common/utils/profile');

module.exports = class extends think.Controller {
	async __before() {
		// 根据token值获取用户id
		const token = this.ctx.header['x-hioshop-token'] || '';
		const tokenSerivce = think.service('token', 'api');
		think.userId = tokenSerivce.getUserId(token);

		const normalizeName = (value) => {
			const raw = String(value || '').toLowerCase();
			const parts = raw.split('/');
			return parts[parts.length - 1] || raw;
		};

		const controller = normalizeName(this.ctx.controller || '');
		const action = String(this.ctx.action || '').toLowerCase();

		const defaultPublicControllers = ['index', 'catalog', 'auth', 'goods', 'search', 'region'];
		const defaultPublicActions = [
			'cart/index',
			'cart/add',
			'cart/checked',
			'cart/update',
			'cart/delete',
			'cart/goodscount',
			'settings/showsettings',
			'pay/notify'
		];
		const defaultProfileRequiredControllers = ['order', 'address', 'footprint'];
		const defaultProfileRequiredActions = ['cart/checkout'];

		const configPublicControllers = think.config('publicController');
		const configPublicActions = think.config('publicAction');
		const configProfileRequiredControllers = think.config('profileRequiredController');
		const configProfileRequiredActions = think.config('profileRequiredAction');

		const publicControllers = (Array.isArray(configPublicControllers) && configPublicControllers.length > 0
			? configPublicControllers
			: defaultPublicControllers
		).map((item) => normalizeName(item));
		const publicActions = (Array.isArray(configPublicActions) && configPublicActions.length > 0
			? configPublicActions
			: defaultPublicActions
		).map((item) => String(item || '').toLowerCase());
		const profileRequiredControllers = (Array.isArray(configProfileRequiredControllers) && configProfileRequiredControllers.length > 0
			? configProfileRequiredControllers
			: defaultProfileRequiredControllers
		).map((item) => normalizeName(item));
		const profileRequiredActions = (Array.isArray(configProfileRequiredActions) && configProfileRequiredActions.length > 0
			? configProfileRequiredActions
			: defaultProfileRequiredActions
		).map((item) => String(item || '').toLowerCase());

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
