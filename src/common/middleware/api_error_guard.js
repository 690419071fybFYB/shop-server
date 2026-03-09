module.exports = function apiErrorGuard() {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const path = String(ctx.path || '');
      const isApiLike = path.startsWith('/api/') || path.startsWith('/admin/');
      if (!isApiLike) {
        throw err;
      }
      const message = (err && err.message) ? String(err.message) : '服务器异常';
      console.error(`[api_error_guard] ${ctx.method} ${path}: ${message}`);
      ctx.status = 200;
      ctx.type = 'application/json; charset=utf-8';
      ctx.body = {
        errno: 500,
        errmsg: message
      };
    }
  };
};
