#!/usr/bin/env node
const assert = require('assert');
const orderSnUtil = require('../src/common/utils/order_sn');

global.think = global.think || {};
global.think.Service = global.think.Service || class {};
global.think.Controller = global.think.Controller || class {};
global.think.service = global.think.service || (() => ({}));
global.think.logger = global.think.logger || {
  warn: () => {},
  error: () => {}
};

const ApiOrderService = require('../src/api/service/order');
const AdminOrderController = require('../src/admin/controller/order');

function buildDuplicateError(message = "Duplicate entry 'x' for key 'order_sn'") {
  const error = new Error(message);
  error.code = 'ER_DUP_ENTRY';
  error.errno = 1062;
  return error;
}

function createLoggerCollector() {
  const warnings = [];
  const errors = [];
  return {
    warnings,
    errors,
    logger: {
      warn: (message) => warnings.push(String(message || '')),
      error: (message) => errors.push(String(message || ''))
    }
  };
}

function assertOrderSnFormat(orderSn) {
  assert(/^\d{20}$/.test(orderSn), `order_sn 格式不合法: ${orderSn}`);
}

function runGeneratorRegression() {
  console.log('1) 订单号生成器格式回归');
  const fixed = orderSnUtil.generateOrderSn(new Date(2026, 10, 30, 23, 59, 59));
  assertOrderSnFormat(fixed);
  assert(
    fixed.startsWith('20261130235959'),
    `时间前缀错误（应为 YYYYMMDDHHmmss）: ${fixed.slice(0, 14)}`
  );

  const beforeMinute = orderSnUtil.generateOrderSn(new Date(2026, 11, 31, 23, 59, 59));
  const afterMinute = orderSnUtil.generateOrderSn(new Date(2027, 0, 1, 0, 0, 1));
  assert(beforeMinute.startsWith('20261231235959'), `跨分钟前缀异常: ${beforeMinute}`);
  assert(afterMinute.startsWith('20270101000001'), `跨分钟后缀异常: ${afterMinute}`);

  for (let i = 0; i < 500; i += 1) {
    assertOrderSnFormat(orderSnUtil.generateOrderSn());
  }
}

async function runRetrySuccessRegression() {
  console.log('2) 冲突重试回归：前两次冲突，第三次成功');
  const loggerBag = createLoggerCollector();
  let seq = 0;
  let executeCount = 0;

  const result = await orderSnUtil.withOrderSnRetry({
    maxRetries: 3,
    context: 'test.orderSn.retry.success',
    requestId: 'req-success',
    orderId: 1001,
    logger: loggerBag.logger,
    createOrderSn: () => `20260311000000${String(++seq).padStart(6, '0')}`,
    execute: async(orderSn, attempt) => {
      executeCount += 1;
      if (attempt <= 2) {
        throw buildDuplicateError();
      }
      return {orderSn, attempt};
    }
  });

  assert.strictEqual(executeCount, 3, '应执行 3 次后成功');
  assert.strictEqual(result.attempt, 3, '应在第 3 次成功');
  assertOrderSnFormat(result.orderSn);
  assert.strictEqual(loggerBag.warnings.length, 2, '应记录 2 条 warning');
  assert.strictEqual(loggerBag.errors.length, 0, '成功场景不应记录 error');
}

