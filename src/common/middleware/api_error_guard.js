const crypto = require('crypto');

function resolveRequestId(ctx) {
  const fromState = String(ctx.state && ctx.state.requestId || '').trim();
  if (fromState) {
    return fromState;
  }
  const fromHeader = String(ctx.get('x-request-id') || '').trim();
  if (fromHeader) {
    return fromHeader;
  }
  return crypto.randomUUID();
}

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
      const requestId = resolveRequestId(ctx);
      ctx.state.requestId = requestId;
      ctx.set('X-Request-Id', requestId);
      const isProd = String(think.env || '').toLowerCase() === 'production';
      const debugMessage = (err && err.message) ? String(err.message) : '服务器异常';
      const responseMessage = isProd ? '服务器开小差了，请稍后再试' : debugMessage;
      const stackText = err && err.stack ? String(err.stack) : debugMessage;
      console.error(`[api_error_guard] requestId=${requestId} ${ctx.method} ${path}: ${stackText}`);
      ctx.status = 200;
      ctx.type = 'application/json; charset=utf-8';
      ctx.body = {
        errno: 500,
        errmsg: responseMessage
      };
    }
  };
};
