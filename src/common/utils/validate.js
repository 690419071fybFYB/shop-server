function sanitizeText(value, maxLen = 256) {
  if (value === undefined || value === null) {
    return '';
  }
  let text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (text.length > maxLen) {
    text = text.slice(0, maxLen);
  }
  return text;
}

function isValidMobile(value) {
  const mobile = sanitizeText(value, 32);
  return /^1[3-9]\d{9}$/.test(mobile);
}

function isValidWeixinCode(value) {
  const code = sanitizeText(value, 128);
  return /^[A-Za-z0-9_-]{6,128}$/.test(code);
}

function isLikelyBase64(value, maxLen = 4096) {
  const text = sanitizeText(value, maxLen);
  if (!text || text.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/=]+$/.test(text);
}

function sanitizeAvatarUrl(value) {
  let text = sanitizeText(value, 1024);
  if (!text) {
    return '';
  }
  if (/^javascript:/i.test(text) || /^data:/i.test(text)) {
    return '';
  }
  if (/^http:\/\//i.test(text)) {
    if (/^http:\/\/(127\.0\.0\.1|localhost)/i.test(text)) {
      return '';
    }
    text = text.replace(/^http:\/\//i, 'https://');
  }
  if (/^https:\/\//i.test(text)) {
    return text;
  }
  if (/^\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/.test(text)) {
    return text;
  }
  return '';
}

module.exports = {
  sanitizeText,
  isValidMobile,
  isValidWeixinCode,
  isLikelyBase64,
  sanitizeAvatarUrl
};
