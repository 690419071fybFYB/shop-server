#!/usr/bin/env node
const assert = require('assert');

global.think = global.think || {};
global.think.Service = global.think.Service || class {};
global.think.Controller = global.think.Controller || class {};
global.think.service = global.think.service || (() => ({}));
global.think.logger = global.think.logger || {
  warn: () => {},
  error: () => {}
};
global.think.isEmpty = global.think.isEmpty || ((value) => {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return value === '';
});

const AdminOrderController = require('../src/admin/controller/order');
const ApiOrderController = require('../src/api/controller/order');

function createAdminDestroyHarness({orderStatus = 102} = {}) {
  let transactionCalled = false;
  let orderDeleteCount = 0;
  let orderGoodsDeleteCount = 0;
  const orderRecord = {
    id: 7001,
    order_status: orderStatus
  };
  const orderModel = {
    db: () => ({}),
    field: () => ({
      where: () => ({
        find: async() => orderRecord
      })
    }),
    model: (name) => {
      if (name === 'order') {
        return orderModel;
      }
      if (name === 'order_goods') {
        return orderGoodsModel;
      }
      throw new Error(`unexpected model ${name}`);
    },
    transaction: async(handler) => {
      transactionCalled = true;
      return handler();
    },
    where: () => ({
      field: () => ({
        find: async() => orderRecord
      }),
      find: async() => orderRecord,
      limit: () => ({
        delete: async() => {
          orderDeleteCount += 1;
          return 1;
        }
      }),
      delete: async() => {
        orderDeleteCount += 1;
        return 1;
      }
    })
  };
  const orderGoodsModel = {
    db: () => ({}),
    where: () => ({
      delete: async() => {
        orderGoodsDeleteCount += 1;
        return 1;
      }
    })
  };

  const controller = new AdminOrderController();
  controller.post = (key) => key === 'id' ? 7001 : undefined;
  controller.model = (name) => {
    if (name === 'order') {
      return orderModel;
    }
    if (name === 'order_goods') {
      return orderGoodsModel;
    }
    throw new Error(`unexpected model ${name}`);
  };
  controller.success = (data) => ({errno: 0, data});
  controller.fail = (errno, errmsg) => ({errno: Number(errno), errmsg: String(errmsg || '')});

  return {
    controller,
    getState: () => ({
      transactionCalled,
      orderDeleteCount,
      orderGoodsDeleteCount
    })
  };
}

function createApiOrderUpdateHarness({
  orderStatus = 101,
  goodsPrice = 120.0,
  couponPrice = 10.0,
  freightPrice = 8.0
} = {}) {
  const updatePayloads = [];
  const freightCallBag = [];
  const orderGoodsRows = [{
    goods_id: 11,
    product_id: 101,
    number: 2,
    retail_price: 30
  }, {
    goods_id: 12,
    product_id: 102,
    number: 1,
    retail_price: 60
  }];
  const goodsMap = {
    11: {id: 11, freight_template_id: 5},
    12: {id: 12, freight_template_id: 5}
  };
  const productMap = {
    101: {id: 101, goods_weight: 0.8},
    102: {id: 102, goods_weight: 1.2}
  };

  const controller = new ApiOrderController();
  controller.post = (key) => {
    if (key === 'addressId') return 3001;
    if (key === 'orderId') return 8001;
    return undefined;
  };
  controller.requireUserIdOrAbort = () => 99;
  controller.ensureOwnedOrder = async() => ({
    id: 8001,
    user_id: 99,
    is_delete: 0,
    order_status: orderStatus,
    goods_price: goodsPrice,
    coupon_price: couponPrice,
    freight_price: freightPrice
  });
  controller.model = (name) => {
    if (name === 'address') {
      return {
        where: () => ({
          find: async() => ({
            id: 3001,
            user_id: 99,
            name: 'tester',
            mobile: '13800000000',
            province_id: 3,
            city_id: 38,
            district_id: 422,
            address: 'address line'
          })
        })
      };
    }
    if (name === 'order_goods') {
      return {
        where: () => ({
          select: async() => orderGoodsRows
        })
      };
    }
    if (name === 'goods') {
      return {
        where: (where) => ({
          field: () => ({
            find: async() => goodsMap[Number(where.id)] || {}
          }),
          find: async() => goodsMap[Number(where.id)] || {}
        })
      };
    }
    if (name === 'product') {
      return {
        where: (where) => ({
          field: () => ({
            find: async() => productMap[Number(where.id)] || {}
          }),
          find: async() => productMap[Number(where.id)] || {}
        })
      };
    }
    if (name === 'order') {
      return {
        where: (where) => ({
          update: async(payload) => {
            updatePayloads.push({
              where,
              payload
            });
            return 1;
          }
        })
      };
    }
    throw new Error(`unexpected model ${name}`);
  };
  controller.service = (name, module) => {
    if (module === 'api' && name === 'freight') {
      return {
        calculateFreightPrice: async(args) => {
          freightCallBag.push(args);
          return 18.5;
        }
      };
    }
    throw new Error(`unexpected service ${module}.${name}`);
  };
  controller.success = (data) => ({errno: 0, data});
  controller.fail = (errno, errmsg) => ({errno: Number(errno), errmsg: String(errmsg || '')});

  return {
    controller,
    updatePayloads,
    freightCallBag
  };
}

