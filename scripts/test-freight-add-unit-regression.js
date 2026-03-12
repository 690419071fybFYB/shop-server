#!/usr/bin/env node
const assert = require('assert');

global.think = global.think || {};
global.think.Service = global.think.Service || class {};
global.think.isEmpty = global.think.isEmpty || ((value) => {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return value === '';
});

const FreightService = require('../src/api/service/freight');

function runAddUnitStepRegression() {
  console.log('1) add 步长回归（按件）');
  const service = new FreightService();
  const price = service.calculateTemplateFreight({
    summary: {number: 5, money: 100, goods_weight: 0},
    group: {
      start: 1,
      start_fee: 10,
      add: 2,
      add_fee: 3,
      free_by_number: 0,
      free_by_money: 0
    },
    freightType: 0
  });
  assert.strictEqual(price, 16, '5件、首件1、续件2、续费3 应为 16');
}

function runWeightStepRegression() {
  console.log('2) add 步长回归（按重）');
  const service = new FreightService();
  const price = service.calculateTemplateFreight({
    summary: {number: 2, money: 88, goods_weight: 5},
    group: {
      start: 1,
      start_fee: 10,
      add: 2,
      add_fee: 4,
      free_by_number: 0,
      free_by_money: 0
    },
    freightType: 1
  });
  assert.strictEqual(price, 18, '5kg、首重1、续重2、续费4 应为 18');
}

function runFreeThresholdRegression() {
  console.log('3) 包邮阈值回归');
  const service = new FreightService();
  const byNumber = service.calculateTemplateFreight({
    summary: {number: 3, money: 20, goods_weight: 3},
    group: {
      start: 1,
      start_fee: 12,
      add: 1,
      add_fee: 6,
      free_by_number: 3,
      free_by_money: 0
    },
    freightType: 0
  });
  assert.strictEqual(byNumber, 0, '达到件数包邮阈值应返回 0');

  const byMoney = service.calculateTemplateFreight({
    summary: {number: 2, money: 120, goods_weight: 2},
    group: {
      start: 1,
      start_fee: 12,
      add: 1,
      add_fee: 6,
      free_by_number: 0,
      free_by_money: 99
    },
    freightType: 0
  });
  assert.strictEqual(byMoney, 0, '达到金额包邮阈值应返回 0');
}

function runFallbackRegression() {
  console.log('4) 参数兜底回归');
  const service = new FreightService();
  const price = service.calculateTemplateFreight({
    summary: {number: 4, money: 10, goods_weight: 0},
    group: {
      start: 1,
      start_fee: 9,
      add: 0,
      add_fee: 2,
      free_by_number: 0,
      free_by_money: 0
    },
    freightType: 0
  });
  assert.strictEqual(price, 15, 'add<=0 时应按 add=1 兜底');
}

function main() {
  runAddUnitStepRegression();
  runWeightStepRegression();
  runFreeThresholdRegression();
  runFallbackRegression();
  console.log('freight add-unit 回归测试通过。');
}

try {
  main();
} catch (error) {
  console.error('freight add-unit 回归测试失败:', error.message);
  process.exit(1);
}
