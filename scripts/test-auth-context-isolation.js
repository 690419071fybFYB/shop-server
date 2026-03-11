#!/usr/bin/env node
require('dotenv').config({path: '.env.local'});
require('dotenv').config();
const assert = require('assert');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE_URL = process.env.AUTH_CONTEXT_TEST_BASE_URL || process.env.SECURITY_TEST_BASE_URL || process.env.COUPON_TEST_BASE_URL || 'http://127.0.0.1:8360';
const API_SECRET = process.env.API_JWT_SECRET || process.env.API_TOKEN_SECRET || '';

const USER_A_ID = Number(process.env.AUTH_CONTEXT_TEST_USER_A_ID || process.env.SECURITY_TEST_USER_A_ID || process.env.COUPON_TEST_USER_ID || 1048);
const USER_B_ID = Number(process.env.AUTH_CONTEXT_TEST_USER_B_ID || process.env.SECURITY_TEST_USER_B_ID || 2048);
const ROUNDS = Math.max(1, Number(process.env.AUTH_CONTEXT_TEST_ROUNDS || 20));

const DB_HOST = process.env.AUTH_CONTEXT_TEST_DB_HOST || process.env.SECURITY_TEST_DB_HOST || process.env.COUPON_TEST_DB_HOST || process.env.TEST_DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.AUTH_CONTEXT_TEST_DB_PORT || process.env.SECURITY_TEST_DB_PORT || process.env.COUPON_TEST_DB_PORT || process.env.TEST_DB_PORT || 3306);
const DB_USER = process.env.AUTH_CONTEXT_TEST_DB_USER || process.env.SECURITY_TEST_DB_USER || process.env.COUPON_TEST_DB_USER || process.env.TEST_DB_USER || 'root';
const DB_PASSWORD = process.env.AUTH_CONTEXT_TEST_DB_PASSWORD || process.env.SECURITY_TEST_DB_PASSWORD || process.env.COUPON_TEST_DB_PASSWORD || process.env.TEST_DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '';
const DB_NAME = process.env.AUTH_CONTEXT_TEST_DB_NAME || process.env.SECURITY_TEST_DB_NAME || process.env.COUPON_TEST_DB_NAME || process.env.TEST_DB_NAME || 'hiolabsDB';

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function randomSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

function buildToken(secret, userId) {
  return jwt.sign({user_id: Number(userId)}, secret, {
    algorithm: 'HS256'
  });
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
    `ctx-user-${userId}`,
    timestamp,
    timestamp,
    `137${String(userId).padStart(8, '0').slice(-8)}`,
    `ctx_openid_${userId}`
  ]);
  return true;
}

async function createOwnedOrder(conn, userId) {
  const timestamp = nowTs();
  const orderSn = `ctx${randomSuffix().slice(-16)}`;
  const [result] = await conn.query(`
    INSERT INTO hiolabs_order
      (order_sn, user_id, order_status, pay_status, consignee, province, city, district, address, print_info, mobile, postscript, actual_price, order_price, goods_price, add_time, freight_price, order_type, is_delete)
    VALUES
      (?, ?, 301, 2, 'context-test', 3, 38, 422, 'context test address', '', '13800000000', '', 0.01, 0.01, 0.01, ?, 0, 0, 0)
  `, [orderSn, Number(userId), timestamp]);
  return Number(result.insertId);
}

function assertCartOwner(response, expectedUserId, label) {
  assert(Number(response.payload.errno) === 0, `${label} 返回异常: errno=${response.payload.errno}`);
  const returnedUserId = Number(response.payload.data && response.payload.data.cartTotal && response.payload.data.cartTotal.user_id || 0);
  assert(returnedUserId === Number(expectedUserId), `${label} user_id 串号: expect=${expectedUserId}, got=${returnedUserId}`);
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
    const userAInserted = await ensureUser(conn, USER_A_ID, 'context-a');
    const userBInserted = await ensureUser(conn, USER_B_ID, 'context-b');
    if (userAInserted) cleanup.createdUsers.push(USER_A_ID);
    if (userBInserted) cleanup.createdUsers.push(USER_B_ID);

    const ownOrderA = await createOwnedOrder(conn, USER_A_ID);
    const ownOrderB = await createOwnedOrder(conn, USER_B_ID);
    cleanup.createdOrders.push(ownOrderA, ownOrderB);

    const tokenA = buildToken(API_SECRET, USER_A_ID);
    const tokenB = buildToken(API_SECRET, USER_B_ID);

    console.log(`1) 并发读取 cart/index 身份隔离（rounds=${ROUNDS}）`);
    for (let round = 0; round < ROUNDS; round += 1) {
      const [cartAResp, cartBResp] = await Promise.all([
        requestApi('/api/cart/index', {method: 'GET', token: tokenA}),
        requestApi('/api/cart/index', {method: 'GET', token: tokenB})
      ]);
      assertCartOwner(cartAResp, USER_A_ID, `round${round + 1}:userA`);
      assertCartOwner(cartBResp, USER_B_ID, `round${round + 1}:userB`);
    }

    console.log('2) 并发订单写操作（本人确认）应各自成功');
    const [confirmAResp, confirmBResp] = await Promise.all([
      requestApi('/api/order/confirm', {
        method: 'POST',
        token: tokenA,
        body: {orderId: ownOrderA}
      }),
      requestApi('/api/order/confirm', {
        method: 'POST',
        token: tokenB,
        body: {orderId: ownOrderB}
      })
    ]);
    assert(Number(confirmAResp.payload.errno) === 0, `userA confirm 失败: errno=${confirmAResp.payload.errno}`);
    assert(Number(confirmBResp.payload.errno) === 0, `userB confirm 失败: errno=${confirmBResp.payload.errno}`);

    console.log('3) 并发跨账号订单写操作应稳定拒绝（403）');
    const [crossAResp, crossBResp] = await Promise.all([
      requestApi('/api/order/confirm', {
        method: 'POST',
        token: tokenA,
        body: {orderId: ownOrderB}
      }),
      requestApi('/api/order/confirm', {
        method: 'POST',
        token: tokenB,
        body: {orderId: ownOrderA}
      })
    ]);
    assert(Number(crossAResp.payload.errno) === 403, `userA 跨账号写未拒绝: errno=${crossAResp.payload.errno}`);
    assert(Number(crossBResp.payload.errno) === 403, `userB 跨账号写未拒绝: errno=${crossBResp.payload.errno}`);

    console.log('Auth context isolation 测试通过。');
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
  console.error('Auth context isolation 测试失败:', err.message);
  process.exit(1);
});
