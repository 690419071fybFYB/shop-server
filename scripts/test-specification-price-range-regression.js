#!/usr/bin/env node
const assert = require('assert');

global.think = global.think || {};
global.think.Controller = global.think.Controller || class {};

const SpecificationController = require('../src/admin/controller/specification');

function runPriceRangeFormattingRegression() {
  console.log('1) 价格区间格式回归');
  const controller = new SpecificationController();
  assert.strictEqual(typeof controller.formatPriceRange, 'function', '应提供 formatPriceRange');
  assert.strictEqual(controller.formatPriceRange(10, 10), '10', '单价场景应返回单值');
  assert.strictEqual(controller.formatPriceRange(9.9, 12), '9.9-12', '区间场景应返回 min-max');
  assert.strictEqual(controller.formatPriceRange(12, 10), '10-12', '输入顺序颠倒时应自动归一');
}

function runGoodsAggregatePayloadRegression() {
  console.log('2) 商品聚合字段回归');
  const controller = new SpecificationController();
  assert.strictEqual(typeof controller.buildGoodsAggregatePayload, 'function', '应提供 buildGoodsAggregatePayload');

  const single = controller.buildGoodsAggregatePayload({
    goodsNumber: 5,
    minRetailPrice: 19.9,
    maxRetailPrice: 19.9,
    minCostPrice: 12,
    maxCostPrice: 12
  });
  assert.deepStrictEqual(single, {
    goods_number: 5,
    retail_price: '19.9',
    cost_price: '12',
    min_retail_price: 19.9,
    min_cost_price: 12
  }, '单规格应落单值，不输出区间');

  const multi = controller.buildGoodsAggregatePayload({
    goodsNumber: 12,
    minRetailPrice: 18,
    maxRetailPrice: 26,
    minCostPrice: 9,
    maxCostPrice: 13
  });
  assert.deepStrictEqual(multi, {
    goods_number: 12,
    retail_price: '18-26',
    cost_price: '9-13',
    min_retail_price: 18,
    min_cost_price: 9
  }, '多规格应落区间与 min 字段');
}

function main() {
  runPriceRangeFormattingRegression();
  runGoodsAggregatePayloadRegression();
  console.log('specification 价格区间回归测试通过。');
}

try {
  main();
} catch (error) {
  console.error('specification 价格区间回归测试失败:', error.message);
  process.exit(1);
}
