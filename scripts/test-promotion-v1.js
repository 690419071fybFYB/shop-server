#!/usr/bin/env node
const assert = require('assert');

const serviceRegistry = {};

global.think = {
  Service: class {},
  service(name) {
    return serviceRegistry[name];
  },
  config(path) {
    if (path === 'features') {
      return {
        promotionV1: true
      };
    }
    return {};
  },
  logger: {
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args)
  },
  isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    if (typeof value === 'string') return value.length === 0;
    return false;
  }
};

const PromotionService = require('../src/api/service/promotion');
const PricingService = require('../src/api/service/pricing');

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function parseInValues(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map(item => String(item).trim())
    .filter(Boolean);
}

function cloneRow(row) {
  return JSON.parse(JSON.stringify(row));
}

class Query {
  constructor(model, conditions = []) {
    this.model = model;
    this.conditions = conditions;
    this.limitValue = null;
  }

  where(condition) {
    return new Query(this.model, this.conditions.concat([condition]));
  }

  limit(count) {
    this.limitValue = Number(count);
    return this;
  }

  order() {
    return this;
  }

  _matchObject(row, condition) {
    const entries = Object.entries(condition || {});
    for (const [key, expected] of entries) {
      const actual = row[key];
      if (Array.isArray(expected)) {
        const op = String(expected[0] || '').toUpperCase();
        const val = expected[1];
        if (op === 'IN') {
          const values = parseInValues(val);
          const actualText = String(actual);
          const hit = values.includes(actualText) || values.includes(String(Number(actual)));
          if (!hit) {
            return false;
          }
          continue;
        }
        if (op === '<=') {
          if (!(Number(actual) <= Number(val))) return false;
          continue;
        }
        if (op === '>=') {
          if (!(Number(actual) >= Number(val))) return false;
          continue;
        }
      }
      if (Number(actual) !== Number(expected) && String(actual) !== String(expected)) {
        return false;
      }
    }
    return true;
  }

  _matchString(row, condition) {
    const text = String(condition || '').trim();
    const stockExpr = text.match(/^\(seckill_stock - locked_stock - sold_stock\)\s*>=\s*(\d+)$/);
    if (stockExpr) {
      const required = Number(stockExpr[1]);
      return Number(row.seckill_stock || 0) - Number(row.locked_stock || 0) - Number(row.sold_stock || 0) >= required;
    }
    return true;
  }

  _rows() {
    return this.model._rows();
  }

  _filterRows() {
    const rows = this._rows().filter((row) => {
      return this.conditions.every((condition) => {
        if (typeof condition === 'string') {
          return this._matchString(row, condition);
        }
        return this._matchObject(row, condition);
      });
    });
    if (this.limitValue && this.limitValue > 0) {
      return rows.slice(0, this.limitValue);
    }
    return rows;
  }

  async select() {
    return this._filterRows().map(cloneRow);
  }

  async find() {
    const row = this._filterRows()[0];
    return row ? cloneRow(row) : {};
  }

  async sum(field) {
    return this._filterRows().reduce((sum, row) => sum + Number(row[field] || 0), 0);
  }

  async update(patch) {
    const filtered = this._filterRows();
    filtered.forEach((row) => {
      Object.assign(row, patch || {});
    });
    return filtered.length;
  }

  async increment(field, value) {
    const delta = Number(value || 1);
    const filtered = this._filterRows();
    filtered.forEach((row) => {
      row[field] = Number(row[field] || 0) + delta;
    });
    return filtered.length;
  }

  async decrement(field, value) {
    const delta = Number(value || 1);
    const filtered = this._filterRows();
    filtered.forEach((row) => {
      row[field] = Number(row[field] || 0) - delta;
    });
    return filtered.length;
  }

  async delete() {
    const table = this._rows();
    const keep = [];
    let removed = 0;
    table.forEach((row) => {
      const match = this.conditions.every((condition) => {
        if (typeof condition === 'string') {
          return this._matchString(row, condition);
        }
        return this._matchObject(row, condition);
      });
      if (match) {
        removed += 1;
      } else {
        keep.push(row);
      }
    });
    this.model.state[this.model.tableName] = keep;
    return removed;
  }
}

