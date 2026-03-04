function decodeNickname(value) {
  const source = String(value || '');
  if (!source) {
    return '';
  }
  try {
    return Buffer.from(source, 'base64').toString().trim();
  } catch (error) {
    return source.trim();
  }
}

function isValidMobile(value) {
  return /^1[3-9]\d{9}$/.test(String(value || '').trim());
}

function isProfileComplete(userDetail) {
  const data = userDetail || {};
  const nickname = decodeNickname(data.nickname || data.nickName || '');
  const mobile = String(data.mobile || '').trim();
  return !!nickname && nickname !== '微信用户' && isValidMobile(mobile);
}

module.exports = {
  decodeNickname,
  isProfileComplete
};

