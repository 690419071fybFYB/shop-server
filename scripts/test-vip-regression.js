#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

function assertContains(content, snippet, message) {
  assert(
    content.includes(snippet),
    `${message}\nmissing snippet: ${snippet}`
  );
}

function runSqlRegression() {
  console.log('1) SQL schema 回归检查');
  const sql = read('hiolabsDB.sql');
  assertContains(sql, 'CREATE TABLE `hiolabs_vip_plan`', '缺少 hiolabs_vip_plan 表');
  assertContains(sql, 'CREATE TABLE `hiolabs_vip_user`', '缺少 hiolabs_vip_user 表');
  assertContains(sql, 'CREATE TABLE `hiolabs_vip_order`', '缺少 hiolabs_vip_order 表');
  assertContains(sql, 'CREATE TABLE `hiolabs_vip_sku_price`', '缺少 hiolabs_vip_sku_price 表');
  assertContains(sql, 'CREATE TABLE `hiolabs_vip_coupon_grant_log`', '缺少 hiolabs_vip_coupon_grant_log 表');
  assertContains(sql, 'CREATE TABLE `hiolabs_vip_event_log`', '缺少 hiolabs_vip_event_log 表');
  assertContains(sql, '`grant_batch_key`', 'user_coupon 未包含 grant_batch_key 字段');
  assertContains(sql, 'UNIQUE KEY `uniq_user_coupon_once` (`user_id`,`coupon_id`,`grant_batch_key`)', 'user_coupon 唯一索引未升级');
  assertContains(sql, 'ADD COLUMN `vip_discount_price`', 'order 表缺少 vip_discount_price 字段');
}

function runApiControllerRegression() {
  console.log('2) API VIP 控制器回归检查');
  const vipController = read('src/api/controller/vip.js');
  const requiredActions = [
    'async homeAction()',
    'async plansAction()',
    'async statusAction()',
    'async checkoutAction()',
    'async submitAction()',
    'async refundApplyAction()',
    'async autorenewSignAction()',
    'async autorenewCancelAction()',
    'async autorenewNotifyAction()'
  ];
  requiredActions.forEach((action) => {
    assertContains(vipController, action, `VIP 控制器缺少动作 ${action}`);
  });

  const apiBase = read('src/api/controller/base.js');
  assertContains(apiBase, "'vip/autorenewnotify'", 'API 公共动作白名单缺少 vip/autorenewnotify');

  const apiConfig = read('src/api/config/config.js');
  assertContains(apiConfig, "'vip/autorenewnotify'", 'API 配置 publicAction 缺少 vip/autorenewnotify');
}

function runServiceRegression() {
  console.log('3) VIP service 核心能力回归检查');
  const vipService = read('src/api/service/vip.js');
  const requiredMethods = [
    'repairUtf8Mojibake(value)',
    'normalizePlanName(value,',
    'isPapayConfigured()',
    'async submitVipOrder(',
    'async handleOrderPaid(',
    'async applyVipPriceToCartItems(',
    'async decorateGoodsDetail(',
    'async grantMonthlyCouponsForMember(',
    'async scanMonthlyCouponGrant(',
    'async applyRefund(',
    'async approveRefund(',
    'async rejectRefund(',
    'async signAutoRenew(',
    'async cancelAutoRenew(',
    'async handleAutoRenewNotify(',
    'async scanAutoRenewTasks('
  ];
  requiredMethods.forEach((method) => {
    assertContains(vipService, method, `VIP service 缺少方法 ${method}`);
  });
  assertContains(vipService, 'autorenew_available', 'VIP home 未返回自动续费可用状态');

  const couponService = read('src/api/service/coupon.js');
  assertContains(couponService, 'grantBatchKey', 'coupon.receiveCoupon 未支持 grantBatchKey');
  assertContains(couponService, 'expireTimeOverride', 'coupon.receiveCoupon 未支持 expireTimeOverride');
}

function runTradeFlowRegression() {
  console.log('4) 交易链路 VIP 接入回归检查');
  const cartController = read('src/api/controller/cart.js');
  assertContains(cartController, 'applyVipPriceToCartItems', 'cart.checkout 未接入 VIP 价格逻辑');
  assertContains(cartController, 'vipDiscountPrice', 'cart.checkout 未返回 vipDiscountPrice');

  const orderController = read('src/api/controller/order.js');
  assertContains(orderController, 'vip_discount_price', 'order.submit 未写入 vip_discount_price');
  assertContains(orderController, 'recordVipDiscountUsage', 'order.submit 未记录会员权益使用事件');

  const goodsController = read('src/api/controller/goods.js');
  assertContains(goodsController, 'decorateGoodsDetail', 'goods.detail 未接入 VIP 展示逻辑');

  const payController = read('src/api/controller/pay.js');
  assertContains(payController, 'orderInfo.order_type == 8', 'pay 控制器未放开 order_type=8');
  assertContains(payController, "this.service('vip', 'api')", 'pay 控制器未接入 VIP 支付后处理');

  const cronController = read('src/api/controller/crontab.js');
  assertContains(cronController, 'scanMonthlyCouponGrant', 'crontab 未接入 VIP 月度发券扫描');
  assertContains(cronController, 'scanAutoRenewTasks', 'crontab 未接入 VIP 自动续费扫描');
}

function runAdminRegression() {
  console.log('5) Admin VIP 控制器回归检查');
  const adminVipController = read('src/admin/controller/vip.js');
  const requiredAdminActions = [
    'async planListAction()',
    'async planCreateAction()',
    'async planUpdateAction()',
    'async planToggleAction()',
    'async skuPriceListAction()',
    'async skuPriceSaveAction()',
    'async memberListAction()',
    'async orderListAction()',
    'async refundListAction()',
    'async refundApproveAction()',
    'async refundRejectAction()'
  ];
  requiredAdminActions.forEach((action) => {
    assertContains(adminVipController, action, `Admin VIP 控制器缺少动作 ${action}`);
  });

  const adminVipPaths = read('hiolabsDB.sql');
  assertContains(adminVipPaths, '/admin/vip/planList', 'VIP 权限路径未切换为 planList');
  assertContains(adminVipPaths, '/admin/vip/skuPriceList', 'VIP 权限路径未切换为 skuPriceList');
  assertContains(adminVipPaths, '/admin/vip/refundApprove', 'VIP 权限路径未切换为 refundApprove');

  const packageJson = read('package.json');
  assertContains(packageJson, 'test:vip-regression', 'package.json 未添加 test:vip-regression 脚本');
}

function main() {
  runSqlRegression();
  runApiControllerRegression();
  runServiceRegression();
  runTradeFlowRegression();
  runAdminRegression();
  console.log('VIP regression checks passed.');
}

main();
