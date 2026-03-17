#!/usr/bin/env node
require('dotenv').config({path: '.env.local'});
require('dotenv').config();

const assert = require('assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE_URL = process.env.VIP_NOTIFY_TEST_BASE_URL || process.env.COUPON_TEST_BASE_URL || 'http://127.0.0.1:8360';
const API_SECRET = process.env.API_JWT_SECRET || process.env.API_TOKEN_SECRET || '';
const WEIXIN_PARTNER_KEY = process.env.WEIXIN_PARTNER_KEY || '';
const WEIXIN_APPID = process.env.WEIXIN_APPID || '';
const WEIXIN_MCH_ID = process.env.WEIXIN_MCH_ID || '';

const DB_HOST = process.env.VIP_NOTIFY_TEST_DB_HOST || process.env.COUPON_TEST_DB_HOST || process.env.TEST_DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.VIP_NOTIFY_TEST_DB_PORT || process.env.COUPON_TEST_DB_PORT || process.env.TEST_DB_PORT || 3306);
const DB_USER = process.env.VIP_NOTIFY_TEST_DB_USER || process.env.COUPON_TEST_DB_USER || process.env.TEST_DB_USER || 'root';
const DB_PASSWORD = process.env.VIP_NOTIFY_TEST_DB_PASSWORD || process.env.COUPON_TEST_DB_PASSWORD || process.env.TEST_DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '';
const DB_NAME = process.env.VIP_NOTIFY_TEST_DB_NAME || process.env.COUPON_TEST_DB_NAME || process.env.TEST_DB_NAME || 'hiolabsDB';

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

function buildToken(secret, userId) {
  return jwt.sign({user_id: Number(userId)}, secret, {algorithm: 'HS256'});
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
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`[${path}] 非JSON响应: ${text.slice(0, 240)}`);
  }
  return {
    statusCode: response.status,
    payload
  };
}

async function requestNotify(body, token = '') {
  const url = new URL('/api/pay/notify', BASE_URL);
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['X-Hioshop-Token'] = token;
  }
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  return (await response.text()).trim();
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

async function ensureUser(conn, userId) {
  const [rows] = await conn.query('SELECT id FROM hiolabs_user WHERE id = ? LIMIT 1', [Number(userId)]);
  if (rows.length > 0) {
    return false;
  }
  const ts = nowTs();
  await conn.query(`
    INSERT INTO hiolabs_user
      (id, nickname, name, username, password, gender, birthday, register_time, last_login_time, last_login_ip, mobile, register_ip, avatar, weixin_openid, name_mobile, country, province, city)
    VALUES
      (?, ?, '', ?, '', 0, 0, ?, ?, '', ?, '', '/static/images/default_avatar.png', ?, 0, '0', '0', '0')
  `, [
    Number(userId),
    Buffer.from(`vip-notify-test-${userId}`, 'utf8').toString('base64'),
    `vip-notify-test-${userId}`,
    ts,
    ts,
    `139${String(userId).padStart(8, '0').slice(-8)}`,
    `vip_notify_openid_${userId}`
  ]);
  return true;
}

function buildWxSign(payload) {
  const pairs = Object.keys(payload || {})
    .filter((key) => key !== 'sign' && payload[key] !== undefined && payload[key] !== null && String(payload[key]) !== '')
    .sort()
    .map((key) => `${key}=${String(payload[key])}`);
  const source = `${pairs.join('&')}&key=${WEIXIN_PARTNER_KEY}`;
  return crypto.createHash('md5').update(source).digest('hex').toUpperCase();
}

function buildNotifyPayload(orderSn, totalFee, transactionId) {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const timeEnd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const payload = {
    return_code: 'SUCCESS',
    result_code: 'SUCCESS',
    nonce_str: `vip_notify_${uniqueSuffix()}`,
    out_trade_no: String(orderSn),
    transaction_id: String(transactionId || `vip_tx_${uniqueSuffix()}`),
    total_fee: String(Math.max(1, Number(totalFee || 1))),
    time_end: timeEnd
  };
  if (WEIXIN_APPID) payload.appid = WEIXIN_APPID;
  if (WEIXIN_MCH_ID) payload.mch_id = WEIXIN_MCH_ID;
  payload.sign = buildWxSign(payload);
  const xml = {};
  Object.keys(payload).forEach((key) => {
    xml[key] = [String(payload[key])];
  });
  return {xml};
}

function isNotifySuccess(text) {
  return ['SUCCESS', 'OK', '"SUCCESS"', '"OK"'].includes(String(text || '').trim());
}

async function getOrderSnapshot(conn, orderId) {
  const [rows] = await conn.query(`
    SELECT id, pay_status, order_status, pay_id, pay_time
    FROM hiolabs_order
    WHERE id = ?
    LIMIT 1
  `, [Number(orderId)]);
  assert(rows.length === 1, `订单不存在: ${orderId}`);
  return rows[0];
}

