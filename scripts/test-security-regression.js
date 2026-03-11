#!/usr/bin/env node
require('dotenv').config({path: '.env.local'});
require('dotenv').config();
const assert = require('assert');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE_URL = process.env.SECURITY_TEST_BASE_URL || process.env.COUPON_TEST_BASE_URL || 'http://127.0.0.1:8360';
const API_SECRET = process.env.API_JWT_SECRET || process.env.API_TOKEN_SECRET || '';
const API_LEGACY_SECRET = String(process.env.API_JWT_LEGACY_SECRETS || process.env.API_TOKEN_LEGACY_SECRETS || '')
  .split(',')
  .map((item) => String(item || '').trim())
  .filter(Boolean)[0] || '';

const USER_A_ID = Number(process.env.SECURITY_TEST_USER_A_ID || process.env.COUPON_TEST_USER_ID || 1048);
const USER_B_ID = Number(process.env.SECURITY_TEST_USER_B_ID || 2048);

const DB_HOST = process.env.SECURITY_TEST_DB_HOST || process.env.COUPON_TEST_DB_HOST || process.env.TEST_DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.SECURITY_TEST_DB_PORT || process.env.COUPON_TEST_DB_PORT || process.env.TEST_DB_PORT || 3306);
const DB_USER = process.env.SECURITY_TEST_DB_USER || process.env.COUPON_TEST_DB_USER || process.env.TEST_DB_USER || 'root';
const DB_PASSWORD = process.env.SECURITY_TEST_DB_PASSWORD || process.env.COUPON_TEST_DB_PASSWORD || process.env.TEST_DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '';
const DB_NAME = process.env.SECURITY_TEST_DB_NAME || process.env.COUPON_TEST_DB_NAME || process.env.TEST_DB_NAME || 'hiolabsDB';

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function randomSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

function buildToken(secret, userId, options = {}) {
  return jwt.sign({user_id: Number(userId)}, secret, Object.assign({algorithm: 'HS256'}, options));
}

async function requestApi(path, {method = 'GET', token = '', query = {}, body} = {}) {
  const url = new URL(path, BASE_URL);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  const headers = {};
  if (token) {
    headers['X-Hioshop-Token'] = token;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`[${path}] 非JSON响应: ${text.slice(0, 200)}`);
  }
  return {
    statusCode: response.status,
    payload
  };
}

async function openDb() {
  return mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME
  });
}

async function ensureUser(conn, userId, label) {
  const [rows] = await conn.query('SELECT id FROM hiolabs_user WHERE id = ? LIMIT 1', [Number(userId)]);
  if (rows.length > 0) {
    return false;
  }
  const timestamp = nowTs();
  const nickname = Buffer.from(`${label}-${userId}`).toString('base64');
  await conn.query(`
    INSERT INTO hiolabs_user
      (id, nickname, name, username, password, gender, birthday, register_time, last_login_time, last_login_ip, mobile, register_ip, avatar, weixin_openid, name_mobile, country, province, city)
    VALUES
      (?, ?, '', ?, '', 0, 0, ?, ?, '', ?, '', '/static/images/default_avatar.png', ?, 0, '0', '0', '0')
  `, [
    Number(userId),
    nickname,
    `security-user-${userId}`,
    timestamp,
    timestamp,
    `139${String(userId).padStart(8, '0').slice(-8)}`,
    `security_openid_${userId}`
  ]);
  return true;
}

async function createOwnedOrder(conn, userId) {
  const timestamp = nowTs();
  const orderSn = `sec${randomSuffix().slice(-16)}`;
  const [result] = await conn.query(`
    INSERT INTO hiolabs_order
      (order_sn, user_id, order_status, pay_status, consignee, province, city, district, address, print_info, mobile, postscript, actual_price, order_price, goods_price, add_time, freight_price, order_type, is_delete)
    VALUES
      (?, ?, 301, 2, 'security-test', 3, 38, 422, 'security test address', '', '13800000000', '', 0.01, 0.01, 0.01, ?, 0, 0, 0)
  `, [orderSn, Number(userId), timestamp]);
  return Number(result.insertId);
}

async function main() {
  if (!API_SECRET) {
    throw new Error('缺少 API_JWT_SECRET（兼容 API_TOKEN_SECRET）');
  }
  const conn = await openDb();
  const cleanup = {
    createdUsers: [],
    createdOrders: []
  };
  try {
    const userAInserted = await ensureUser(conn, USER_A_ID, 'security-a');
    const userBInserted = await ensureUser(conn, USER_B_ID, 'security-b');
    if (userAInserted) cleanup.createdUsers.push(USER_A_ID);
    if (userBInserted) cleanup.createdUsers.push(USER_B_ID);

    const foreignOrderId = await createOwnedOrder(conn, USER_B_ID);
    cleanup.createdOrders.push(foreignOrderId);

    const tokenA = buildToken(API_SECRET, USER_A_ID);
    const expiredTokenA = buildToken(API_SECRET, USER_A_ID, {expiresIn: -10});

    console.log('1) 未登录访问受保护接口应返回 401');
    const unauthorizedResp = await requestApi('/api/order/list', {
      method: 'GET',
      query: {showType: 0, page: 1, size: 1}
    });
    assert(Number(unauthorizedResp.payload.errno) === 401, `未登录返回异常: errno=${unauthorizedResp.payload.errno}`);

    console.log('2) 跨账号订单写操作应返回 403');
    const idorResp = await requestApi('/api/order/confirm', {
      method: 'POST',
      token: tokenA,
      body: {orderId: foreignOrderId}
    });
    assert(Number(idorResp.payload.errno) === 403, `跨账号操作未被拒绝: errno=${idorResp.payload.errno}`);

    console.log('3) 生产默认路径下测试支付接口应不可用');
    const testPayResp = await requestApi('/api/pay/preWeixinPaya', {
      method: 'GET',
      token: tokenA,
      query: {orderId: foreignOrderId}
    });
    assert(Number(testPayResp.payload.errno) === 404, `测试支付接口应为404: errno=${testPayResp.payload.errno}`);

    console.log('4) 过期 token 应返回 401');
    const expiredResp = await requestApi('/api/order/list', {
      method: 'GET',
      token: expiredTokenA,
      query: {showType: 0, page: 1, size: 1}
    });
    assert(Number(expiredResp.payload.errno) === 401, `过期 token 未被拒绝: errno=${expiredResp.payload.errno}`);

    if (API_LEGACY_SECRET) {
      console.log('5) 兼容窗口：legacy secret 签发 token 可通过校验');
      const legacyToken = buildToken(API_LEGACY_SECRET, USER_A_ID);
      const legacyResp = await requestApi('/api/order/count', {
        method: 'GET',
        token: legacyToken,
        query: {showType: 0}
      });
      assert(Number(legacyResp.payload.errno) === 0, `legacy token 未通过兼容校验: errno=${legacyResp.payload.errno}`);
    } else {
      console.log('5) legacy secret 未配置，跳过兼容窗口用例');
    }

    console.log('Security 回归测试通过。');
  } finally {
    for (const orderId of cleanup.createdOrders) {
      await conn.query('DELETE FROM hiolabs_order WHERE id = ?', [Number(orderId)]);
    }
    for (const userId of cleanup.createdUsers) {
      await conn.query('DELETE FROM hiolabs_user WHERE id = ?', [Number(userId)]);
    }
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Security 回归测试失败:', err.message);
  process.exit(1);
});
