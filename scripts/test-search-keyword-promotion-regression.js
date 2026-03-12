#!/usr/bin/env node
const assert = require('assert');

global.think = global.think || {};
global.think.Service = global.think.Service || class {};
global.think.Controller = global.think.Controller || class {};
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
global.think.logger = global.think.logger || {
  warn: () => {},
  error: () => {}
};

const GoodsController = require('../src/api/controller/goods');

function createGoodsListHarness({
  keyword = '',
  initialSearchCount = 0,
  existingKeywordRow = null,
  threshold = 5
} = {}) {
  let searchCount = Number(initialSearchCount || 0);
  const keywordAdds = [];
  const keywordUpdates = [];
  const searchHistoryAdds = [];

  const controller = new GoodsController();
  controller.getLoginUserId = () => 1001;
  controller.get = (name) => {
    if (name === 'keyword') return keyword;
    if (name === 'sort') return '';
    if (name === 'order') return '';
    if (name === 'sales') return '';
    return '';
  };
  controller.success = (data) => ({errno: 0, data});
  controller.fail = (errno, errmsg) => ({errno: Number(errno), errmsg: String(errmsg || '')});
  controller.service = (serviceName, moduleName) => {
    if (moduleName === 'api' && serviceName === 'promotion') {
      return {
        decorateGoodsWithPromotion: async(list) => list
      };
    }
    throw new Error(`unexpected service ${moduleName}.${serviceName}`);
  };
  controller.getKeywordPromoteThreshold = () => threshold;
  controller.model = (name) => {
    if (name === 'goods') {
      return {
        where: () => ({
          order: () => ({
            select: async() => []
          })
        })
      };
    }
    if (name === 'search_history') {
      return {
        add: async(payload) => {
          searchHistoryAdds.push(payload);
          searchCount += 1;
          return 1;
        },
        where: () => ({
          count: async() => searchCount
        })
      };
    }
    if (name === 'keywords') {
      return {
        where: () => ({
          find: async() => existingKeywordRow ? Object.assign({}, existingKeywordRow) : {},
          update: async(payload) => {
            keywordUpdates.push(payload);
            return 1;
          }
        }),
        add: async(payload) => {
          keywordAdds.push(payload);
          return 1;
        }
      };
    }
    throw new Error(`unexpected model ${name}`);
  };

  return {
    controller,
    getState: () => ({
      keywordAdds,
      keywordUpdates,
      searchHistoryAdds
    })
  };
}

async function runBelowThresholdRegression() {
  console.log('1) 低于阈值不晋升热词');
  const harness = createGoodsListHarness({
    keyword: '沙发',
    initialSearchCount: 2,
    threshold: 5
  });
  const result = await harness.controller.listAction();
  const state = harness.getState();
  assert.strictEqual(result.errno, 0, '列表查询应成功');
  assert.strictEqual(state.searchHistoryAdds.length, 1, '应记录搜索历史');
  assert.strictEqual(state.keywordAdds.length, 0, '低于阈值不应新增关键词');
  assert.strictEqual(state.keywordUpdates.length, 0, '低于阈值不应更新关键词');
}

async function runReachThresholdInsertRegression() {
  console.log('2) 达到阈值后应新增热词');
  const harness = createGoodsListHarness({
    keyword: '台灯',
    initialSearchCount: 4,
    threshold: 5,
    existingKeywordRow: null
  });
  await harness.controller.listAction();
  const state = harness.getState();
  assert.strictEqual(state.keywordAdds.length, 1, '达到阈值应新增关键词');
  assert.strictEqual(state.keywordAdds[0].keyword, '台灯', '新增关键词内容应正确');
  assert.strictEqual(Number(state.keywordAdds[0].is_hot), 1, '新增关键词应标记为热词');
}

async function runReachThresholdUpdateRegression() {
  console.log('3) 已存在关键词达到阈值后应更新热词状态');
  const harness = createGoodsListHarness({
    keyword: '收纳',
    initialSearchCount: 7,
    threshold: 5,
    existingKeywordRow: {
      id: 88,
      keyword: '收纳',
      is_hot: 0,
      is_show: 0
    }
  });
  await harness.controller.listAction();
  const state = harness.getState();
  assert.strictEqual(state.keywordAdds.length, 0, '已存在关键词不应重复新增');
  assert.strictEqual(state.keywordUpdates.length, 1, '已存在关键词应更新热词状态');
  assert.strictEqual(Number(state.keywordUpdates[0].is_hot), 1, '更新后应为热词');
  assert.strictEqual(Number(state.keywordUpdates[0].is_show), 1, '更新后应展示');
}

async function main() {
  await runBelowThresholdRegression();
  await runReachThresholdInsertRegression();
  await runReachThresholdUpdateRegression();
  console.log('search keyword promotion 回归测试通过。');
}

main().catch((error) => {
  console.error('search keyword promotion 回归测试失败:', error.message);
  process.exit(1);
});
