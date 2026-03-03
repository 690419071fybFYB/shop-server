/* eslint-disable no-console */
const assert = require('assert');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const ADMIN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'SLDLKKDS323ssdd@#@@gf';
const API_SECRET = process.env.API_TOKEN_SECRET || 'sdfsdfsdf123123!ASDasdasdasdasda';
const BASE_URL = process.env.COUPON_TEST_BASE_URL || 'http://127.0.0.1:8360';
const ADMIN_USER_ID = Number(process.env.COUPON_TEST_ADMIN_USER_ID || 14);
const USER_ID = Number(process.env.COUPON_TEST_USER_ID || 1);
const DB_HOST = process.env.COUPON_TEST_DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.COUPON_TEST_DB_PORT || 3306);
const DB_USER = process.env.COUPON_TEST_DB_USER || 'root';
const DB_PASSWORD = process.env.COUPON_TEST_DB_PASSWORD || 'CHANGE_ME_STRONG_PASSWORD';
const DB_NAME = process.env.COUPON_TEST_DB_NAME || 'hiolabsDB';

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function buildToken(secret, userId) {
  return jwt.sign({user_id: Number(userId)}, secret);
}

async function requestApi(path, {method = 'GET', token = '', query = {}, body} = {}) {
  const url = new URL(path, BASE_URL);
  Object.keys(query || {}).forEach((key) => {
    const value = query[key];
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
    throw new Error(`[${path}] 非JSON响应: ${text.slice(0, 300)}`);
  }
  if (Number(payload.errno) !== 0) {
    throw new Error(`[${path}] errno=${payload.errno} errmsg=${payload.errmsg || ''}`);
  }
  return payload.data;
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

async function ensureAddressAndCart(conn, userId) {
  const [products] = await conn.query(`
    SELECT
      p.id AS product_id,
      p.goods_id,
      p.goods_sn,
      p.goods_specification_ids,
      p.goods_weight,
      p.retail_price,
      p.goods_name AS product_goods_name,
      g.name AS goods_name,
      g.list_pic_url,
      g.freight_template_id
    FROM hiolabs_product p
    INNER JOIN hiolabs_goods g ON p.goods_id = g.id
    WHERE p.is_delete = 0
      AND p.is_on_sale = 1
      AND p.goods_number > 0
      AND g.is_delete = 0
      AND g.is_on_sale = 1
      AND g.freight_template_id > 0
    ORDER BY p.id ASC
    LIMIT 1
  `);
  assert(products.length > 0, '未找到可用商品用于测试');
  const product = products[0];

  await conn.query('DELETE FROM hiolabs_address WHERE user_id = ?', [Number(userId)]);
  const [insertAddress] = await conn.query(`
    INSERT INTO hiolabs_address
      (name, user_id, country_id, province_id, city_id, district_id, address, mobile, is_default, is_delete)
    VALUES
      (?, ?, 1, 2, 37, 403, ?, ?, 1, 0)
  `, [
    `coupon-test-${userId}`,
    Number(userId),
    `road-${Date.now()}`,
    `1380000${String(userId).padStart(4, '0').slice(-4)}`
  ]);
  const addressId = Number(insertAddress.insertId);

  await conn.query('DELETE FROM hiolabs_cart WHERE user_id = ?', [Number(userId)]);
  const goodsName = String(product.product_goods_name || product.goods_name || `goods-${product.goods_id}`);
  await conn.query(`
    INSERT INTO hiolabs_cart
      (user_id, goods_id, goods_sn, product_id, goods_name, goods_aka, goods_weight,
       add_price, retail_price, number, goods_specifition_name_value, goods_specifition_ids,
       checked, list_pic_url, freight_template_id, is_on_sale, add_time, is_fast, is_delete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?, ?, 1, ?, 0, 0)
  `, [
    Number(userId),
    Number(product.goods_id),
    String(product.goods_sn || product.goods_id),
    Number(product.product_id),
    goodsName,
    goodsName,
    Number(product.goods_weight || 0),
    Number(product.retail_price || 0),
    Number(product.retail_price || 0),
    String(product.goods_specification_ids || 'default'),
    String(product.goods_specification_ids || ''),
    String(product.list_pic_url || ''),
    Number(product.freight_template_id || 0),
    nowTs()
  ]);
  return {addressId};
}

async function createCoupon(adminToken, baseName, type) {
  const now = nowTs();
  const payload = {
    name: `${baseName}-${now}-${Math.floor(Math.random() * 10000)}`,
    type,
    threshold_amount: 100,
    reduce_amount: type === 'full_reduction' ? 20 : 0,
    discount_rate: type === 'discount' ? 9 : 10,
    discount_max_reduce: type === 'discount' ? 50 : 0,
    scope_type: 'all',
    claim_start_at: now,
    claim_end_at: now + 3 * 24 * 3600,
    use_start_at: now,
    use_end_at: now + 5 * 24 * 3600,
    total_limit: 1000,
    per_user_limit: 1,
    status: 'enabled',
    segment_rules: {
      groups: ['new_customer', 'old_customer'],
      match: 'OR'
    }
  };
  const data = await requestApi('/admin/coupon/create', {
    method: 'POST',
    token: adminToken,
    body: payload
  });
  return Number(data.id);
}

async function receiveCoupon(apiToken, couponId) {
  const data = await requestApi('/api/coupon/receive', {
    method: 'POST',
    token: apiToken,
    body: {couponId}
  });
  return Number(data.userCouponId);
}

async function submitOrder(apiToken, payload) {
  const data = await requestApi('/api/order/submit', {
    method: 'POST',
    token: apiToken,
    body: payload
  });
  return Number(data.orderInfo.id);
}

async function getUserCouponRow(conn, userCouponId) {
  const [rows] = await conn.query(`
    SELECT id, coupon_id, user_id, status, lock_order_id, used_order_id, discount_amount
    FROM hiolabs_user_coupon
    WHERE id = ?
  `, [Number(userCouponId)]);
  assert(rows.length === 1, `user_coupon 不存在: ${userCouponId}`);
  return rows[0];
}

async function main() {
  const adminToken = buildToken(ADMIN_SECRET, ADMIN_USER_ID);
  const apiToken = buildToken(API_SECRET, USER_ID);
  const conn = await openDb();

  try {
    console.log('1) 准备测试地址和购物车');
    let setup = await ensureAddressAndCart(conn, USER_ID);
    let addressId = setup.addressId;

    console.log('2) 创建并领取满减券 + 折扣券');
    const fullReductionCouponId = await createCoupon(adminToken, 'auto-full', 'full_reduction');
    const discountCouponId = await createCoupon(adminToken, 'auto-discount', 'discount');
    const fullReductionUserCouponId = await receiveCoupon(apiToken, fullReductionCouponId);
    const discountUserCouponId = await receiveCoupon(apiToken, discountCouponId);

    console.log('3) 校验跨类型叠加（先满减后折扣）');
    const previewData = await requestApi('/api/coupon/preview', {
      method: 'POST',
      token: apiToken,
      body: {
        addType: 0,
        orderFrom: 0,
        freightPrice: 8,
        selectedUserCouponIds: [fullReductionUserCouponId, discountUserCouponId]
      }
    });
    assert(Array.isArray(previewData.selectedCoupons), 'preview.selectedCoupons 非数组');
    assert(previewData.selectedCoupons.length === 2, '跨类型叠加应选中2张券');
    assert(previewData.selectedCoupons[0].coupon_type === 'full_reduction', '叠加顺序应先满减');
    assert(previewData.selectedCoupons[1].coupon_type === 'discount', '叠加顺序应后折扣');

    console.log('4) 在线单：下单锁券 + 取消释放');
    setup = await ensureAddressAndCart(conn, USER_ID);
    addressId = setup.addressId;
    const onlineOrderId = await submitOrder(apiToken, {
      addressId,
      freightPrice: 8,
      postscript: '',
      offlinePay: 0,
      selectedUserCouponIds: [fullReductionUserCouponId]
    });
    let row = await getUserCouponRow(conn, fullReductionUserCouponId);
    assert(row.status === 'locked', '在线单提交后券应为 locked');
    assert(Number(row.lock_order_id) === onlineOrderId, 'lock_order_id 应等于订单ID');
    await requestApi('/api/order/cancel', {
      method: 'POST',
      token: apiToken,
      body: {orderId: onlineOrderId}
    });
    row = await getUserCouponRow(conn, fullReductionUserCouponId);
    assert(row.status === 'unused', '取消订单后券应释放为 unused');
    assert(Number(row.lock_order_id) === 0, '取消订单后 lock_order_id 应清零');

    console.log('5) 在线单：支付后核销');
    setup = await ensureAddressAndCart(conn, USER_ID);
    addressId = setup.addressId;
    const paidOrderId = await submitOrder(apiToken, {
      addressId,
      freightPrice: 8,
      postscript: '',
      offlinePay: 0,
      selectedUserCouponIds: [fullReductionUserCouponId]
    });
    await requestApi('/api/pay/preWeixinPaya', {
      method: 'GET',
      token: apiToken,
      query: {orderId: paidOrderId}
    });
    row = await getUserCouponRow(conn, fullReductionUserCouponId);
    assert(row.status === 'used', '支付后券应为 used');
    assert(Number(row.used_order_id) === paidOrderId, 'used_order_id 应等于已支付订单ID');

    console.log('6) 线下单：下单即核销');
    setup = await ensureAddressAndCart(conn, USER_ID);
    addressId = setup.addressId;
    const offlineOrderId = await submitOrder(apiToken, {
      addressId,
      freightPrice: 8,
      postscript: '',
      offlinePay: 1,
      selectedUserCouponIds: [discountUserCouponId]
    });
    const discountRow = await getUserCouponRow(conn, discountUserCouponId);
    assert(discountRow.status === 'used', '线下单提交后券应直接 used');
    assert(Number(discountRow.used_order_id) === offlineOrderId, '线下单 used_order_id 应为当前订单');

    console.log('7) 同类型多张校验');
    const extraFullCouponId1 = await createCoupon(adminToken, 'auto-same-type-1', 'full_reduction');
    const extraFullCouponId2 = await createCoupon(adminToken, 'auto-same-type-2', 'full_reduction');
    const extraUserCouponId1 = await receiveCoupon(apiToken, extraFullCouponId1);
    const extraUserCouponId2 = await receiveCoupon(apiToken, extraFullCouponId2);
    await ensureAddressAndCart(conn, USER_ID);
    const sameTypePreview = await requestApi('/api/coupon/preview', {
      method: 'POST',
      token: apiToken,
      body: {
        addType: 0,
        orderFrom: 0,
        freightPrice: 8,
        selectedUserCouponIds: [extraUserCouponId1, extraUserCouponId2]
      }
    });
    assert(Array.isArray(sameTypePreview.invalidSelectedIds), 'invalidSelectedIds 非数组');
    assert(sameTypePreview.invalidSelectedIds.includes(extraUserCouponId1), '同类型校验应标记第1张无效');
    assert(sameTypePreview.invalidSelectedIds.includes(extraUserCouponId2), '同类型校验应标记第2张无效');
    assert(Array.isArray(sameTypePreview.selectedCoupons) && sameTypePreview.selectedCoupons.length === 0, '同类型冲突时不应选中优惠券');

    console.log('8) 后台记录接口可用');
    await requestApi('/admin/coupon/claimRecord', {
      method: 'GET',
      token: adminToken,
      query: {page: 1, size: 5}
    });
    await requestApi('/admin/coupon/useRecord', {
      method: 'GET',
      token: adminToken,
      query: {page: 1, size: 5}
    });

    console.log('Coupon 模块自动化冒烟通过。');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Coupon 自动化测试失败:', err.message);
  process.exit(1);
});
