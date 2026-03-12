#!/usr/bin/env node
const assert = require('assert');

global.think = global.think || {};
global.think.Model = global.think.Model || class {};
global.think.isEmpty = global.think.isEmpty || ((value) => {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return value === '';
});

const OrderExpressModel = require('../src/admin/model/order_express');

function createModelHarness(configValue, orderInfo) {
  let capturedPayload = null;
  global.think.config = (key) => {
    if (key === 'mianexpress') {
      if (typeof configValue === 'undefined') {
        return {};
      }
      return {
        return_print_template: configValue
      };
    }
    return {};
  };
  global.think.service = (name, moduleName) => {
    if (name === 'express' && moduleName === 'api') {
      return {
        mianExpress: async(payload) => {
          capturedPayload = payload;
          return {ResultCode: 100};
        }
      };
    }
    throw new Error(`unexpected service ${name}.${moduleName}`);
  };

  const model = new OrderExpressModel();
  model.model = (name) => {
    if (name === 'order') {
      return {
        where: () => ({
          find: async() => Object.assign({}, orderInfo)
        })
      };
    }
    throw new Error(`unexpected model ${name}`);
  };
  return {
    model,
    getPayload: () => capturedPayload
  };
}

async function runDefaultTemplateFlagRegression() {
  console.log('1) 面单模板返回开关默认值回归');
  const harness = createModelHarness(undefined, {
    order_sn: '20260311101010123456',
    remark: 'test',
    express_value: 0
  });
  await harness.model.getMianExpress(101, {
    Name: 'sender'
  }, {
    Name: 'receiver'
  }, 4);
  const payload = harness.getPayload();
  assert(payload, '应调用电子面单服务');
  assert.strictEqual(payload.IsReturnPrintTemplate, 0, '默认不返回模板');
}

async function runTemplateFlagConfigRegression() {
  console.log('2) 面单模板返回开关配置回归');
  const harness = createModelHarness(1, {
    order_sn: '20260311101010123457',
    remark: 'cfg',
    express_value: 0
  });
  await harness.model.getMianExpress(102, {
    Name: 'sender'
  }, {
    Name: 'receiver'
  }, 4);
  const payload = harness.getPayload();
  assert(payload, '应调用电子面单服务');
  assert.strictEqual(payload.IsReturnPrintTemplate, 1, '配置开启后应返回模板');
}

async function runOrderSnCompatibilityRegression() {
  console.log('3) 打单订单号兼容回归');
  const existingOrderSn = '20260311101010123458';
  const harness = createModelHarness(0, {
    order_sn: existingOrderSn,
    remark: 'compat',
    express_value: 0
  });
  await harness.model.getMianExpress(103, {
    Name: 'sender'
  }, {
    Name: 'receiver'
  }, 4);
  const payload = harness.getPayload();
  assert(payload, '应调用电子面单服务');
  assert.strictEqual(payload.OrderCode, existingOrderSn, '应复用现有 order_sn，不在模型层隐式重打单号');
}

async function main() {
  await runDefaultTemplateFlagRegression();
  await runTemplateFlagConfigRegression();
  await runOrderSnCompatibilityRegression();
  console.log('order_express model 回归测试通过。');
}

main().catch((error) => {
  console.error('order_express model 回归测试失败:', error.message);
  process.exit(1);
});
