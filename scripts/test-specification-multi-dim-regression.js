#!/usr/bin/env node
const assert = require('assert');

global.think = global.think || {};
global.think.Service = global.think.Service || class {};
global.think.Controller = global.think.Controller || class {};
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

const SpecificationController = require('../src/admin/controller/specification');

function createControllerHarness({
  productRows = [],
  specRowsById = {}
} = {}) {
  const specQueryHistory = [];
  const controller = new SpecificationController();
  controller.post = (key) => key === 'id' ? 9001 : undefined;
  controller.model = (name) => {
    if (name === 'product') {
      return {
        where: () => ({
          select: async() => productRows.map(item => Object.assign({}, item))
        })
      };
    }
    if (name === 'goods_specification') {
      return {
        where: (where) => {
          specQueryHistory.push(where);
          const idFilter = where && where.id;
          if (idFilter && typeof idFilter === 'object' && Array.isArray(idFilter.in)) {
            const ids = idFilter.in.map(Number);
            const rows = ids
              .map(id => specRowsById[id])
              .filter(Boolean)
              .map(item => Object.assign({}, item));
            return {
              select: async() => rows,
              find: async() => rows[0] || {}
            };
          }
          const row = specRowsById[Number(idFilter)] || {};
          return {
            select: async() => think.isEmpty(row) ? [] : [Object.assign({}, row)],
            find: async() => Object.assign({}, row)
          };
        }
      };
    }
    throw new Error(`unexpected model ${name}`);
  };
  controller.success = (data) => ({errno: 0, data});
  controller.fail = (errno, errmsg) => ({errno: Number(errno), errmsg: String(errmsg || '')});
  return {
    controller,
    specQueryHistory
  };
}

async function runMultiDimSpecRegression() {
  console.log('1) 多规格 ID 读取与拼接回归');
  const harness = createControllerHarness({
    productRows: [{
      id: 11,
      goods_specification_ids: '101_102',
      goods_sn: 'sku-1'
    }, {
      id: 12,
      goods_specification_ids: '102_103',
      goods_sn: 'sku-2'
    }],
    specRowsById: {
      101: {id: 101, specification_id: 6, value: '红色'},
      102: {id: 102, specification_id: 7, value: 'XL'},
      103: {id: 103, specification_id: 7, value: 'XXL'}
    }
  });

  const result = await harness.controller.getGoodsSpecAction();
  assert.strictEqual(result.errno, 0, '应成功返回规格数据');
  assert.strictEqual(result.data.specData.length, 2, '应返回 2 条 SKU 规格');
  assert.strictEqual(result.data.specData[0].value, '红色/XL', '多规格应按原顺序拼接');
  assert.strictEqual(result.data.specData[1].value, 'XL/XXL', '多规格应按原顺序拼接');
  assert.strictEqual(result.data.specValue, 6, 'specValue 兼容返回第一个规格分类');
}

async function runLegacySingleSpecRegression() {
  console.log('2) 单规格兼容回归');
  const harness = createControllerHarness({
    productRows: [{
      id: 21,
      goods_specification_ids: 201,
      goods_sn: 'sku-single'
    }],
    specRowsById: {
      201: {id: 201, specification_id: 5, value: '500g'}
    }
  });
  const result = await harness.controller.getGoodsSpecAction();
  assert.strictEqual(result.errno, 0, '应成功返回单规格数据');
  assert.strictEqual(result.data.specData[0].value, '500g', '单规格值不应变化');
  assert.strictEqual(result.data.specValue, 5, '单规格分类 ID 应保持不变');
}

async function runMissingSpecValueRegression() {
  console.log('3) 缺失规格记录不应崩溃');
  const harness = createControllerHarness({
    productRows: [{
      id: 31,
      goods_specification_ids: '999_302',
      goods_sn: 'sku-missing'
    }],
    specRowsById: {
      302: {id: 302, specification_id: 8, value: 'L'}
    }
  });
  const result = await harness.controller.getGoodsSpecAction();
  assert.strictEqual(result.errno, 0, '缺失规格记录应降级成功');
  assert.strictEqual(result.data.specData[0].value, 'L', '应忽略缺失规格并保留有效值');
  assert.strictEqual(result.data.specValue, 8, '应返回可用规格分类');
}

async function main() {
  await runMultiDimSpecRegression();
  await runLegacySingleSpecRegression();
  await runMissingSpecValueRegression();
  console.log('specification 多规格回归测试通过。');
}

main().catch((error) => {
  console.error('specification 多规格回归测试失败:', error.message);
  process.exit(1);
});
