module.exports = class extends think.Controller {
  async __before() {
    // 根据token值获取用户id
    think.token = this.ctx.header['x-hioshop-token'] || '';
    const tokenSerivce = think.service('token', 'admin');
    const rbacService = think.service('rbac', 'admin');
    think.userId = await tokenSerivce.getUserId();
    // 只允许登录操作
    if (this.ctx.controller != 'auth') {
      if (think.userId <= 0 || think.userId == undefined) {
        return this.fail(401, '请先登录');
      }
    }
    if (think.userId > 0) {
      const authContext = await rbacService.getAuthContext(think.userId);
      think.adminAuth = authContext;
      this.ctx.state.adminAuth = authContext;
      const controller = String(this.ctx.controller || '').toLowerCase();
      const action = String(this.ctx.action || '').toLowerCase();
      const bypassRoutes = new Set([
        'auth.login',
        'index.checklogin'
      ]);
      const routeKey = `${controller}.${action}`;
      if (rbacService.isEnabled() && !bypassRoutes.has(routeKey)) {
        const permissionKey = rbacService.routePermissionKey(controller, action);
        const shouldCheck = await rbacService.shouldCheckApiPermission(permissionKey);
        if (shouldCheck && !rbacService.hasPermission(authContext, permissionKey)) {
          console.warn(`[RBAC] deny user=${think.userId} route=${routeKey} permission=${permissionKey}`);
          return this.fail(403, '无权限访问');
        }
      }
    }
  }
};