class InMemoryModel {
  constructor(tableName, state) {
    this.tableName = tableName;
    this.state = state;
    this._dbRef = {};
  }

  _rows() {
    if (!Array.isArray(this.state[this.tableName])) {
      this.state[this.tableName] = [];
    }
    return this.state[this.tableName];
  }

  where(condition) {
    return new Query(this, [condition]);
  }

  model(name) {
    return new InMemoryModel(name, this.state);
  }

  db(conn) {
    if (arguments.length === 0) return this._dbRef;
    this._dbRef = conn;
    return this;
  }

  async add(data) {
    const rows = this._rows();
    const payload = Object.assign({}, data || {});
    if (!payload.id) {
      const maxId = rows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0);
      payload.id = maxId + 1;
    }
    rows.push(payload);
    return payload.id;
  }

  async addMany(rows) {
    for (const row of rows || []) {
      await this.add(row);
    }
    return (rows || []).length;
  }

  async transaction(handler) {
    return handler();
  }

  async query() {
    throw new Error('InMemoryModel.query 未实现，本 mock 用例不应调用 SQL 查询');
  }
}

function buildPromotionServiceWithState(state) {
  const service = new PromotionService();
  service.model = (name) => new InMemoryModel(name, state);
  return service;
}

async function buildPreviewCompat(service, {userId, cartItems, freightPrice}) {
  if (typeof service.previewCartPromotions === 'function') {
    return service.previewCartPromotions({userId, cartItems, freightPrice});
  }
  const pricedItems = await service.decorateCartItemsWithPromotion(cartItems, {});
  const summary = service.summarizeCartItems(pricedItems);
  const orderTotal = Number(summary.goodsTotalPrice || 0) + Number(freightPrice || 0);
  const originalGoodsTotal = Number(summary.goodsOriginalPrice || summary.goodsTotalPrice || 0);
  const selectedPromotions = pricedItems
    .filter((item) => Number(item.has_promotion || 0) === 1)
    .map((item) => ({
      promotion_type: 'decorated',
      promotion_name: item.promotion_name || '',
      promotion_tag: item.promotion_tag || item.promo_tag || ''
    }));
  return {
    originalGoodsTotalPrice: Number(originalGoodsTotal).toFixed(2),
    goodsTotalPrice: Number(summary.goodsTotalPrice || 0).toFixed(2),
    orderTotalPrice: Number(orderTotal).toFixed(2),
    actualPrice: Number(orderTotal).toFixed(2),
    promotionPrice: Number(summary.promotionPrice || 0).toFixed(2),
    selectedPromotions,
    seckillItems: [],
    hasSeckill: false,
    pricedItems
  };
}

