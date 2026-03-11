const profile = require('../../common/utils/profile');

module.exports = class extends think.Controller {
	normalizeRouteName(value) {
		const raw = String(value || '').toLowerCase();
		const parts = raw.split('/');
		return parts[parts.length - 1] || raw;
	}

	normalizeStringList(list, normalizer) {
		return (Array.isArray(list) ? list : [])
			.map((item) => normalizer(item))
			.filter(Boolean);
	}

	resolveConfigList(configKey, fallbackList, normalizer) {
		const configured = think.config(configKey);
		const source = Array.isArray(configured) && configured.length > 0 ? configured : fallbackList;
		return this.normalizeStringList(source, normalizer);
	}

	getCurrentRoute() {
		const controller = this.normalizeRouteName(this.ctx.controller || '');
		const action = String(this.ctx.action || '').toLowerCase();
		return {
			controller,
			action,
			routeKey: `${controller}/${action}`
		};
	}

	async __before() {
		// 根据token值获取用户id
		const token = this.ctx.header['x-hioshop-token'] || '';
		const tokenSerivce = think.service('token', 'api');
		const userId = Number(tokenSerivce.getUserId(token) || 0);
		this.ctx.state.userId = userId;
		const {controller, routeKey} = this.getCurrentRoute();

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

		const publicControllers = this.resolveConfigList('publicController', defaultPublicControllers, (item) => this.normalizeRouteName(item));
		const publicActions = this.resolveConfigList('publicAction', defaultPublicActions, (item) => String(item || '').toLowerCase());
		const profileRequiredControllers = this.resolveConfigList('profileRequiredController', defaultProfileRequiredControllers, (item) => this.normalizeRouteName(item));
		const profileRequiredActions = this.resolveConfigList('profileRequiredAction', defaultProfileRequiredActions, (item) => String(item || '').toLowerCase());

		const isPublic = publicControllers.includes(controller) || publicActions.includes(routeKey);
		if (!isPublic && userId <= 0) {
			return this.failUnauthorized();
		}
		const requireProfile = profileRequiredControllers.includes(controller) || profileRequiredActions.includes(routeKey);
		if (requireProfile && userId > 0) {
			const userInfo = await this.model('user').where({ id: userId }).field('nickname,mobile').find();
			if (!profile.isProfileComplete(userInfo)) {
				return this.fail(412, '请先完善登录资料');
			}
		}
	}

	failUnauthorized(message = '请先登录') {
		return this.fail(401, message);
	}

	failForbidden(message = '无权限访问') {
		return this.fail(403, message);
	}

	requireLoginUserId() {
		const userId = this.getLoginUserId();
		if (userId <= 0) {
			this.failUnauthorized();
			return 0;
		}
		return userId;
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
		const userId = Number(this.ctx.state.userId || 0);
		if (userId > 0) {
			return userId;
		}
		const token = this.ctx.header['x-hioshop-token'] || '';
		const tokenSerivce = think.service('token', 'api');
		const parsedUserId = Number(tokenSerivce.getUserId(token) || 0);
		this.ctx.state.userId = parsedUserId;
		return parsedUserId;
	}
};
