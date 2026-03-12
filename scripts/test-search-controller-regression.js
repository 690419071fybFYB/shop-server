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

const SearchController = require('../src/api/controller/search');

function createSearchControllerHarness({
  keyword = '',
  userId = 0,
  defaultKeyword = {},
  configHotRows = [],
  helperConfigRows = [],
  historyHotRows = [],
  helperHistoryRows = [],
  historyKeywordList = []
} = {}) {
  const controller = new SearchController();
  controller.get = (name) => name === 'keyword' ? keyword : '';
  controller.getLoginUserId = () => userId;
  controller.success = (data) => ({errno: 0, data});
  controller.fail = (errno, errmsg) => ({errno: Number(errno), errmsg: String(errmsg || '')});

  controller.model = (name) => {
    if (name === 'keywords') {
      return {
        where: (whereMap) => {
          if (whereMap && Number(whereMap.is_default || 0) === 1) {
            return {
              limit: () => ({
                find: async() => Object.assign({}, defaultKeyword)
              })
            };
          }
          if (whereMap && Number(whereMap.is_hot || 0) === 1) {
            return {
              field: () => ({
                order: () => ({
                  limit: () => ({
                    select: async() => configHotRows.map(item => Object.assign({}, item))
                  })
                })
              })
            };
          }
          if (whereMap && whereMap.keyword && Array.isArray(whereMap.keyword) && whereMap.keyword[0] === 'like') {
            return {
              field: () => ({
                order: () => ({
                  limit: () => ({
                    select: async() => helperConfigRows.map(item => Object.assign({}, item))
                  })
                })
              })
            };
          }
          throw new Error(`unexpected keywords where: ${JSON.stringify(whereMap)}`);
        }
      };
    }
    if (name === 'search_history') {
      return {
        distinct: () => ({
          where: (whereMap) => {
            if (whereMap && Object.prototype.hasOwnProperty.call(whereMap, 'user_id')) {
              return {
                limit: () => ({
                  getField: async() => Array.isArray(historyKeywordList) ? historyKeywordList.slice() : []
                })
              };
            }
            throw new Error(`unexpected search_history distinct where: ${JSON.stringify(whereMap)}`);
          }
        }),
        where: (whereMap) => {
          if (whereMap && Object.prototype.hasOwnProperty.call(whereMap, 'user_id')) {
            return {
              limit: () => ({
                getField: async() => Array.isArray(historyKeywordList) ? historyKeywordList.slice() : []
              })
            };
          }
          if (whereMap && whereMap.keyword && Array.isArray(whereMap.keyword) && whereMap.keyword[0] === '!=') {
            return {
              field: () => ({
                group: () => ({
                  order: () => ({
                    limit: () => ({
                      select: async() => historyHotRows.map(item => Object.assign({}, item))
                    })
                  })
                })
              })
            };
          }
          if (whereMap && whereMap.keyword && Array.isArray(whereMap.keyword) && whereMap.keyword[0] === 'like') {
            return {
              field: () => ({
                group: () => ({
                  order: () => ({
                    limit: () => ({
                      select: async() => helperHistoryRows.map(item => Object.assign({}, item))
                    })
                  })
                })
              })
            };
          }
          throw new Error(`unexpected search_history where: ${JSON.stringify(whereMap)}`);
        },
        delete: async() => 1
      };
    }
    throw new Error(`unexpected model ${name}`);
  };
  return controller;
}

async function runHelperMergeRegression() {
  console.log('1) helper 联想应合并配置词与历史热词');
  const controller = createSearchControllerHarness({
    keyword: '台',
    helperConfigRows: [{keyword: '台灯'}, {keyword: '台历'}],
    helperHistoryRows: [{keyword: '台灯'}, {keyword: '台面'}, {keyword: '台历'}]
  });
  const result = await controller.helperAction();
  assert.strictEqual(result.errno, 0, 'helperAction 应返回成功');
  assert.deepStrictEqual(result.data, ['台灯', '台历', '台面'], '应按去重后顺序返回联想词');
}

async function runIndexFallbackRegression() {
  console.log('2) index 应在缺省配置时回退历史热词');
  const controller = createSearchControllerHarness({
    userId: 2001,
    defaultKeyword: {},
    configHotRows: [],
    historyHotRows: [{keyword: '沙发'}, {keyword: '台灯'}],
    historyKeywordList: ['衣服']
  });
  const result = await controller.indexAction();
  assert.strictEqual(result.errno, 0, 'indexAction 应返回成功');
  assert.strictEqual(result.data.defaultKeyword.keyword, '沙发', '默认词应回退到首个历史热词');
  assert.strictEqual(result.data.hotKeywordList.length, 2, '热词列表应来自历史热词');
  assert.strictEqual(result.data.hotKeywordList[0].keyword, '沙发', '热词顺序应正确');
  assert.strictEqual(result.data.historyKeywordList[0], '衣服', '个人历史词应保留');
}

async function runIndexMergeRegression() {
  console.log('3) index 应合并配置热词与历史热词并去重');
  const controller = createSearchControllerHarness({
    userId: 2002,
    defaultKeyword: {keyword: '默认词'},
    configHotRows: [{keyword: '官方A', is_hot: 1}, {keyword: '官方B', is_hot: 1}],
    historyHotRows: [{keyword: '官方B'}, {keyword: '民间C'}],
    historyKeywordList: []
  });
  const result = await controller.indexAction();
  assert.strictEqual(result.errno, 0, 'indexAction 应返回成功');
  assert.deepStrictEqual(
    result.data.hotKeywordList.map(item => item.keyword),
    ['官方A', '官方B', '民间C'],
    '热词应先配置后历史并去重'
  );
}

async function main() {
  await runHelperMergeRegression();
  await runIndexFallbackRegression();
  await runIndexMergeRegression();
  console.log('search controller 回归测试通过。');
}

main().catch((error) => {
  console.error('search controller 回归测试失败:', error.message);
  process.exit(1);
});
