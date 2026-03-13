const Base = require('./base.js');

module.exports = class extends Base {
  toInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  toText(value) {
    return String(value === undefined || value === null ? '' : value).trim();
  }

  vipService() {
    return this.service('vip', 'api');
  }

  async homeAction() {
    const userId = this.requireLoginUserId();
    if (userId <= 0) {
      return;
    }
    try {
      const data = await this.vipService().getVipHome(userId);
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '获取会员首页失败');
    }
  }

  async plansAction() {
    const userId = this.requireLoginUserId();
    if (userId <= 0) {
      return;
    }
    try {
      const data = await this.vipService().listPlans({
        enabledOnly: true,
        page: 1,
        size: 50
      });
      return this.success({
        plans: (data.data || []).map((item) => this.vipService().planToMiniPayload(item))
      });
    } catch (error) {
      return this.fail(400, error.message || '获取会员套餐失败');
    }
  }

  async statusAction() {
    const userId = this.requireLoginUserId();
    if (userId <= 0) {
      return;
    }
    try {
      const data = await this.vipService().getVipStatus(userId);
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '获取会员状态失败');
    }
  }

  async checkoutAction() {
    const userId = this.requireLoginUserId();
    if (userId <= 0) {
      return;
    }
    try {
      const planId = this.toInt(this.get('planId') || this.get('plan_id') || 0, 0);
      const data = await this.vipService().getVipCheckout(userId, planId);
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '获取会员结算信息失败');
    }
  }

  async submitAction() {
    const userId = this.requireLoginUserId();
    if (userId <= 0) {
      return;
    }
    try {
      const planId = this.toInt(this.post('planId') || this.post('plan_id') || this.post('id') || 0, 0);
      const requestId = this.toText(this.ctx && this.ctx.state && this.ctx.state.requestId);
      const data = await this.vipService().submitVipOrder({
        userId,
        planId,
        requestId
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '提交会员订单失败');
    }
  }

  async refundApplyAction() {
    const userId = this.requireLoginUserId();
    if (userId <= 0) {
      return;
    }
    try {
      const reason = this.toText(this.post('reason') || this.post('remark') || '');
      const requestId = this.toText(this.ctx && this.ctx.state && this.ctx.state.requestId);
      const data = await this.vipService().applyRefund({
        userId,
        reason,
        requestId
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '提交退款申请失败');
    }
  }

  async autorenewSignAction() {
    const userId = this.requireLoginUserId();
    if (userId <= 0) {
      return;
    }
    try {
      const contractId = this.toText(this.post('contract_id') || this.post('contractId') || '');
      const data = await this.vipService().signAutoRenew({
        userId,
        contractId
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '签约自动续费失败');
    }
  }

  async autorenewCancelAction() {
    const userId = this.requireLoginUserId();
    if (userId <= 0) {
      return;
    }
    try {
      const data = await this.vipService().cancelAutoRenew({
        userId
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '取消自动续费失败');
    }
  }

  async autorenewNotifyAction() {
    try {
      const requestId = this.toText(this.ctx && this.ctx.state && this.ctx.state.requestId);
      const payload = this.post() || {};
      const data = await this.vipService().handleAutoRenewNotify({
        ...payload,
        requestId
      });
      if (data && data.processed) {
        return this.success(data);
      }
      return this.fail(400, data.reason || '自动续费回调处理失败');
    } catch (error) {
      return this.fail(400, error.message || '自动续费回调处理失败');
    }
  }
};
