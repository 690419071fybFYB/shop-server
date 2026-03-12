#!/usr/bin/env node
const assert = require('assert');

global.think = global.think || {};
global.think.Service = global.think.Service || class {};
global.think.Controller = global.think.Controller || class {};
global.think.logger = global.think.logger || {
  warn: () => {},
  error: () => {}
};

const CrontabController = require('../src/api/controller/crontab');

function createAutoCompleteHarness({
  currentTime = 2000000000,
  autoCompleteDays = 7,
  orders = []
} = {}) {
  let updatedWhere = null;
  let updatedPayload = null;
  let updateCalled = 0;

  const controller = new CrontabController();
  controller.getOrderAutoCompleteDays = () => autoCompleteDays;
  controller.model = (name) => {
    if (name !== 'order') {
      throw new Error(`unexpected model ${name}`);
    }
    return {
      where: (whereMap) => {
        if (whereMap && whereMap.order_status) {
          return {
            field: () => ({
              select: async() => orders.map(item => Object.assign({}, item))
            })
          };
        }
        if (whereMap && whereMap.id) {
          updatedWhere = whereMap;
          return {
            update: async(payload) => {
              updateCalled += 1;
              updatedPayload = payload;
              const ids = Array.isArray(whereMap.id) ? whereMap.id[1] : [];
              return Array.isArray(ids) ? ids.length : 0;
            }
          };
        }
        throw new Error(`unexpected where map: ${JSON.stringify(whereMap)}`);
      }
    };
  };

  return {
    controller,
    currentTime,
    getState: () => ({
      updateCalled,
      updatedWhere,
      updatedPayload
    })
  };
}

async function runAutoCompleteMatchRegression() {
  console.log('1) 超期已确认订单自动完成');
  const currentTime = 2000000000;
  const day = 24 * 60 * 60;
  const harness = createAutoCompleteHarness({
    currentTime,
    autoCompleteDays: 7,
    orders: [{
      id: 11,
      order_status: 302,
      confirm_time: currentTime - 8 * day,
      shipping_time: currentTime - 10 * day
    }, {
      id: 12,
      order_status: 303,
      confirm_time: currentTime - 2 * day,
      shipping_time: currentTime - 2 * day
    }, {
      id: 13,
      order_status: 302,
      confirm_time: 0,
      shipping_time: currentTime - 9 * day
    }, {
      id: 14,
      order_status: 303,
      confirm_time: 0,
      shipping_time: currentTime - 3 * day
    }]
  });
  const affected = await harness.controller.autoCompleteConfirmedOrders(currentTime);
  const state = harness.getState();
  assert.strictEqual(affected, 2, '应更新 2 条超期订单');
  assert.strictEqual(state.updateCalled, 1, '应执行一次批量更新');
  assert.deepStrictEqual(state.updatedWhere.id[1], [11, 13], '应仅更新超期订单 ID');
  assert.strictEqual(Number(state.updatedPayload.order_status), 401, '目标状态应为 401');
  assert.strictEqual(Number(state.updatedPayload.dealdone_time), currentTime, '完成时间应为当前时间');
}

async function runAutoCompleteNoMatchRegression() {
  console.log('2) 未超期订单不应更新');
  const currentTime = 2000000000;
  const day = 24 * 60 * 60;
  const harness = createAutoCompleteHarness({
    currentTime,
    autoCompleteDays: 7,
    orders: [{
      id: 21,
      order_status: 302,
      confirm_time: currentTime - 6 * day,
      shipping_time: currentTime - 8 * day
    }, {
      id: 22,
      order_status: 303,
      confirm_time: 0,
      shipping_time: currentTime - 6 * day
    }]
  });
  const affected = await harness.controller.autoCompleteConfirmedOrders(currentTime);
  const state = harness.getState();
  assert.strictEqual(affected, 0, '无超期订单应返回 0');
  assert.strictEqual(state.updateCalled, 0, '无超期订单不应写库');
}

function runAutoCompleteDaysParseRegression() {
  console.log('3) 自动完成天数配置解析');
  const controller = new CrontabController();
  const originalValue = process.env.ORDER_AUTO_COMPLETE_DAYS;
  try {
    process.env.ORDER_AUTO_COMPLETE_DAYS = '12';
    assert.strictEqual(controller.getOrderAutoCompleteDays(), 12, '应读取有效配置');
    process.env.ORDER_AUTO_COMPLETE_DAYS = '0';
    assert.strictEqual(controller.getOrderAutoCompleteDays(), 1, '应限制最小值为 1');
    process.env.ORDER_AUTO_COMPLETE_DAYS = 'invalid';
    assert.strictEqual(controller.getOrderAutoCompleteDays(), 7, '非法值应回退默认');
  } finally {
    if (typeof originalValue === 'undefined') {
      delete process.env.ORDER_AUTO_COMPLETE_DAYS;
    } else {
      process.env.ORDER_AUTO_COMPLETE_DAYS = originalValue;
    }
  }
}

async function main() {
  await runAutoCompleteMatchRegression();
  await runAutoCompleteNoMatchRegression();
  runAutoCompleteDaysParseRegression();
  console.log('order auto-complete crontab 回归测试通过。');
}

main().catch((error) => {
  console.error('order auto-complete crontab 回归测试失败:', error.message);
  process.exit(1);
});
