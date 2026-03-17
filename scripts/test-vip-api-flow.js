#!/usr/bin/env node
require('dotenv').config({path: '.env.local'});
require('dotenv').config();

const assert = require('assert');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE_URL = process.env.VIP_TEST_BASE_URL || process.env.COUPON_TEST_BASE_URL || 'http://127.0.0.1:8360';
const API_SECRET = process.env.API_JWT_SECRET || process.env.API_TOKEN_SECRET || '';
const USER_ID = Number(process.env.VIP_TEST_USER_ID || process.env.COUPON_TEST_USER_ID || 1048);

const DB_HOST = process.env.VIP_TEST_DB_HOST || process.env.COUPON_TEST_DB_HOST || process.env.TEST_DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.VIP_TEST_DB_PORT || process.env.COUPON_TEST_DB_PORT || process.env.TEST_DB_PORT || 3306);
const DB_USER = process.env.VIP_TEST_DB_USER || process.env.COUPON_TEST_DB_USER || process.env.TEST_DB_USER || 'root';
const DB_PASSWORD = process.env.VIP_TEST_DB_PASSWORD || process.env.COUPON_TEST_DB_PASSWORD || process.env.TEST_DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '';
const DB_NAME = process.env.VIP_TEST_DB_NAME || process.env.COUPON_TEST_DB_NAME || process.env.TEST_DB_NAME || 'hiolabsDB';

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function hasCjkText(value) {
  return /[\u3400-\u9FFF]/.test(String(value || ''));
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
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`[${path}] 非JSON响应: ${text.slice(0, 250)}`);
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
    Buffer.from(`vip-test-${userId}`, 'utf8').toString('base64'),
    `vip-test-${userId}`,
    ts,
    ts,
    `139${String(userId).padStart(8, '0').slice(-8)}`,
    `vip_test_openid_${userId}`
  ]);
  return true;
}

function assertPlanNameReadable(plan) {
  const name = String(plan.plan_name || plan.name || '').trim();
  assert(name, `套餐名称为空: ${JSON.stringify(plan)}`);
  assert(hasCjkText(name), `套餐名称存在乱码或不可读文本: ${name}`);
}