async function runRetryFailureRegression() {
  console.log('3) 冲突重试回归：三次都冲突后失败');
  const loggerBag = createLoggerCollector();
  let seq = 0;
  let executeCount = 0;
  let thrown = null;

  try {
    await orderSnUtil.withOrderSnRetry({
      maxRetries: 3,
      context: 'test.orderSn.retry.fail',
      requestId: 'req-fail',
      orderId: 1002,
      logger: loggerBag.logger,
      createOrderSn: () => `20260311000000${String(++seq).padStart(6, '0')}`,
      execute: async() => {
        executeCount += 1;
        throw buildDuplicateError();
      }
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown, '三次冲突后应抛出错误');
  assert.strictEqual(executeCount, 3, '失败场景应执行 3 次');
  assert.strictEqual(loggerBag.warnings.length, 2, '失败场景应记录 2 条 warning');
  assert.strictEqual(loggerBag.errors.length, 1, '失败场景应记录 1 条 error');
}

async function runNonOrderSnDuplicateRegression() {
  console.log('4) 非 order_sn 冲突不应重试');
  const loggerBag = createLoggerCollector();
  let executeCount = 0;
  let thrown = null;
  const nonOrderSnError = buildDuplicateError("Duplicate entry 'x' for key 'uniq_coupon_key'");

  try {
    await orderSnUtil.withOrderSnRetry({
      maxRetries: 3,
      context: 'test.orderSn.retry.nonOrderSn',
      requestId: 'req-non-order-sn',
      orderId: 1003,
      logger: loggerBag.logger,
      createOrderSn: () => '20260311000000123456',
      execute: async() => {
        executeCount += 1;
        throw nonOrderSnError;
      }
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown === nonOrderSnError, '应直接抛出原始错误');
  assert.strictEqual(executeCount, 1, '非 order_sn 冲突不应重试');
  assert.strictEqual(loggerBag.warnings.length, 0, '不应记录 warning');
  assert.strictEqual(loggerBag.errors.length, 0, '不应记录 error');
}

function createMockOrderModel({
  snList = [],
  duplicateAttempts = 0,
  successResult = 1
} = {}) {
  let snIndex = 0;
  let updateAttempt = 0;
  return {
    generateOrderNumber: () => snList[snIndex++] || `20260311000000${String(snIndex).padStart(6, '0')}`,
    where: () => ({
      update: async() => {
        updateAttempt += 1;
        if (updateAttempt <= duplicateAttempts) {
          throw buildDuplicateError();
        }
        return successResult;
      }
    }),
    getAttemptCount: () => updateAttempt
  };
}

async function runApiServiceRetryRegression() {
  console.log('5) API service 路径重试回归');
  const loggerBag = createLoggerCollector();
  global.think.logger = loggerBag.logger;
  global.think.service = () => ({
    lockOrConsumeCouponsForOrder: async() => {}
  });

  const snList = ['20260311000000000001', '20260311000000000002', '20260311000000000003'];
  const orderModel = {
    addAttempt: 0,
    db: () => ({}),
    add: async(payload) => {
      orderModel.addAttempt += 1;
      if (orderModel.addAttempt <= 2) {
        throw buildDuplicateError();
      }
      return 9000 + orderModel.addAttempt;
    }
  };
  const orderGoodsModel = {
    db: () => ({}),
    addMany: async() => {}
  };
  const transactionModel = {
    snIndex: 0,
    generateOrderNumber: () => snList[transactionModel.snIndex++],
    db: () => ({}),
    model: (name) => {
      if (name === 'order') return orderModel;
      if (name === 'order_goods') return orderGoodsModel;
      throw new Error(`unknown model ${name}`);
    },
    transaction: async(handler) => handler()
  };

  const service = new ApiOrderService();
  service.ctx = {state: {requestId: 'req-api-order-sn'}};
  service.model = (name) => {
    if (name !== 'order') {
      throw new Error(`unexpected model ${name}`);
    }
    return transactionModel;
  };

  const result = await service.createOrderWithItems({
    orderInfo: {user_id: 1001},
    pricedGoodsList: [],
    userId: 1001,
    selectedCoupons: []
  });

  assert.strictEqual(orderModel.addAttempt, 3, 'API service 应重试到第 3 次');
  assert.strictEqual(result.id, 9003, 'API service 成功后应返回订单 ID');
  assert.strictEqual(result.order_sn, snList[2], 'API service 应使用最终成功的 order_sn');
  assert.strictEqual(loggerBag.warnings.length, 2, 'API service 应记录 2 条 warning');
  assert.strictEqual(loggerBag.errors.length, 0, 'API service 成功场景不应记录 error');
}

async function runAdminControllerRetryRegression() {
  console.log('6) Admin 重打单号路径重试回归');
  const loggerBag = createLoggerCollector();
  global.think.logger = loggerBag.logger;

  const snList = ['20260311000000111111', '20260311000000222222', '20260311000000333333'];
  const orderModel = createMockOrderModel({
    snList,
    duplicateAttempts: 2,
    successResult: 1
  });

  const controller = new AdminOrderController();
  controller.ctx = {state: {requestId: 'req-admin-order-sn'}};
  controller.model = (name) => {
    if (name !== 'order') {
      throw new Error(`unexpected model ${name}`);
    }
    return orderModel;
  };

  const result = await controller.updateOrderSnWithRetry(7788);
  assert.strictEqual(orderModel.getAttemptCount(), 3, 'Admin 路径应重试到第 3 次');
  assert.strictEqual(result.orderSn, snList[2], 'Admin 路径应返回最终成功的 order_sn');
  assert.strictEqual(result.affectedRows, 1, 'Admin 路径应更新成功');
  assert.strictEqual(loggerBag.warnings.length, 2, 'Admin 路径应记录 2 条 warning');
  assert.strictEqual(loggerBag.errors.length, 0, 'Admin 成功场景不应记录 error');
}

async function runApiServiceFallbackGeneratorRegression() {
  console.log('7) API service 缺少 generateOrderNumber 时应回退公共生成器');
  const loggerBag = createLoggerCollector();
  global.think.logger = loggerBag.logger;
  global.think.service = () => ({
    lockOrConsumeCouponsForOrder: async() => {}
  });

  const expectedOrderSn = '20260311000000999999';
  const originalGenerateOrderSn = orderSnUtil.generateOrderSn;
  let generateCalled = 0;
  orderSnUtil.generateOrderSn = () => {
    generateCalled += 1;
    return expectedOrderSn;
  };

  try {
    const orderModel = {
      db: () => ({}),
      add: async() => 9101
    };
    const orderGoodsModel = {
      db: () => ({}),
      addMany: async() => {}
    };
    const transactionModel = {
      db: () => ({}),
      model: (name) => {
        if (name === 'order') return orderModel;
        if (name === 'order_goods') return orderGoodsModel;
        throw new Error(`unknown model ${name}`);
      },
      transaction: async(handler) => handler()
    };

    const service = new ApiOrderService();
    service.ctx = {state: {requestId: 'req-api-order-sn-fallback'}};
    service.model = (name) => {
      if (name !== 'order') {
        throw new Error(`unexpected model ${name}`);
      }
      return transactionModel;
    };

    const result = await service.createOrderWithItems({
      orderInfo: {user_id: 1002},
      pricedGoodsList: [],
      userId: 1002,
      selectedCoupons: []
    });

    assert.strictEqual(generateCalled, 1, '应调用一次公共 order_sn 生成器');
    assert.strictEqual(result.order_sn, expectedOrderSn, '应使用公共生成器返回的 order_sn');
    assert.strictEqual(result.id, 9101, '应成功创建订单并返回订单 ID');
  } finally {
    orderSnUtil.generateOrderSn = originalGenerateOrderSn;
  }
}

async function main() {
  runGeneratorRegression();
  await runRetrySuccessRegression();
  await runRetryFailureRegression();
  await runNonOrderSnDuplicateRegression();
  await runApiServiceRetryRegression();
  await runAdminControllerRetryRegression();
  await runApiServiceFallbackGeneratorRegression();
  console.log('order_sn 回归测试通过。');
}

main().catch((error) => {
  console.error('order_sn 回归测试失败:', error.message);
  process.exit(1);
});