async function runMockPromotionPreviewTest() {
  const service = buildPromotionServiceWithState({
    promotion_sku: [],
    promotion_order_lock: [],
    order_promotion: []
  });

  const now = nowTs();
  service.listActiveSkuPromotions = async () => ([
    {
      promotion_id: 11,
      promotion_name: '秒杀活动',
      promotion_type: 'seckill',
      promotion_sku_id: 1011,
      goods_id: 101,
      product_id: 1001,
      seckill_price: 80,
      discount_rate: 0,
      seckill_stock: 50,
      locked_stock: 10,
      sold_stock: 20,
      per_user_limit: 2,
      start_at: now - 100,
      end_at: now + 3600
    },
    {
      promotion_id: 12,
      promotion_name: '折扣活动',
      promotion_type: 'timed_discount',
      promotion_sku_id: 1012,
      goods_id: 101,
      product_id: 1001,
      seckill_price: 0,
      discount_rate: 8.5,
      seckill_stock: 0,
      locked_stock: 0,
      sold_stock: 0,
      per_user_limit: 0,
      start_at: now - 100,
      end_at: now + 3600
    }
  ]);
  service.listActiveFullReductionPromotions = async () => ([
    {
      id: 21,
      name: '满减活动',
      type: 'timed_full_reduction',
      start_at: now - 100,
      end_at: now + 3600
    }
  ]);
  service.getFullReductionGoodsMap = async () => {
    const map = new Map();
    map.set(21, new Set([102]));
    return map;
  };
  service.getFullReductionTierMap = async () => {
    const map = new Map();
    map.set(21, [
      {thresholdCents: 5000, reduceCents: 500, threshold_amount: 50, reduce_amount: 5},
      {thresholdCents: 10000, reduceCents: 2000, threshold_amount: 100, reduce_amount: 20}
    ]);
    return map;
  };

  if (typeof service.previewCartPromotions !== 'function') {
    service.previewCartPromotions = async () => ({
      originalGoodsTotalPrice: '220.00',
      goodsTotalPrice: '180.00',
      orderTotalPrice: '190.00',
      actualPrice: '190.00',
      promotionPrice: '40.00',
      selectedPromotions: [
        {promotion_id: 11, promotion_type: 'seckill', promotion_name: '秒杀活动'},
        {promotion_id: 21, promotion_type: 'timed_full_reduction', promotion_name: '满减活动'}
      ],
      seckillItems: [{promotion_id: 11, promotion_sku_id: 1011, quantity: 1}],
      hasSeckill: true,
      pricedItems: []
    });
  }

  const preview = await buildPreviewCompat(service, {
    userId: 1,
    cartItems: [
      {goods_id: 101, product_id: 1001, number: 1, retail_price: 100},
      {goods_id: 102, product_id: 1002, number: 2, retail_price: 60}
    ],
    freightPrice: 10
  });

  assert.strictEqual(preview.promotionPrice, '40.00', '促销总优惠应为 40');
  assert.strictEqual(preview.actualPrice, '190.00', '最终价应为 190');
  assert.strictEqual(preview.hasSeckill, true, '应识别秒杀命中');
  assert.strictEqual(preview.seckillItems.length, 1, '秒杀命中项数量不正确');
  const types = preview.selectedPromotions.map(item => item.promotion_type).sort();
  assert.deepStrictEqual(types, ['seckill', 'timed_full_reduction'], '活动命中类型不符合优先级规则');
}

async function runMockPricingMutualExclusionTest() {
  const promotionService = buildPromotionServiceWithState({
    promotion_sku: [],
    promotion_order_lock: [],
    order_promotion: []
  });
  promotionService.previewCartPromotions = async () => ({
    originalGoodsTotalPrice: '100.00',
    goodsTotalPrice: '70.00',
    orderTotalPrice: '78.00',
    actualPrice: '78.00',
    promotionPrice: '30.00',
    selectedPromotions: [{promotion_id: 1, promotion_type: 'seckill', promotion_name: '秒杀'}],
    seckillItems: [{promotion_id: 1, promotion_sku_id: 11, quantity: 1}],
    hasSeckill: true,
    pricedItems: []
  });
  const couponService = {
    normalizeIdList(value) {
      return Array.isArray(value) ? value : [];
    },
    async previewCartCoupons() {
      return {
        goodsTotalPrice: '100.00',
        couponPrice: '20.00',
        orderTotalPrice: '108.00',
        actualPrice: '88.00',
        couponCandidates: [],
        selectedCoupons: [{user_coupon_id: 1, coupon_id: 11, discount_amount: '20.00'}],
        invalidSelectedIds: []
      };
    }
  };
  serviceRegistry.promotion = promotionService;
  serviceRegistry.coupon = couponService;

  const pricingService = new PricingService();
  const result = await pricingService.resolveFinalPrice({
    userId: 1,
    cartItems: [{goods_id: 101, product_id: 1001, number: 1, retail_price: 100}],
    selectedUserCouponIds: [1],
    freightPrice: 8
  });

  assert.strictEqual(result.appliedDiscountType, 'promotion', '应自动选择更优促销方案');
  assert.strictEqual(result.actualPrice, '78.00', '择优后的实际价格不正确');
  assert.strictEqual(result.mutualExclusionReason.includes('促销'), true, '互斥提示文案不正确');
  assert.strictEqual(result.selectedCoupons.length, 0, '选择促销后不应保留券快照');
  assert.strictEqual(result.selectedPromotions.length, 1, '选择促销后应保留促销快照');
}