async function runAdminDeleteGuardRegression() {
  console.log('1) Admin 删单：非失效状态不可删除');
  const harness = createAdminDestroyHarness({orderStatus: 300});
  const result = await harness.controller.destoryAction();
  const state = harness.getState();
  assert.strictEqual(result.errno, 400, '进行中订单删除应返回 400');
  assert.strictEqual(state.orderDeleteCount, 0, '进行中订单不应删除主订单');
  assert.strictEqual(state.orderGoodsDeleteCount, 0, '进行中订单不应删除订单商品');
}

async function runAdminDeleteTransactionRegression() {
  console.log('2) Admin 删单：失效状态走事务删除');
  const harness = createAdminDestroyHarness({orderStatus: 102});
  const result = await harness.controller.destoryAction();
  const state = harness.getState();
  assert.strictEqual(result.errno, 0, '失效订单应允许删除');
  assert.strictEqual(state.transactionCalled, true, '删单应在事务中执行');
  assert.strictEqual(state.orderDeleteCount, 1, '应删除主订单');
  assert.strictEqual(state.orderGoodsDeleteCount, 1, '应删除订单商品');
}

async function runOrderUpdateStatusGuardRegression() {
  console.log('3) 订单改地址：仅待支付订单允许修改');
  const harness = createApiOrderUpdateHarness({orderStatus: 300});
  const result = await harness.controller.updateAction();
  assert.strictEqual(result.errno, 400, '非待支付订单改地址应返回 400');
  assert.strictEqual(harness.updatePayloads.length, 0, '非待支付订单不应更新数据');
}

async function runOrderUpdateFreightRegression() {
  console.log('4) 订单改地址：应重算运费并回写价格字段');
  const harness = createApiOrderUpdateHarness({
    orderStatus: 101,
    goodsPrice: 120,
    couponPrice: 10,
    freightPrice: 8
  });
  const result = await harness.controller.updateAction();
  assert.strictEqual(result.errno, 0, '待支付订单改地址应成功');
  assert.strictEqual(harness.freightCallBag.length, 1, '应调用运费计算服务');
  assert.strictEqual(harness.updatePayloads.length, 1, '应更新订单');
  const payload = harness.updatePayloads[0].payload || {};
  assert.strictEqual(Number(payload.freight_price), 18.5, '应写入重算后的运费');
  assert.strictEqual(Number(payload.order_price), 138.5, 'order_price 应=goods_price+freight_price');
  assert.strictEqual(Number(payload.actual_price), 128.5, 'actual_price 应扣减 coupon_price');
  assert.strictEqual(Number(payload.change_price), 128.5, 'change_price 应与 actual_price 一致');
}

async function main() {
  await runAdminDeleteGuardRegression();
  await runAdminDeleteTransactionRegression();
  await runOrderUpdateStatusGuardRegression();
  await runOrderUpdateFreightRegression();
  console.log('order maintenance 回归测试通过。');
}

main().catch((error) => {
  console.error('order maintenance 回归测试失败:', error.message);
  process.exit(1);
});