async function getVipOrderSnapshot(conn, orderId) {
  const [rows] = await conn.query(`
    SELECT id, pay_status, status, pay_time, start_time, expire_time
    FROM hiolabs_vip_order
    WHERE order_id = ?
    LIMIT 1
  `, [Number(orderId)]);
  assert(rows.length === 1, `VIP 订单不存在: order_id=${orderId}`);
  return rows[0];
}

async function getActivateEventCount(conn, orderId) {
  const [rows] = await conn.query(`
    SELECT COUNT(1) AS total
    FROM hiolabs_vip_event_log
    WHERE order_id = ?
      AND event_type = 'membership'
      AND event_action = 'activate'
  `, [Number(orderId)]);
  return Number((rows[0] && rows[0].total) || 0);
}

async function getVipUserCount(conn, userId) {
  const [rows] = await conn.query(`
    SELECT COUNT(1) AS total
    FROM hiolabs_vip_user
    WHERE user_id = ?
      AND is_delete = 0
  `, [Number(userId)]);
  return Number((rows[0] && rows[0].total) || 0);
}

async function main() {
  if (!API_SECRET) {
    throw new Error('缺少 API_JWT_SECRET（兼容 API_TOKEN_SECRET）');
  }
  if (!WEIXIN_PARTNER_KEY) {
    throw new Error('缺少 WEIXIN_PARTNER_KEY，无法构造有效支付回调签名');
  }

  const userId = Number(process.env.VIP_NOTIFY_TEST_USER_ID || (9000000 + (Date.now() % 100000)));
  const token = buildToken(API_SECRET, userId);
  const conn = await openDb();
  const cleanup = {
    userCreated: false,
    orderId: 0,
    vipOrderId: 0,
    vipUserId: 0
  };

  try {
    cleanup.userCreated = await ensureUser(conn, userId);

    console.log('1) 获取套餐并创建 VIP 订单');
    const homeResp = await requestApi('/api/vip/home', {
      method: 'GET',
      token
    });
    assert(Number(homeResp.payload.errno) === 0, `vip/home 失败: ${JSON.stringify(homeResp.payload)}`);
    const plans = (homeResp.payload.data && homeResp.payload.data.plans) || [];
    assert(Array.isArray(plans) && plans.length > 0, 'vip/home 套餐列表为空');
    const planId = Number(plans[0].plan_id || plans[0].id || 0);
    assert(planId > 0, `套餐ID异常: ${JSON.stringify(plans[0])}`);

    const submitResp = await requestApi('/api/vip/submit', {
      method: 'POST',
      token,
      body: {planId}
    });
    assert(Number(submitResp.payload.errno) === 0, `vip/submit 失败: ${JSON.stringify(submitResp.payload)}`);
    const orderInfo = submitResp.payload.data && submitResp.payload.data.orderInfo;
    assert(orderInfo && Number(orderInfo.id || 0) > 0, 'vip/submit 未返回有效 orderInfo');
    const orderId = Number(orderInfo.id);
    cleanup.orderId = orderId;

    const [orderRows] = await conn.query(`
      SELECT id, order_sn, actual_price
      FROM hiolabs_order
      WHERE id = ?
      LIMIT 1
    `, [orderId]);
    assert(orderRows.length === 1, `未找到新建VIP订单: ${orderId}`);
    const orderRow = orderRows[0];
    const orderSn = String(orderRow.order_sn || '').trim();
    const totalFeeFen = Math.round(Number(orderRow.actual_price || 0) * 100);
    assert(orderSn, '订单号为空');
    assert(totalFeeFen > 0, `订单金额异常: ${JSON.stringify(orderRow)}`);

    const beforeOrder = await getOrderSnapshot(conn, orderId);
    const beforeVipOrder = await getVipOrderSnapshot(conn, orderId);
    const beforeEventCount = await getActivateEventCount(conn, orderId);
    const beforeVipUserCount = await getVipUserCount(conn, userId);
    assert(Number(beforeOrder.pay_status) === 0, '支付前 order.pay_status 应为 0');
    assert(String(beforeVipOrder.pay_status) === 'unpaid', '支付前 vip_order.pay_status 应为 unpaid');
    assert(beforeEventCount === 0, '支付前不应存在 activate 事件');

    console.log('2) 第一次支付回调：应生效');
    const transactionId = `vip_notify_tx_${uniqueSuffix()}`;
    const notifyBody = buildNotifyPayload(orderSn, totalFeeFen, transactionId);
    const notifyFirstText = await requestNotify(notifyBody, token);
    assert(isNotifySuccess(notifyFirstText), `第一次回调应成功，实际: ${notifyFirstText}`);

    const afterFirstOrder = await getOrderSnapshot(conn, orderId);
    const afterFirstVipOrder = await getVipOrderSnapshot(conn, orderId);
    const afterFirstEventCount = await getActivateEventCount(conn, orderId);
    const afterFirstVipUserCount = await getVipUserCount(conn, userId);
    const [vipUserRows] = await conn.query(`
      SELECT id
      FROM hiolabs_vip_user
      WHERE user_id = ?
        AND is_delete = 0
      ORDER BY id DESC
      LIMIT 1
    `, [Number(userId)]);
    if (vipUserRows.length > 0) {
      cleanup.vipUserId = Number(vipUserRows[0].id);
    }

    assert(Number(afterFirstOrder.pay_status) === 2, '第一次回调后 order.pay_status 应为 2');
    assert(Number(afterFirstOrder.order_status) === 201, '第一次回调后 order.order_status 应为 201');
    assert(String(afterFirstVipOrder.pay_status) === 'paid', '第一次回调后 vip_order.pay_status 应为 paid');
    assert(String(afterFirstVipOrder.status) === 'paid', '第一次回调后 vip_order.status 应为 paid');
    assert(afterFirstEventCount === 1, `第一次回调后 activate 事件应为 1，实际=${afterFirstEventCount}`);
    assert(afterFirstVipUserCount === beforeVipUserCount + 1, '第一次回调后应新增一条 vip_user');

    console.log('3) 第二次相同支付回调：应幂等，不重复生效');
    const notifySecondText = await requestNotify(notifyBody, token);
    const secondAccepted = isNotifySuccess(notifySecondText);
    const secondFailedAsExpected = String(notifySecondText).includes('FAIL') || String(notifySecondText).includes('订单已支付');
    assert(secondAccepted || secondFailedAsExpected, `第二次回调响应异常: ${notifySecondText}`);

    const afterSecondOrder = await getOrderSnapshot(conn, orderId);
    const afterSecondVipOrder = await getVipOrderSnapshot(conn, orderId);
    const afterSecondEventCount = await getActivateEventCount(conn, orderId);
    const afterSecondVipUserCount = await getVipUserCount(conn, userId);
    cleanup.vipOrderId = Number(afterSecondVipOrder.id || 0);

    assert.strictEqual(Number(afterSecondOrder.pay_status), Number(afterFirstOrder.pay_status), '第二次回调后 order.pay_status 不应变化');
    assert.strictEqual(Number(afterSecondOrder.order_status), Number(afterFirstOrder.order_status), '第二次回调后 order.order_status 不应变化');
    assert.strictEqual(String(afterSecondOrder.pay_id), String(afterFirstOrder.pay_id), '第二次回调后 order.pay_id 不应变化');
    assert.strictEqual(String(afterSecondVipOrder.pay_status), String(afterFirstVipOrder.pay_status), '第二次回调后 vip_order.pay_status 不应变化');
    assert.strictEqual(String(afterSecondVipOrder.status), String(afterFirstVipOrder.status), '第二次回调后 vip_order.status 不应变化');
    assert.strictEqual(afterSecondEventCount, afterFirstEventCount, '第二次回调后 activate 事件数不应增加');
    assert.strictEqual(afterSecondVipUserCount, afterFirstVipUserCount, '第二次回调后 vip_user 条数不应增加');

    console.log('VIP pay notify 幂等回归测试通过。');
  } finally {
    const safeCleanupQuery = async(sql, params, label) => {
      try {
        await conn.query(sql, params);
      } catch (error) {
        console.warn(`[cleanup][${label}] ${error.message || error}`);
      }
    };
    if (cleanup.orderId > 0) {
      await safeCleanupQuery('DELETE FROM hiolabs_vip_event_log WHERE order_id = ?', [Number(cleanup.orderId)], 'vip_event_log');
    }
    await safeCleanupQuery('DELETE FROM hiolabs_vip_coupon_grant_log WHERE user_id = ?', [Number(userId)], 'vip_coupon_grant_log');
    await safeCleanupQuery("DELETE FROM hiolabs_user_coupon WHERE user_id = ? AND grant_batch_key LIKE 'vip:%'", [Number(userId)], 'user_coupon');
    if (cleanup.vipOrderId > 0) {
      await safeCleanupQuery('DELETE FROM hiolabs_vip_order WHERE id = ?', [Number(cleanup.vipOrderId)], 'vip_order_by_id');
    } else {
      await safeCleanupQuery('DELETE FROM hiolabs_vip_order WHERE user_id = ?', [Number(userId)], 'vip_order_by_user');
    }
    if (cleanup.vipUserId > 0) {
      await safeCleanupQuery('DELETE FROM hiolabs_vip_user WHERE id = ?', [Number(cleanup.vipUserId)], 'vip_user_by_id');
    } else {
      await safeCleanupQuery('DELETE FROM hiolabs_vip_user WHERE user_id = ?', [Number(userId)], 'vip_user_by_user');
    }
    if (cleanup.orderId > 0) {
      await safeCleanupQuery('DELETE FROM hiolabs_order WHERE id = ?', [Number(cleanup.orderId)], 'order_by_id');
    } else {
      await safeCleanupQuery('DELETE FROM hiolabs_order WHERE user_id = ? AND order_type = 8', [Number(userId)], 'order_by_user');
    }
    if (cleanup.userCreated) {
      await safeCleanupQuery('DELETE FROM hiolabs_user WHERE id = ?', [Number(userId)], 'user');
    }
    await conn.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('VIP pay notify 幂等回归测试失败:', err.message);
  process.exit(1);
});