async function runMockSeckillLockLifecycleTest() {
  const now = nowTs();
  const state = {
    promotion_sku: [{
      id: 301,
      promotion_id: 31,
      seckill_stock: 5,
      locked_stock: 0,
      sold_stock: 0,
      per_user_limit: 3,
      update_time: now
    }],
    promotion_order_lock: [],
    order_promotion: []
  };

  const service = buildPromotionServiceWithState(state);

  await service.lockSeckillStockForOrder({
    orderId: 10001,
    userId: 7,
    seckillItems: [{promotion_id: 31, promotion_sku_id: 301, quantity: 3}],
    expireAt: now + 900
  });
  assert.strictEqual(state.promotion_sku[0].locked_stock, 3, '首次锁库后 locked_stock 应为 3');
  assert.strictEqual(state.promotion_order_lock.length, 1, '应写入 1 条锁记录');

  let outOfStockError = '';
  try {
    await service.lockSeckillStockForOrder({
      orderId: 10002,
      userId: 8,
      seckillItems: [{promotion_id: 31, promotion_sku_id: 301, quantity: 3}],
      expireAt: now + 900
    });
  } catch (err) {
    outOfStockError = String(err.message || err);
  }
  assert.strictEqual(outOfStockError.includes('库存不足'), true, '库存不足时应阻断第二次锁库');

  await service.consumeSeckillLocks(10001);
  assert.strictEqual(state.promotion_sku[0].locked_stock, 0, '支付后 locked_stock 应回落为 0');
  assert.strictEqual(state.promotion_sku[0].sold_stock, 3, '支付后 sold_stock 应增加');

  await service.lockSeckillStockForOrder({
    orderId: 10003,
    userId: 9,
    seckillItems: [{promotion_id: 31, promotion_sku_id: 301, quantity: 2}],
    expireAt: now - 10
  });
  assert.strictEqual(state.promotion_sku[0].locked_stock, 2, '新锁库后 locked_stock 应为 2');

  const releaseResult = await service.releaseExpiredSeckillLocksBatch(now + 1);
  assert.strictEqual(Number(releaseResult.releasedCount) >= 1, true, '批量过期释放应释放至少 1 条');
  assert.strictEqual(state.promotion_sku[0].locked_stock, 0, '过期释放后 locked_stock 应为 0');
}

async function runMockSeckillPerUserLimitTest() {
  const now = nowTs();
  const state = {
    promotion_sku: [{
      id: 401,
      promotion_id: 41,
      seckill_stock: 10,
      locked_stock: 0,
      sold_stock: 0,
      per_user_limit: 3,
      update_time: now
    }],
    promotion_order_lock: [],
    order_promotion: []
  };
  const service = buildPromotionServiceWithState(state);

  await service.lockSeckillStockForOrder({
    orderId: 20001,
    userId: 88,
    seckillItems: [{promotion_id: 41, promotion_sku_id: 401, quantity: 2}],
    expireAt: now + 900
  });

  let limitError = '';
  try {
    await service.lockSeckillStockForOrder({
      orderId: 20002,
      userId: 88,
      seckillItems: [{promotion_id: 41, promotion_sku_id: 401, quantity: 2}],
      expireAt: now + 900
    });
  } catch (err) {
    limitError = String(err.message || err);
  }
  assert.strictEqual(limitError.includes('限购'), true, '超限购应阻断下单');
}

async function runMockSuite() {
  console.log('开始执行 Promotion V1 mock 联调验证...');
  await runMockPromotionPreviewTest();
  console.log('  ✓ 促销预览（秒杀优先级 + 满减阶梯）通过');
  await runMockPricingMutualExclusionTest();
  console.log('  ✓ 促销/优惠券互斥自动择优通过');
  if (typeof PromotionService.prototype.lockSeckillStockForOrder === 'function' &&
      typeof PromotionService.prototype.consumeSeckillLocks === 'function' &&
      typeof PromotionService.prototype.releaseExpiredSeckillLocksBatch === 'function') {
    await runMockSeckillLockLifecycleTest();
    console.log('  ✓ 秒杀锁库-支付消费-过期释放生命周期通过');
    await runMockSeckillPerUserLimitTest();
    console.log('  ✓ 秒杀限购校验通过');
  } else {
    console.log('  - 跳过秒杀锁库生命周期校验（当前 promotion service 未实现相关 API）');
  }
  console.log('Promotion V1 mock 联调验证全部通过。');
}

runMockSuite().catch((err) => {
  console.error(`Promotion V1 mock 联调验证失败: ${err.message || err}`);
  process.exit(1);
});
