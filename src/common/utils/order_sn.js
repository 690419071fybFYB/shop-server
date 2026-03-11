function padNumber(value, width = 2) {
  return String(Number(value || 0)).padStart(width, '0');
}

function randomSixDigits() {
  return padNumber(Math.floor(Math.random() * 1000000), 6);
}

function generateOrderSn(now = new Date()) {
  const year = now.getFullYear();
  const month = padNumber(now.getMonth() + 1, 2);
  const day = padNumber(now.getDate(), 2);
  const hour = padNumber(now.getHours(), 2);
  const minute = padNumber(now.getMinutes(), 2);
  const second = padNumber(now.getSeconds(), 2);
  return `${year}${month}${day}${hour}${minute}${second}${randomSixDigits()}`;
}

function getErrorText(error) {
  if (!error) {
    return '';
  }
  return String(error.message || error.sqlMessage || '');
}

function isOrderSnDuplicateError(error) {
  if (!error) {
    return false;
  }
  const code = String(error.code || '');
  const errno = Number(error.errno || 0);
  if (code !== 'ER_DUP_ENTRY' && errno !== 1062) {
    return false;
  }
  const message = getErrorText(error).toLowerCase();
  return message.includes('order_sn');
}

async function withOrderSnRetry({
  maxRetries = 3,
  context = 'order_sn_retry',
  logger = null,
  requestId = '',
  orderId = '',
  createOrderSn,
  execute
} = {}) {
  const retries = Math.max(1, Number(maxRetries || 1));
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const orderSn = createOrderSn();
    try {
      return await execute(orderSn, attempt);
    } catch (error) {
      lastError = error;
      if (!isOrderSnDuplicateError(error)) {
        throw error;
      }
      if (attempt < retries) {
        logger && logger.warn && logger.warn(
          `[${context}] duplicate order_sn, retry attempt=${attempt}/${retries}, orderId=${orderId || ''}, requestId=${requestId || ''}`
        );
        continue;
      }
      logger && logger.error && logger.error(
        `[${context}] duplicate order_sn exhausted retries=${retries}, orderId=${orderId || ''}, requestId=${requestId || ''}, message=${getErrorText(error)}`
      );
      throw error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error(`[${context}] order_sn retry failed without explicit error`);
}

module.exports = {
  generateOrderSn,
  isOrderSnDuplicateError,
  withOrderSnRetry
};