async function main() {
  if (!API_SECRET) {
    throw new Error('缺少 API_JWT_SECRET（兼容 API_TOKEN_SECRET）');
  }

  const token = buildToken(API_SECRET, USER_ID);
  const conn = await openDb();
  const cleanup = {
    createdUser: false,
    orderIds: [],
    vipOrderIds: []
  };

  try {
    cleanup.createdUser = await ensureUser(conn, USER_ID);

    console.log('1) 未登录访问 VIP 首页应返回 401');
    const unauthorizedHome = await requestApi('/api/vip/home');
    assert(Number(unauthorizedHome.payload.errno) === 401, `未登录访问 VIP 首页返回异常: ${JSON.stringify(unauthorizedHome.payload)}`);

    console.log('2) VIP 首页应返回可读套餐名称与可用套餐列表');
    const vipHome = await requestApi('/api/vip/home', {
      method: 'GET',
      token
    });
    assert(Number(vipHome.payload.errno) === 0, `VIP 首页失败: ${JSON.stringify(vipHome.payload)}`);
    const plans = (vipHome.payload.data && vipHome.payload.data.plans) || [];
    assert(Array.isArray(plans) && plans.length > 0, 'VIP 首页未返回套餐列表');
    plans.forEach(assertPlanNameReadable);

    const selectedPlan = plans.find((plan) => Number(plan.duration_days || plan.days || 0) >= 300) || plans[0];
    const selectedPlanId = Number(selectedPlan.plan_id || selectedPlan.id || 0);
    assert(selectedPlanId > 0, `套餐ID异常: ${JSON.stringify(selectedPlan)}`);

    console.log('3) VIP checkout 应返回匹配套餐与金额');
    const checkout = await requestApi('/api/vip/checkout', {
      method: 'GET',
      token,
      query: {planId: selectedPlanId}
    });
    assert(Number(checkout.payload.errno) === 0, `VIP checkout 失败: ${JSON.stringify(checkout.payload)}`);
    const checkoutData = checkout.payload.data || {};
    const checkoutPlan = checkoutData.selected_plan || {};
    assert(Number(checkoutPlan.plan_id || checkoutPlan.id || 0) === selectedPlanId, 'VIP checkout 返回套餐ID不一致');
    assert(String(checkoutData.amount || '').trim() !== '', 'VIP checkout 未返回金额');

    console.log('4) 非法套餐提交应失败');
    const invalidSubmit = await requestApi('/api/vip/submit', {
      method: 'POST',
      token,
      body: {planId: 0}
    });
    assert(Number(invalidSubmit.payload.errno) === 400, `非法套餐提交未按预期失败: ${JSON.stringify(invalidSubmit.payload)}`);

    console.log('5) VIP submit 应创建 order_type=8 的会员订单并正确落库');
    const submit = await requestApi('/api/vip/submit', {
      method: 'POST',
      token,
      body: {planId: selectedPlanId}
    });
    assert(Number(submit.payload.errno) === 0, `VIP submit 失败: ${JSON.stringify(submit.payload)}`);
    const orderInfo = submit.payload.data && submit.payload.data.orderInfo;
    const vipOrderInfo = submit.payload.data && submit.payload.data.vipOrderInfo;
    assert(orderInfo && Number(orderInfo.id || 0) > 0, 'VIP submit 未返回 orderInfo.id');
    assert(vipOrderInfo && Number(vipOrderInfo.id || 0) > 0, 'VIP submit 未返回 vipOrderInfo.id');

    const orderId = Number(orderInfo.id);
    const vipOrderId = Number(vipOrderInfo.id);
    cleanup.orderIds.push(orderId);
    cleanup.vipOrderIds.push(vipOrderId);

    const [orderRows] = await conn.query(`
      SELECT id, order_type, order_status, pay_status, actual_price
      FROM hiolabs_order
      WHERE id = ?
      LIMIT 1
    `, [orderId]);
    assert(orderRows.length === 1, `未找到会员订单: order_id=${orderId}`);
    assert(Number(orderRows[0].order_type) === 8, `会员订单类型异常: ${JSON.stringify(orderRows[0])}`);
    assert(Number(orderRows[0].order_status) === 101, `会员订单状态异常: ${JSON.stringify(orderRows[0])}`);
    assert(Number(orderRows[0].pay_status) === 0, `会员订单支付状态异常: ${JSON.stringify(orderRows[0])}`);

    const [vipOrderRows] = await conn.query(`
      SELECT id, order_id, plan_id, status, pay_status, refund_status
      FROM hiolabs_vip_order
      WHERE id = ?
      LIMIT 1
    `, [vipOrderId]);
    assert(vipOrderRows.length === 1, `未找到 vip_order: vip_order_id=${vipOrderId}`);
    assert(Number(vipOrderRows[0].order_id) === orderId, `vip_order.order_id 异常: ${JSON.stringify(vipOrderRows[0])}`);
    assert(String(vipOrderRows[0].status) === 'pending_pay', `vip_order.status 异常: ${JSON.stringify(vipOrderRows[0])}`);
    assert(String(vipOrderRows[0].pay_status) === 'unpaid', `vip_order.pay_status 异常: ${JSON.stringify(vipOrderRows[0])}`);

    console.log('6) 未支付会员订单不应允许退款申请');
    const refundApply = await requestApi('/api/vip/refundApply', {
      method: 'POST',
      token,
      body: {reason: 'regression-test'}
    });
    assert(Number(refundApply.payload.errno) === 400, `未支付订单退款申请语义异常: ${JSON.stringify(refundApply.payload)}`);

    console.log('VIP API flow 回归测试通过。');
  } finally {
    if (cleanup.vipOrderIds.length > 0) {
      await conn.query('DELETE FROM hiolabs_vip_order WHERE id IN (?)', [cleanup.vipOrderIds.map((id) => Number(id))]);
    }
    if (cleanup.orderIds.length > 0) {
      await conn.query('DELETE FROM hiolabs_order WHERE id IN (?)', [cleanup.orderIds.map((id) => Number(id))]);
    }
    if (cleanup.createdUser) {
      await conn.query('DELETE FROM hiolabs_user WHERE id = ?', [Number(USER_ID)]);
    }
    await conn.end();
  }
}

main().catch((err) => {
  console.error('VIP API flow 回归测试失败:', err.message);
  process.exit(1);
});
