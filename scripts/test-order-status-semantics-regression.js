#!/usr/bin/env node
const assert = require('assert');

global.think = global.think || {};
global.think.Model = global.think.Model || class {};
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

const ApiOrderModel = require('../src/api/model/order');

function createOrderModelWithStatus(orderStatus) {
  const model = new ApiOrderModel();
  model.where = () => ({
    find: async() => ({
      id: 9001,
      order_status: orderStatus
    })
  });
  return model;
}

function runGetOrderStatusRegression() {
  console.log('1) showType 状态集回归（含 5xx）');
  const model = new ApiOrderModel();
  const allStatus = model.getOrderStatus(0);
  assert(Array.isArray(allStatus), 'showType=0 应返回数组');
  assert(allStatus.includes(501), 'all 状态应包含 501');
  const originalLength = allStatus.length;
  allStatus.push(9999);
  const secondRead = model.getOrderStatus(0);
  assert.strictEqual(secondRead.length, originalLength, '返回数组应为副本，避免外部污染');
  assert.strictEqual(model.getOrderStatus(999), null, '非法 showType 应返回 null');
}

async function runOrderStatusTextRegression() {
  console.log('2) 订单状态文案映射回归');
  const cases = [{
    status: 202,
    expected: '退款中'
  }, {
    status: 203,
    expected: '已退款'
  }, {
    status: 302,
    expected: '待评价'
  }, {
    status: 303,
    expected: '待评价'
  }, {
    status: 501,
    expected: '售后处理中'
  }, {
    status: 801,
    expected: '拼团待付款'
  }, {
    status: 802,
    expected: '拼团中'
  }];
  for (const currentCase of cases) {
    const model = createOrderModelWithStatus(currentCase.status);
    const actual = await model.getOrderStatusText(9001);
    assert.strictEqual(actual, currentCase.expected, `status=${currentCase.status} 文案应为 ${currentCase.expected}`);
  }
}

async function runHandleOptionCompatibilityRegression() {
  console.log('3) 售后状态 handleOption 兼容回归');
  const model = createOrderModelWithStatus(501);
  const handleOption = await model.getOrderHandleOption(9001, 1001);
  assert.strictEqual(Boolean(handleOption.delete), false, '售后处理中不应允许删除');
  assert.strictEqual(Boolean(handleOption.pay), false, '售后处理中不应允许支付');
  assert.strictEqual(Boolean(handleOption.confirm), false, '售后处理中不应允许确认收货');
}

async function main() {
  runGetOrderStatusRegression();
  await runOrderStatusTextRegression();
  await runHandleOptionCompatibilityRegression();
  console.log('order status semantics 回归测试通过。');
}

main().catch((error) => {
  console.error('order status semantics 回归测试失败:', error.message);
  process.exit(1);
});
