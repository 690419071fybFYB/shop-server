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

  nowTs() {
    return Math.floor(Date.now() / 1000);
  }

  vipService() {
    return this.service('vip', 'api');
  }

  async planListAction() {
    try {
      const page = this.toInt(this.get('page'), 1);
      const size = this.toInt(this.get('size'), 10);
      const keyword = this.toText(this.get('keyword'));
      const status = this.toText(this.get('status'));
      const data = await this.vipService().listPlans({
        enabledOnly: false,
        page,
        size,
        keyword,
        status
      });

      const planIds = Array.from(new Set((data.data || []).map((item) => this.toInt(item.id, 0)).filter((id) => id > 0)));
      let memberCountMap = new Map();
      if (planIds.length > 0) {
        const rows = await this.model('vip_user').where({
          is_delete: 0,
          status: 'active',
          plan_id: ['IN', planIds]
        }).field('plan_id,COUNT(1) AS total').group('plan_id').select();
        memberCountMap = new Map((rows || []).map((item) => [this.toInt(item.plan_id, 0), this.toInt(item.total, 0)]));
      }

      data.data = (data.data || []).map((item) => ({
        ...item,
        member_count: memberCountMap.get(this.toInt(item.id, 0)) || 0,
        create_time: this.toInt(item.add_time, 0),
        updated_at: this.toInt(item.update_time, 0)
      }));
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '获取会员方案失败');
    }
  }

  async planCreateAction() {
    try {
      const payload = this.post() || {};
      const data = await this.vipService().createPlan(payload);
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '创建会员方案失败');
    }
  }

  async planUpdateAction() {
    try {
      const payload = this.post() || {};
      const data = await this.vipService().updatePlan(payload);
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '更新会员方案失败');
    }
  }

  async planToggleAction() {
    try {
      const id = this.toInt(this.post('id'), 0);
      const statusRaw = this.post('status');
      let enabled = this.toInt(this.post('enabled'), -1);
      if (enabled < 0) {
        const normalizedStatus = this.toText(statusRaw);
        enabled = ['enabled', '1', 'true'].includes(normalizedStatus) ? 1 : 0;
      }
      const data = await this.vipService().togglePlan({
        id,
        enabled
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '切换会员方案状态失败');
    }
  }

  async skuPriceListAction() {
    try {
      const page = this.toInt(this.get('page'), 1);
      const size = this.toInt(this.get('size'), 10);
      const keyword = this.toText(this.get('keyword'));
      const planId = this.toInt(this.get('plan_id') || this.get('planId'), 0);
      const status = this.toText(this.get('status'));
      const data = await this.vipService().listSkuPrices({
        page,
        size,
        keyword,
        planId,
        status
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '获取SKU会员价失败');
    }
  }

  async skuPriceSaveAction() {
    try {
      const payload = this.post() || {};
      const data = await this.vipService().saveSkuPrice(payload);
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '保存SKU会员价失败');
    }
  }

  async memberListAction() {
    try {
      const page = this.toInt(this.get('page'), 1);
      const size = this.toInt(this.get('size'), 10);
      const keyword = this.toText(this.get('keyword'));
      const planId = this.toInt(this.get('plan_id') || this.get('planId'), 0);
      const status = this.toText(this.get('status'));
      const data = await this.vipService().listVipMembers({
        page,
        size,
        keyword,
        planId,
        status
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '获取会员列表失败');
    }
  }

  async orderListAction() {
    try {
      const page = this.toInt(this.get('page'), 1);
      const size = this.toInt(this.get('size'), 10);
      const orderSn = this.toText(this.get('order_sn') || this.get('orderSn'));
      const memberKeyword = this.toText(this.get('member_keyword') || this.get('memberKeyword'));
      const status = this.toText(this.get('status'));
      const data = await this.vipService().listVipOrders({
        page,
        size,
        orderSn,
        memberKeyword,
        status
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '获取会员订单失败');
    }
  }

  async refundListAction() {
    try {
      const page = this.toInt(this.get('page'), 1);
      const size = this.toInt(this.get('size'), 10);
      const refundSn = this.toText(this.get('refund_sn') || this.get('refundSn'));
      const orderSn = this.toText(this.get('order_sn') || this.get('orderSn'));
      const status = this.toText(this.get('status'));
      const data = await this.vipService().listVipRefunds({
        page,
        size,
        refundSn,
        orderSn,
        status
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '获取退款列表失败');
    }
  }

  async refundApproveAction() {
    try {
      const vipOrderId = this.toInt(this.post('id') || this.post('vipOrderId'), 0);
      const adminId = this.toInt(this.ctx && this.ctx.state && this.ctx.state.userId, 0);
      const remark = this.toText(this.post('remark'));
      const requestId = this.toText(this.ctx && this.ctx.state && this.ctx.state.requestId);
      const data = await this.vipService().approveRefund({
        vipOrderId,
        adminId,
        remark,
        requestId
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '审核通过失败');
    }
  }

  async refundRejectAction() {
    try {
      const vipOrderId = this.toInt(this.post('id') || this.post('vipOrderId'), 0);
      const adminId = this.toInt(this.ctx && this.ctx.state && this.ctx.state.userId, 0);
      const reason = this.toText(this.post('reason') || this.post('remark'));
      const requestId = this.toText(this.ctx && this.ctx.state && this.ctx.state.requestId);
      const data = await this.vipService().rejectRefund({
        vipOrderId,
        adminId,
        reason,
        requestId
      });
      return this.success(data);
    } catch (error) {
      return this.fail(400, error.message || '驳回退款失败');
    }
  }
};
