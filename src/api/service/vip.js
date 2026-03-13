const orderSnUtil = require('../../common/utils/order_sn');

const VIP_USER_STATUS_ACTIVE = 'active';
const VIP_USER_STATUS_EXPIRED = 'expired';
const VIP_USER_STATUS_CANCELLED = 'cancelled';

const VIP_ORDER_STATUS_PENDING_PAY = 'pending_pay';
const VIP_ORDER_STATUS_PAID = 'paid';
const VIP_ORDER_STATUS_CLOSED = 'closed';
const VIP_ORDER_STATUS_REFUNDED = 'refunded';

const VIP_PAY_STATUS_UNPAID = 'unpaid';
const VIP_PAY_STATUS_PAID = 'paid';
const VIP_PAY_STATUS_REFUNDED = 'refunded';

const VIP_REFUND_STATUS_NONE = 'none';
const VIP_REFUND_STATUS_PENDING = 'pending';
const VIP_REFUND_STATUS_APPROVED = 'approved';
const VIP_REFUND_STATUS_REJECTED = 'rejected';
const VIP_REFUND_STATUS_COMPLETED = 'completed';

const VIP_AUTORENEW_OFF = 'off';
const VIP_AUTORENEW_ON = 'on';

module.exports = class extends think.Service {
  nowTs() {
    return Math.floor(Date.now() / 1000);
  }

  toInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  toNumber(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return parsed;
  }

  toPrice(value, fallback = 0) {
    const parsed = this.toNumber(value, fallback);
    if (parsed < 0) {
      return 0;
    }
    return Math.round(parsed * 100) / 100;
  }

  formatPrice(value) {
    return this.toPrice(value, 0).toFixed(2);
  }

  toText(value) {
    return String(value === undefined || value === null ? '' : value).trim();
  }

  isTruthy(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value).toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  isMissingVipTableError(error) {
    if (!error) {
      return false;
    }
    const code = String(error.code || '').toUpperCase();
    const errno = Number(error.errno || 0);
    if (code !== 'ER_NO_SUCH_TABLE' && errno !== 1146) {
      return false;
    }
    const message = String(error.message || error.sqlMessage || '').toLowerCase();
    return message.includes('hiolabs_vip_');
  }

  isDuplicateError(error) {
    if (!error) {
      return false;
    }
    const code = String(error.code || '').toUpperCase();
    const errno = Number(error.errno || 0);
    return code === 'ER_DUP_ENTRY' || errno === 1062;
  }

  getVipEnabled() {
    const raw = process.env.VIP_ENABLED;
    if (raw === undefined) {
      return true;
    }
    return this.isTruthy(raw, true);
  }

  defaultYearPrice() {
    return this.toPrice(process.env.VIP_DEFAULT_YEAR_PRICE, 69);
  }

  defaultQuarterPrice() {
    return this.toPrice(process.env.VIP_DEFAULT_QUARTER_PRICE, 25);
  }

  defaultMonthlyCouponCount() {
    const value = this.toInt(process.env.VIP_MONTHLY_COUPON_COUNT, 6);
    return value > 0 ? value : 6;
  }

  defaultMonthlyCouponValidDays() {
    const value = this.toInt(process.env.VIP_MONTHLY_COUPON_VALID_DAYS, 30);
    return value > 0 ? value : 30;
  }

  defaultMonthlyCouponId() {
    return this.toInt(process.env.VIP_MONTHLY_COUPON_ID, 0);
  }

  getPapayConfig() {
    const cfg = think.config('weixinPapay') || {};
    return {
      service_id: this.toText(process.env.WEIXIN_PAPAY_SERVICE_ID || cfg.service_id || ''),
      notify_url: this.toText(process.env.WEIXIN_PAPAY_NOTIFY_URL || cfg.notify_url || ''),
      mch_id: this.toText(process.env.WEIXIN_PAPAY_MCH_ID || cfg.mch_id || ''),
      api_v3_key: this.toText(process.env.WEIXIN_PAPAY_API_V3_KEY || cfg.api_v3_key || ''),
      serial_no: this.toText(process.env.WEIXIN_PAPAY_SERIAL_NO || cfg.serial_no || ''),
      private_key_path: this.toText(process.env.WEIXIN_PAPAY_PRIVATE_KEY_PATH || cfg.private_key_path || ''),
      platform_cert_path: this.toText(process.env.WEIXIN_PAPAY_PLATFORM_CERT_PATH || cfg.platform_cert_path || '')
    };
  }

  isPapayConfigured() {
    const cfg = this.getPapayConfig();
    const requiredKeys = [
      'service_id',
      'notify_url',
      'mch_id',
      'api_v3_key',
      'serial_no',
      'private_key_path',
      'platform_cert_path'
    ];
    return requiredKeys.every((key) => this.toText(cfg[key]).length > 0);
  }

  defaultPlans() {
    return [
      {
        id: 1,
        plan_name: '黄金会员年卡',
        plan_code: 'gold_year',
        duration_days: 365,
        price: this.defaultYearPrice(),
        original_price: this.defaultYearPrice(),
        sort_order: 10,
        enabled: 1,
        monthly_coupon_id: this.defaultMonthlyCouponId(),
        monthly_coupon_count: this.defaultMonthlyCouponCount(),
        monthly_coupon_valid_days: this.defaultMonthlyCouponValidDays(),
        remark: '默认年卡方案',
        is_delete: 0,
        add_time: 0,
        update_time: 0
      },
      {
        id: 2,
        plan_name: '黄金会员季卡',
        plan_code: 'gold_quarter',
        duration_days: 90,
        price: this.defaultQuarterPrice(),
        original_price: this.defaultQuarterPrice(),
        sort_order: 20,
        enabled: 1,
        monthly_coupon_id: this.defaultMonthlyCouponId(),
        monthly_coupon_count: this.defaultMonthlyCouponCount(),
        monthly_coupon_valid_days: this.defaultMonthlyCouponValidDays(),
        remark: '默认季卡方案',
        is_delete: 0,
        add_time: 0,
        update_time: 0
      }
    ];
  }

  formatDateTime(ts) {
    const timestamp = this.toInt(ts, 0);
    if (timestamp <= 0) {
      return '';
    }
    const date = new Date(timestamp * 1000);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  parsePayTimeToUnix(value) {
    if (!value) {
      return this.nowTs();
    }
    const raw = String(value).trim();
    if (/^\d{14}$/.test(raw)) {
      const year = Number(raw.slice(0, 4));
      const month = Number(raw.slice(4, 6));
      const day = Number(raw.slice(6, 8));
      const hour = Number(raw.slice(8, 10));
      const minute = Number(raw.slice(10, 12));
      const second = Number(raw.slice(12, 14));
      const parsed = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    const numeric = this.toInt(raw, 0);
    if (numeric > 1000000000) {
      return numeric;
    }
    return this.nowTs();
  }

  normalizePlanRow(row = {}) {
    return {
      id: this.toInt(row.id, 0),
      plan_name: this.toText(row.plan_name || row.name || ''),
      plan_code: this.toText(row.plan_code || ''),
      duration_days: this.toInt(row.duration_days, 30),
      price: this.toPrice(row.price, 0),
      original_price: this.toPrice(row.original_price, row.price || 0),
      sort_order: this.toInt(row.sort_order, 100),
      enabled: this.toInt(row.enabled, 0),
      monthly_coupon_id: this.toInt(row.monthly_coupon_id, this.defaultMonthlyCouponId()),
      monthly_coupon_count: this.toInt(row.monthly_coupon_count, this.defaultMonthlyCouponCount()),
      monthly_coupon_valid_days: this.toInt(row.monthly_coupon_valid_days, this.defaultMonthlyCouponValidDays()),
      remark: this.toText(row.remark || ''),
      is_delete: this.toInt(row.is_delete, 0),
      add_time: this.toInt(row.add_time, 0),
      update_time: this.toInt(row.update_time, 0)
    };
  }

  planToMiniPayload(plan = {}) {
    const normalized = this.normalizePlanRow(plan);
    const isYear = normalized.duration_days >= 300 || normalized.plan_name.includes('年');
    return {
      id: normalized.id,
      plan_id: normalized.id,
      plan_name: normalized.plan_name,
      name: normalized.plan_name,
      duration_days: normalized.duration_days,
      days: normalized.duration_days,
      price: this.formatPrice(normalized.price),
      original_price: this.formatPrice(normalized.original_price),
      tag: isYear ? '年卡' : '季卡',
      desc: `${normalized.duration_days}天会员权益`,
      is_default: normalized.sort_order <= 20 ? 1 : 0,
      enabled: normalized.enabled
    };
  }

  async listPlans({enabledOnly = false, page = 1, size = 20, keyword = '', status = ''} = {}) {
    const planModel = this.model('vip_plan');
    const normalizedPage = Math.max(1, this.toInt(page, 1));
    const normalizedSize = Math.min(100, Math.max(1, this.toInt(size, 20)));
    const normalizedKeyword = this.toText(keyword);
    const normalizedStatus = this.toText(status);
    const where = {
      is_delete: 0
    };
    if (normalizedKeyword) {
      where.plan_name = ['like', `%${normalizedKeyword}%`];
    }
    if (enabledOnly) {
      where.enabled = 1;
    } else if (normalizedStatus !== '') {
      if (normalizedStatus === 'enabled' || normalizedStatus === '1') {
        where.enabled = 1;
      }
      if (normalizedStatus === 'disabled' || normalizedStatus === '0') {
        where.enabled = 0;
      }
    }
    try {
      const data = await planModel.where(where).order('sort_order ASC,id ASC').page(normalizedPage, normalizedSize).countSelect();
      data.data = (data.data || []).map((item) => this.normalizePlanRow(item));
      return data;
    } catch (error) {
      if (!this.isMissingVipTableError(error)) {
        throw error;
      }
      const fallbackRows = this.defaultPlans()
        .map((item) => this.normalizePlanRow(item))
        .filter((item) => {
          if (enabledOnly && item.enabled !== 1) {
            return false;
          }
          if (normalizedStatus === '1' || normalizedStatus === 'enabled') {
            return item.enabled === 1;
          }
          if (normalizedStatus === '0' || normalizedStatus === 'disabled') {
            return item.enabled === 0;
          }
          if (normalizedKeyword) {
            return item.plan_name.includes(normalizedKeyword);
          }
          return true;
        });
      return {
        count: fallbackRows.length,
        totalPages: 1,
        pageSize: normalizedSize,
        currentPage: normalizedPage,
        data: fallbackRows.slice((normalizedPage - 1) * normalizedSize, normalizedPage * normalizedSize)
      };
    }
  }

  async getPlanById(planId, {allowDisabled = false} = {}) {
    const normalizedId = this.toInt(planId, 0);
    if (normalizedId <= 0) {
      throw new Error('会员套餐不存在');
    }
    const where = {
      id: normalizedId,
      is_delete: 0
    };
    if (!allowDisabled) {
      where.enabled = 1;
    }
    try {
      const row = await this.model('vip_plan').where(where).find();
      if (think.isEmpty(row)) {
        throw new Error('会员套餐不存在');
      }
      return this.normalizePlanRow(row);
    } catch (error) {
      if (!this.isMissingVipTableError(error)) {
        throw error;
      }
      const fallback = this.defaultPlans().find((item) => this.toInt(item.id, 0) === normalizedId);
      if (!fallback) {
        throw new Error('会员套餐不存在');
      }
      const normalized = this.normalizePlanRow(fallback);
      if (!allowDisabled && normalized.enabled !== 1) {
        throw new Error('会员套餐未启用');
      }
      return normalized;
    }
  }

  async getActiveVipUser(userId, nowTs = this.nowTs()) {
    const uid = this.toInt(userId, 0);
    if (uid <= 0) {
      return null;
    }
    try {
      const row = await this.model('vip_user').where({
        user_id: uid,
        is_delete: 0,
        status: VIP_USER_STATUS_ACTIVE
      }).order('id DESC').find();
      if (think.isEmpty(row)) {
        return null;
      }
      const expireTime = this.toInt(row.expire_time, 0);
      if (expireTime <= nowTs) {
        return null;
      }
      return row;
    } catch (error) {
      if (this.isMissingVipTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  normalizeVipUserStatus(row, nowTs = this.nowTs()) {
    if (think.isEmpty(row)) {
      return {
        is_vip: 0,
        status: VIP_USER_STATUS_EXPIRED,
        status_text: '尚未开通黄金会员',
        plan_id: 0,
        plan_name: '',
        expire_time: 0,
        expire_time_text: '',
        autorenew_status: VIP_AUTORENEW_OFF,
        next_renew_at: 0,
        grace_expire_at: 0
      };
    }
    const expireTime = this.toInt(row.expire_time, 0);
    const isVip = expireTime > nowTs && this.toText(row.status) === VIP_USER_STATUS_ACTIVE;
    return {
      is_vip: isVip ? 1 : 0,
      status: isVip ? VIP_USER_STATUS_ACTIVE : VIP_USER_STATUS_EXPIRED,
      status_text: isVip ? '黄金会员已开通' : '黄金会员已过期',
      plan_id: this.toInt(row.plan_id, 0),
      plan_name: this.toText(row.plan_name || ''),
      expire_time: expireTime,
      expire_time_text: this.formatDateTime(expireTime),
      autorenew_status: this.toText(row.autorenew_status || VIP_AUTORENEW_OFF) || VIP_AUTORENEW_OFF,
      next_renew_at: this.toInt(row.next_renew_at, 0),
      grace_expire_at: this.toInt(row.grace_expire_at, 0)
    };
  }

  async getVipStatus(userId) {
    const nowTs = this.nowTs();
    const active = await this.getActiveVipUser(userId, nowTs);
    return this.normalizeVipUserStatus(active, nowTs);
  }

  vipBenefitSummary() {
    return [
      '会员专享价：按SKU固定价结算',
      '每月会员券：每月6张，30天有效',
      '价格规则：会员价与促销二选一取低价，再叠加优惠券',
      '退款规则：7天内且未使用权益可申请退款'
    ];
  }

  async getVipHome(userId) {
    const status = await this.getVipStatus(userId);
    const planListData = await this.listPlans({enabledOnly: true, page: 1, size: 50});
    const plans = (planListData.data || []).map((item) => this.planToMiniPayload(item));
    const defaultPlan = plans[0] || null;
    return {
      status,
      benefit_summary: this.vipBenefitSummary(),
      plans,
      default_plan_id: defaultPlan ? Number(defaultPlan.plan_id || defaultPlan.id || 0) : 0,
      submit_button_text: status.is_vip === 1 ? '立即续费' : '立即开通',
      agreement_text: '开通即表示同意《会员服务协议》',
      vip_enabled: this.getVipEnabled() ? 1 : 0,
      autorenew_available: this.isPapayConfigured() ? 1 : 0
    };
  }

  async getVipCheckout(userId, planId) {
    const status = await this.getVipStatus(userId);
    const selectedPlanId = this.toInt(planId, 0);
    let plan = null;
    if (selectedPlanId > 0) {
      plan = await this.getPlanById(selectedPlanId);
    } else {
      const plansData = await this.listPlans({enabledOnly: true, page: 1, size: 1});
      const firstPlan = (plansData.data || [])[0];
      if (!firstPlan) {
        throw new Error('暂无可用会员套餐');
      }
      plan = this.normalizePlanRow(firstPlan);
    }
    return {
      status,
      selected_plan: this.planToMiniPayload(plan),
      amount: this.formatPrice(plan.price)
    };
  }

  buildVipOrderPayload({orderSn, userId, userInfo = {}, plan, nowTs}) {
    const nickname = this.toText(userInfo.nickname || 'VIP会员');
    const mobile = this.toText(userInfo.mobile || '');
    const price = this.toPrice(plan.price, 0);
    return {
      order_sn: orderSn,
      user_id: this.toInt(userId, 0),
      order_status: 101,
      order_type: 8,
      pay_status: 0,
      pay_id: '0',
      consignee: nickname || 'VIP会员',
      country: 0,
      province: 0,
      city: 0,
      district: 0,
      address: 'VIP会员开通',
      print_info: `VIP开通:${plan.plan_name}`,
      mobile: mobile || '0',
      postscript: Buffer.from('VIP会员订单', 'utf8').toString('base64'),
      add_time: nowTs,
      pay_expire_at: nowTs + 24 * 60 * 60,
      goods_price: this.formatPrice(price),
      order_price: this.formatPrice(price),
      actual_price: this.formatPrice(price),
      change_price: this.formatPrice(price),
      freight_price: 0,
      coupon_price: '0.00',
      promotions_price: '0.00',
      vip_discount_price: '0.00',
      coupon_detail_json: JSON.stringify([]),
      offline_pay: 0,
      is_delete: 0
    };
  }

  buildVipOrderRecord({orderId, orderSn, userId, plan, nowTs}) {
    const price = this.toPrice(plan.price, 0);
    return {
      order_id: this.toInt(orderId, 0),
      order_sn: orderSn,
      user_id: this.toInt(userId, 0),
      plan_id: this.toInt(plan.id, 0),
      plan_name: this.toText(plan.plan_name),
      duration_days: this.toInt(plan.duration_days, 30),
      order_amount: this.formatPrice(price),
      pay_amount: '0.00',
      pay_status: VIP_PAY_STATUS_UNPAID,
      status: VIP_ORDER_STATUS_PENDING_PAY,
      pay_time: 0,
      start_time: 0,
      expire_time: 0,
      refund_status: VIP_REFUND_STATUS_NONE,
      refund_amount: '0.00',
      refund_reason: '',
      refund_sn: '',
      refund_apply_at: 0,
      refund_audit_at: 0,
      refund_completed_at: 0,
      refund_audit_admin_id: 0,
      refund_remark: '',
      source: 'manual',
      is_delete: 0,
      add_time: nowTs,
      update_time: nowTs
    };
  }

  async submitVipOrder({userId, planId, requestId = ''} = {}) {
    if (!this.getVipEnabled()) {
      throw new Error('会员功能暂未开启');
    }
    const uid = this.toInt(userId, 0);
    const pid = this.toInt(planId, 0);
    if (uid <= 0) {
      throw new Error('请先登录');
    }
    if (pid <= 0) {
      throw new Error('请选择会员套餐');
    }
    const plan = await this.getPlanById(pid);
    if (this.toPrice(plan.price, 0) <= 0) {
      throw new Error('套餐价格配置错误');
    }
    const nowTs = this.nowTs();
    const userInfo = await this.model('user').where({
      id: uid
    }).field('id,nickname,mobile').find();

    const rootModel = this.model('order');
    let persistedOrder = null;
    let persistedVipOrder = null;

    await orderSnUtil.withOrderSnRetry({
      maxRetries: 3,
      context: 'api.service.vip.submitVipOrder',
      logger: think.logger,
      requestId: this.toText(requestId),
      createOrderSn: () => orderSnUtil.generateOrderSn(),
      execute: async (orderSn) => {
        await rootModel.transaction(async () => {
          const bindModel = (name) => {
            const model = rootModel.model(name);
            model.db(rootModel.db());
            return model;
          };
          const orderModel = bindModel('order');
          const vipOrderModel = bindModel('vip_order');

          const orderPayload = this.buildVipOrderPayload({
            orderSn,
            userId: uid,
            userInfo,
            plan,
            nowTs
          });
          const orderId = await orderModel.add(orderPayload);
          if (!orderId) {
            throw new Error('创建会员订单失败');
          }

          const vipOrderPayload = this.buildVipOrderRecord({
            orderId,
            orderSn,
            userId: uid,
            plan,
            nowTs
          });
          const vipOrderId = await vipOrderModel.add(vipOrderPayload);
          if (!vipOrderId) {
            throw new Error('创建会员业务订单失败');
          }

          persistedOrder = Object.assign({}, orderPayload, {
            id: this.toInt(orderId, 0)
          });
          persistedVipOrder = Object.assign({}, vipOrderPayload, {
            id: this.toInt(vipOrderId, 0)
          });
        });
      }
    });

    await this.logVipEvent({
      userId: uid,
      eventType: 'vip_order',
      eventAction: 'submit',
      orderId: persistedOrder.id,
      vipOrderId: persistedVipOrder.id,
      requestId: this.toText(requestId),
      payload: {
        plan_id: this.toInt(plan.id, 0),
        amount: this.toPrice(plan.price, 0)
      }
    });

    return {
      orderInfo: persistedOrder,
      vipOrderInfo: persistedVipOrder
    };
  }

  resolveActivePlanId(activeVipUser = null) {
    if (activeVipUser && this.toInt(activeVipUser.plan_id, 0) > 0) {
      return this.toInt(activeVipUser.plan_id, 0);
    }
    return 0;
  }

  async getVipSkuPriceRows({planId, skuIds = [], goodsIds = []} = {}) {
    const normalizedPlanId = this.toInt(planId, 0);
    if (normalizedPlanId <= 0) {
      return [];
    }
    const normalizedSkuIds = Array.from(new Set((Array.isArray(skuIds) ? skuIds : []).map((item) => this.toInt(item, 0)).filter((id) => id > 0)));
    const normalizedGoodsIds = Array.from(new Set((Array.isArray(goodsIds) ? goodsIds : []).map((item) => this.toInt(item, 0)).filter((id) => id > 0)));
    if (!normalizedSkuIds.length && !normalizedGoodsIds.length) {
      return [];
    }
    const where = {
      plan_id: normalizedPlanId,
      enabled: 1,
      is_delete: 0
    };
    if (normalizedSkuIds.length) {
      where.sku_id = ['IN', normalizedSkuIds];
    }
    try {
      let rows = await this.model('vip_sku_price').where(where).select();
      if (!rows.length && normalizedGoodsIds.length) {
        rows = await this.model('vip_sku_price').where({
          plan_id: normalizedPlanId,
          enabled: 1,
          is_delete: 0,
          goods_id: ['IN', normalizedGoodsIds]
        }).select();
      }
      return rows || [];
    } catch (error) {
      if (this.isMissingVipTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  buildVipSkuPriceMap(rows = []) {
    const skuMap = new Map();
    const goodsMap = new Map();
    (rows || []).forEach((row) => {
      const skuId = this.toInt(row.sku_id, 0);
      const goodsId = this.toInt(row.goods_id, 0);
      const vipPrice = this.toPrice(row.vip_price, 0);
      if (skuId > 0 && vipPrice > 0) {
        skuMap.set(skuId, vipPrice);
      }
      if (goodsId > 0 && vipPrice > 0) {
        const current = goodsMap.get(goodsId);
        if (!current || vipPrice < current) {
          goodsMap.set(goodsId, vipPrice);
        }
      }
    });
    return {
      skuMap,
      goodsMap
    };
  }

  async applyVipPriceToCartItems({userId, cartItems = []} = {}) {
    const list = Array.isArray(cartItems) ? cartItems.map((item) => Object.assign({}, item)) : [];
    if (!list.length || !this.getVipEnabled()) {
      return {
        cartItems: list,
        vipDiscountPrice: 0,
        vipAppliedItems: []
      };
    }
    const nowTs = this.nowTs();
    const activeVip = await this.getActiveVipUser(userId, nowTs);
    const activePlanId = this.resolveActivePlanId(activeVip);
    if (activePlanId <= 0) {
      return {
        cartItems: list,
        vipDiscountPrice: 0,
        vipAppliedItems: []
      };
    }

    const skuIds = list.map((item) => this.toInt(item.product_id, 0)).filter((id) => id > 0);
    const goodsIds = list.map((item) => this.toInt(item.goods_id, 0)).filter((id) => id > 0);
    const rows = await this.getVipSkuPriceRows({
      planId: activePlanId,
      skuIds,
      goodsIds
    });
    if (!rows.length) {
      return {
        cartItems: list,
        vipDiscountPrice: 0,
        vipAppliedItems: []
      };
    }
    const {skuMap, goodsMap} = this.buildVipSkuPriceMap(rows);
    let vipDiscountPrice = 0;
    const vipAppliedItems = [];

    const nextList = list.map((item) => {
      const productId = this.toInt(item.product_id, 0);
      const goodsId = this.toInt(item.goods_id, 0);
      const number = Math.max(0, this.toInt(item.number, 0));
      const currentUnitPrice = this.toPrice(item.display_price || item.promotion_price || item.retail_price, 0);
      const vipUnitPrice = this.toPrice(skuMap.get(productId) || goodsMap.get(goodsId) || 0, 0);
      if (vipUnitPrice <= 0) {
        return Object.assign({}, item, {
          vip_price: '',
          is_vip_price_active: 0
        });
      }
      const next = Object.assign({}, item, {
        vip_price: this.formatPrice(vipUnitPrice),
        is_vip_price_active: 1
      });
      if (number <= 0 || vipUnitPrice >= currentUnitPrice) {
        return next;
      }
      const discount = Math.max(0, (currentUnitPrice - vipUnitPrice) * number);
      vipDiscountPrice += discount;
      vipAppliedItems.push({
        goods_id: goodsId,
        product_id: productId,
        number,
        current_unit_price: this.formatPrice(currentUnitPrice),
        vip_unit_price: this.formatPrice(vipUnitPrice),
        discount_price: this.formatPrice(discount)
      });
      return Object.assign({}, next, {
        display_price: this.formatPrice(vipUnitPrice),
        effective_unit_price: this.formatPrice(vipUnitPrice),
        vip_applied: 1
      });
    });

    return {
      cartItems: nextList,
      vipDiscountPrice: this.toPrice(vipDiscountPrice, 0),
      vipAppliedItems
    };
  }

  async decorateGoodsDetail({userId = 0, goodsInfo = {}, productList = []} = {}) {
    const products = Array.isArray(productList) ? productList.map((item) => Object.assign({}, item)) : [];
    const nextGoodsInfo = Object.assign({}, goodsInfo);
    if (!this.getVipEnabled()) {
      return {
        goodsInfo: Object.assign({}, nextGoodsInfo, {
          vip_price: '',
          is_vip_price_active: 0
        }),
        productList: products
      };
    }

    const nowTs = this.nowTs();
    const activeVip = await this.getActiveVipUser(userId, nowTs);
    let selectedPlanId = this.resolveActivePlanId(activeVip);
    if (selectedPlanId <= 0) {
      const plansData = await this.listPlans({enabledOnly: true, page: 1, size: 1});
      const firstPlan = (plansData.data || [])[0];
      selectedPlanId = this.toInt(firstPlan && firstPlan.id, 0);
    }
    if (selectedPlanId <= 0) {
      return {
        goodsInfo: Object.assign({}, nextGoodsInfo, {
          vip_price: '',
          is_vip_price_active: 0
        }),
        productList: products
      };
    }

    const skuIds = products.map((item) => this.toInt(item.id, 0)).filter((id) => id > 0);
    const goodsId = this.toInt(nextGoodsInfo.id, 0);
    const rows = await this.getVipSkuPriceRows({
      planId: selectedPlanId,
      skuIds,
      goodsIds: goodsId > 0 ? [goodsId] : []
    });
    if (!rows.length) {
      return {
        goodsInfo: Object.assign({}, nextGoodsInfo, {
          vip_price: '',
          is_vip_price_active: 0
        }),
        productList: products
      };
    }

    const {skuMap, goodsMap} = this.buildVipSkuPriceMap(rows);
    const activePlanId = this.resolveActivePlanId(activeVip);
    let goodsVipPrice = this.toPrice(goodsMap.get(goodsId) || 0, 0);

    const nextProducts = products.map((item) => {
      const skuId = this.toInt(item.id, 0);
      const vipPrice = this.toPrice(skuMap.get(skuId) || goodsMap.get(goodsId) || 0, 0);
      if (vipPrice <= 0) {
        return Object.assign({}, item, {
          vip_price: '',
          is_vip_price_active: 0
        });
      }
      if (goodsVipPrice <= 0 || vipPrice < goodsVipPrice) {
        goodsVipPrice = vipPrice;
      }
      return Object.assign({}, item, {
        vip_price: this.formatPrice(vipPrice),
        is_vip_price_active: activePlanId > 0 && activePlanId === selectedPlanId ? 1 : 0
      });
    });

    return {
      goodsInfo: Object.assign({}, nextGoodsInfo, {
        vip_price: goodsVipPrice > 0 ? this.formatPrice(goodsVipPrice) : '',
        is_vip_price_active: activePlanId > 0 && activePlanId === selectedPlanId && goodsVipPrice > 0 ? 1 : 0
      }),
      productList: nextProducts
    };
  }

  async logVipEvent({
    userId = 0,
    eventType = '',
    eventAction = '',
    orderId = 0,
    vipOrderId = 0,
    requestId = '',
    operatorType = 'system',
    operatorId = 0,
    payload = null
  } = {}) {
    try {
      await this.model('vip_event_log').add({
        user_id: this.toInt(userId, 0),
        event_type: this.toText(eventType),
        event_action: this.toText(eventAction),
        order_id: this.toInt(orderId, 0),
        vip_order_id: this.toInt(vipOrderId, 0),
        request_id: this.toText(requestId),
        payload_json: payload ? JSON.stringify(payload) : '{}',
        operator_type: this.toText(operatorType) || 'system',
        operator_id: this.toInt(operatorId, 0),
        add_time: this.nowTs()
      });
    } catch (error) {
      if (!this.isMissingVipTableError(error)) {
        think.logger && think.logger.warn && think.logger.warn(`[vip.logVipEvent] ${error.message || error}`);
      }
    }
  }

  async upsertVipUserByPaidOrder({vipOrder, plan, paidAt, orderId}) {
    const uid = this.toInt(vipOrder.user_id, 0);
    const durationDays = Math.max(1, this.toInt(vipOrder.duration_days || plan.duration_days, 30));
    const extendSeconds = durationDays * 24 * 60 * 60;
    const vipUserModel = this.model('vip_user');
    const existing = await vipUserModel.where({
      user_id: uid,
      is_delete: 0
    }).order('id DESC').find();

    const activeExpire = this.toInt(existing.expire_time, 0);
    const baseStart = activeExpire > paidAt ? activeExpire : paidAt;
    const newExpireTime = baseStart + extendSeconds;

    if (think.isEmpty(existing)) {
      const vipUserId = await vipUserModel.add({
        user_id: uid,
        plan_id: this.toInt(plan.id, 0),
        plan_name: this.toText(plan.plan_name),
        status: VIP_USER_STATUS_ACTIVE,
        start_time: paidAt,
        expire_time: newExpireTime,
        last_order_id: this.toInt(orderId, 0),
        autorenew_status: VIP_AUTORENEW_OFF,
        contract_id: '',
        next_renew_at: newExpireTime,
        grace_expire_at: 0,
        retry_count: 0,
        is_delete: 0,
        add_time: paidAt,
        update_time: paidAt
      });
      return {
        vipUserId: this.toInt(vipUserId, 0),
        startTime: paidAt,
        expireTime: newExpireTime
      };
    }

    await vipUserModel.where({
      id: this.toInt(existing.id, 0)
    }).update({
      plan_id: this.toInt(plan.id, 0),
      plan_name: this.toText(plan.plan_name),
      status: VIP_USER_STATUS_ACTIVE,
      start_time: this.toInt(existing.start_time, 0) > 0 ? this.toInt(existing.start_time, 0) : paidAt,
      expire_time: newExpireTime,
      last_order_id: this.toInt(orderId, 0),
      next_renew_at: newExpireTime,
      grace_expire_at: 0,
      retry_count: 0,
      update_time: paidAt
    });

    return {
      vipUserId: this.toInt(existing.id, 0),
      startTime: this.toInt(existing.start_time, 0) > 0 ? this.toInt(existing.start_time, 0) : paidAt,
      expireTime: newExpireTime
    };
  }

  async handleOrderPaid(orderId, {requestId = '', payResult = null} = {}) {
    const normalizedOrderId = this.toInt(orderId, 0);
    if (normalizedOrderId <= 0) {
      throw new Error('订单参数错误');
    }
    const rootModel = this.model('order');
    let paidResult = null;

    await rootModel.transaction(async () => {
      const bindModel = (name) => {
        const model = rootModel.model(name);
        model.db(rootModel.db());
        return model;
      };
      const orderModel = bindModel('order');
      const vipOrderModel = bindModel('vip_order');

      const orderInfo = await orderModel.where({
        id: normalizedOrderId,
        is_delete: 0
      }).find();
      if (think.isEmpty(orderInfo)) {
        throw new Error('订单不存在');
      }
      if (this.toInt(orderInfo.order_type, 0) !== 8) {
        throw new Error('非会员订单');
      }

      const vipOrderInfo = await vipOrderModel.where({
        order_id: normalizedOrderId,
        is_delete: 0
      }).find();
      if (think.isEmpty(vipOrderInfo)) {
        throw new Error('会员业务订单不存在');
      }

      if (this.toText(vipOrderInfo.pay_status) === VIP_PAY_STATUS_PAID && this.toInt(orderInfo.pay_status, 0) === 2) {
        paidResult = {
          orderId: normalizedOrderId,
          idempotent: true,
          vipUser: null
        };
        return;
      }

      const paidAt = this.parsePayTimeToUnix(payResult && payResult.time_end);
      await orderModel.where({
        id: normalizedOrderId
      }).update({
        pay_status: 2,
        order_status: 201,
        pay_id: this.toText(payResult && payResult.transaction_id) || this.toText(orderInfo.pay_id) || `vip_tx_${Date.now()}`,
        pay_time: paidAt
      });

      const plan = await this.getPlanById(this.toInt(vipOrderInfo.plan_id, 0), {allowDisabled: true});
      const vipUser = await this.upsertVipUserByPaidOrder({
        vipOrder: vipOrderInfo,
        plan,
        paidAt,
        orderId: normalizedOrderId
      });

      await vipOrderModel.where({
        id: this.toInt(vipOrderInfo.id, 0)
      }).update({
        pay_status: VIP_PAY_STATUS_PAID,
        status: VIP_ORDER_STATUS_PAID,
        pay_amount: this.formatPrice(this.toPrice(orderInfo.actual_price, vipOrderInfo.order_amount || 0)),
        pay_time: paidAt,
        start_time: vipUser.startTime,
        expire_time: vipUser.expireTime,
        update_time: paidAt
      });

      paidResult = {
        orderId: normalizedOrderId,
        idempotent: false,
        vipUser,
        vipOrderId: this.toInt(vipOrderInfo.id, 0),
        userId: this.toInt(vipOrderInfo.user_id, 0),
        planId: this.toInt(vipOrderInfo.plan_id, 0)
      };
    });

    if (!paidResult) {
      throw new Error('会员支付处理失败');
    }

    if (!paidResult.idempotent) {
      await this.logVipEvent({
        userId: paidResult.userId,
        eventType: 'membership',
        eventAction: 'activate',
        orderId: paidResult.orderId,
        vipOrderId: paidResult.vipOrderId,
        requestId: this.toText(requestId),
        payload: {
          plan_id: paidResult.planId,
          expire_time: paidResult.vipUser ? paidResult.vipUser.expireTime : 0
        }
      });

      try {
        const vipUserRow = await this.model('vip_user').where({
          user_id: this.toInt(paidResult.userId, 0),
          is_delete: 0
        }).order('id DESC').find();
        const plan = await this.getPlanById(this.toInt(paidResult.planId, 0), {allowDisabled: true});
        await this.grantMonthlyCouponsForMember({
          vipUser: vipUserRow,
          plan,
          nowTs: this.nowTs()
        });
      } catch (error) {
        think.logger && think.logger.warn && think.logger.warn(`[vip.handleOrderPaid.grantMonthly] orderId=${paidResult.orderId} ${error.message || error}`);
      }
    }

    return paidResult;
  }

  buildMonthlyBatchKey(nowTs = this.nowTs()) {
    const date = new Date(this.toInt(nowTs, this.nowTs()) * 1000);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}`;
  }

  buildGrantBatchKey(planId, batchKey, index) {
    return `vip:${this.toInt(planId, 0)}:${this.toText(batchKey)}:${this.toInt(index, 0)}`;
  }

  async grantMonthlyCouponsForMember({vipUser, plan, nowTs = this.nowTs()} = {}) {
    const userId = this.toInt(vipUser && vipUser.user_id, 0);
    const normalizedPlan = this.normalizePlanRow(plan || {});
    if (userId <= 0 || normalizedPlan.id <= 0) {
      return {
        granted: 0,
        skipped: true,
        reason: 'invalid_member'
      };
    }
    const couponId = this.toInt(normalizedPlan.monthly_coupon_id, 0);
    const couponCount = Math.max(0, this.toInt(normalizedPlan.monthly_coupon_count, this.defaultMonthlyCouponCount()));
    const validDays = Math.max(1, this.toInt(normalizedPlan.monthly_coupon_valid_days, this.defaultMonthlyCouponValidDays()));
    if (couponId <= 0 || couponCount <= 0) {
      return {
        granted: 0,
        skipped: true,
        reason: 'rule_not_configured'
      };
    }

    const batchKey = this.buildMonthlyBatchKey(nowTs);
    const logModel = this.model('vip_coupon_grant_log');
    const existedLog = await logModel.where({
      user_id: userId,
      plan_id: normalizedPlan.id,
      coupon_id: couponId,
      grant_batch_key: batchKey,
      is_delete: 0
    }).find();
    if (!think.isEmpty(existedLog)) {
      return {
        granted: this.toInt(existedLog.grant_count, 0),
        skipped: true,
        reason: 'already_granted'
      };
    }

    const now = this.toInt(nowTs, this.nowTs());
    let logId = 0;
    try {
      logId = await logModel.add({
        user_id: userId,
        plan_id: normalizedPlan.id,
        coupon_id: couponId,
        grant_batch_key: batchKey,
        grant_count: 0,
        valid_days: validDays,
        status: 'processing',
        remark: '',
        is_delete: 0,
        add_time: now,
        update_time: now
      });
    } catch (error) {
      if (this.isDuplicateError(error)) {
        return {
          granted: 0,
          skipped: true,
          reason: 'already_granted'
        };
      }
      throw error;
    }

    const couponService = this.service('coupon', 'api');
    const expireTimeOverride = now + validDays * 24 * 60 * 60;
    let grantedCount = 0;
    for (let i = 1; i <= couponCount; i += 1) {
      const grantBatchKey = this.buildGrantBatchKey(normalizedPlan.id, batchKey, i);
      try {
        await couponService.receiveCoupon(userId, couponId, {
          allowMultiple: true,
          ignorePerUserLimit: true,
          skipSegmentCheck: true,
          grantBatchKey,
          expireTimeOverride,
          idempotent: true
        });
        grantedCount += 1;
      } catch (error) {
        think.logger && think.logger.warn && think.logger.warn(`[vip.grantMonthlyCoupons] userId=${userId} planId=${normalizedPlan.id} batch=${batchKey} idx=${i} ${error.message || error}`);
      }
    }

    await logModel.where({
      id: this.toInt(logId, 0)
    }).update({
      grant_count: grantedCount,
      status: grantedCount >= couponCount ? 'done' : 'partial',
      update_time: this.nowTs(),
      remark: grantedCount >= couponCount ? '' : '部分发放失败'
    });

    return {
      granted: grantedCount,
      skipped: false,
      reason: grantedCount >= couponCount ? 'ok' : 'partial'
    };
  }

  async scanMonthlyCouponGrant(nowTs = this.nowTs()) {
    const now = this.toInt(nowTs, this.nowTs());
    let activeMembers = [];
    try {
      activeMembers = await this.model('vip_user').where({
        is_delete: 0,
        status: VIP_USER_STATUS_ACTIVE,
        expire_time: ['>', now]
      }).select();
    } catch (error) {
      if (this.isMissingVipTableError(error)) {
        return {
          scanned: 0,
          granted: 0,
          skipped: 0
        };
      }
      throw error;
    }

    const planIds = Array.from(new Set(activeMembers.map((item) => this.toInt(item.plan_id, 0)).filter((id) => id > 0)));
    const plans = planIds.length > 0
      ? await this.model('vip_plan').where({
        id: ['IN', planIds],
        is_delete: 0
      }).select()
      : [];
    const planMap = new Map((plans || []).map((item) => [this.toInt(item.id, 0), this.normalizePlanRow(item)]));

    let granted = 0;
    let skipped = 0;
    for (const member of activeMembers) {
      const plan = planMap.get(this.toInt(member.plan_id, 0));
      if (!plan) {
        skipped += 1;
        continue;
      }
      try {
        const result = await this.grantMonthlyCouponsForMember({
          vipUser: member,
          plan,
          nowTs: now
        });
        granted += this.toInt(result.granted, 0);
        if (result.skipped) {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        think.logger && think.logger.error && think.logger.error(`[vip.scanMonthlyCouponGrant] userId=${member.user_id} ${error.message || error}`);
      }
    }

    return {
      scanned: activeMembers.length,
      granted,
      skipped
    };
  }

  async recordVipDiscountUsage({userId, orderId, vipOrderId = 0, vipDiscountPrice = 0, vipAppliedItems = [], requestId = ''} = {}) {
    if (this.toPrice(vipDiscountPrice, 0) <= 0) {
      return;
    }
    await this.logVipEvent({
      userId,
      eventType: 'discount',
      eventAction: 'order_apply',
      orderId,
      vipOrderId,
      requestId,
      payload: {
        vip_discount_price: this.toPrice(vipDiscountPrice, 0),
        vip_applied_items: Array.isArray(vipAppliedItems) ? vipAppliedItems : []
      }
    });
  }

  async ensureRefundEligibility(userId, vipOrder, plan) {
    const uid = this.toInt(userId, 0);
    const now = this.nowTs();
    const payTime = this.toInt(vipOrder.pay_time, 0);
    if (payTime <= 0) {
      throw new Error('该会员订单尚未支付');
    }
    if (now - payTime > 7 * 24 * 60 * 60) {
      throw new Error('仅支持支付后7天内申请退款');
    }
    const refundStatus = this.toText(vipOrder.refund_status || VIP_REFUND_STATUS_NONE);
    if (refundStatus !== VIP_REFUND_STATUS_NONE && refundStatus !== VIP_REFUND_STATUS_REJECTED) {
      throw new Error('该订单已在退款处理中');
    }

    const usedDiscountCount = await this.model('order').where({
      user_id: uid,
      is_delete: 0,
      order_type: ['<', 7],
      vip_discount_price: ['>', 0],
      add_time: ['BETWEEN', [payTime, this.toInt(vipOrder.expire_time, payTime)]]
    }).count('id');
    if (this.toInt(usedDiscountCount, 0) > 0) {
      throw new Error('已使用会员价权益，暂不支持退款');
    }

    const couponId = this.toInt(plan.monthly_coupon_id, 0);
    if (couponId > 0) {
      const usedCouponCount = await this.model('user_coupon').where({
        user_id: uid,
        coupon_id: couponId,
        status: 'used',
        is_delete: 0,
        used_time: ['BETWEEN', [payTime, this.toInt(vipOrder.expire_time, payTime)]],
        grant_batch_key: ['like', `vip:${this.toInt(plan.id, 0)}:%`]
      }).count('id');
      if (this.toInt(usedCouponCount, 0) > 0) {
        throw new Error('已使用会员券权益，暂不支持退款');
      }
    }
  }

  async applyRefund({userId, reason = '', requestId = ''} = {}) {
    const uid = this.toInt(userId, 0);
    if (uid <= 0) {
      throw new Error('请先登录');
    }
    const vipOrder = await this.model('vip_order').where({
      user_id: uid,
      is_delete: 0,
      pay_status: VIP_PAY_STATUS_PAID,
      status: VIP_ORDER_STATUS_PAID
    }).order('pay_time DESC,id DESC').find();
    if (think.isEmpty(vipOrder)) {
      throw new Error('暂无可退款会员订单');
    }
    const plan = await this.getPlanById(this.toInt(vipOrder.plan_id, 0), {allowDisabled: true});
    await this.ensureRefundEligibility(uid, vipOrder, plan);

    const now = this.nowTs();
    await this.model('vip_order').where({
      id: this.toInt(vipOrder.id, 0)
    }).update({
      refund_status: VIP_REFUND_STATUS_PENDING,
      refund_reason: this.toText(reason),
      refund_apply_at: now,
      refund_remark: this.toText(reason),
      update_time: now
    });

    await this.logVipEvent({
      userId: uid,
      eventType: 'refund',
      eventAction: 'apply',
      orderId: this.toInt(vipOrder.order_id, 0),
      vipOrderId: this.toInt(vipOrder.id, 0),
      requestId,
      payload: {
        reason: this.toText(reason)
      }
    });

    return {
      vipOrderId: this.toInt(vipOrder.id, 0),
      refund_status: VIP_REFUND_STATUS_PENDING
    };
  }

  buildRefundSn(nowTs = this.nowTs()) {
    const random = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    return `VIPRF${this.toInt(nowTs, this.nowTs())}${random}`;
  }

  async approveRefund({vipOrderId, adminId = 0, remark = '', requestId = ''} = {}) {
    const normalizedVipOrderId = this.toInt(vipOrderId, 0);
    if (normalizedVipOrderId <= 0) {
      throw new Error('退款订单参数错误');
    }

    const rootModel = this.model('vip_order');
    let finalResult = null;
    await rootModel.transaction(async () => {
      const bindModel = (name) => {
        const model = rootModel.model(name);
        model.db(rootModel.db());
        return model;
      };
      const vipOrderModel = bindModel('vip_order');
      const vipUserModel = bindModel('vip_user');
      const orderModel = bindModel('order');
      const userCouponModel = bindModel('user_coupon');

      const vipOrder = await vipOrderModel.where({
        id: normalizedVipOrderId,
        is_delete: 0
      }).find();
      if (think.isEmpty(vipOrder)) {
        throw new Error('会员订单不存在');
      }
      if (this.toText(vipOrder.refund_status) !== VIP_REFUND_STATUS_PENDING) {
        throw new Error('该退款单状态不可审核通过');
      }

      const plan = await this.getPlanById(this.toInt(vipOrder.plan_id, 0), {allowDisabled: true});
      const now = this.nowTs();
      const durationSeconds = Math.max(1, this.toInt(vipOrder.duration_days || plan.duration_days, 30)) * 24 * 60 * 60;

      const vipUser = await vipUserModel.where({
        user_id: this.toInt(vipOrder.user_id, 0),
        is_delete: 0
      }).order('id DESC').find();
      if (!think.isEmpty(vipUser)) {
        const currentExpireTime = this.toInt(vipUser.expire_time, 0);
        const nextExpireTime = Math.max(now, currentExpireTime - durationSeconds);
        await vipUserModel.where({
          id: this.toInt(vipUser.id, 0)
        }).update({
          expire_time: nextExpireTime,
          status: nextExpireTime > now ? VIP_USER_STATUS_ACTIVE : VIP_USER_STATUS_EXPIRED,
          update_time: now
        });
      }

      const couponId = this.toInt(plan.monthly_coupon_id, 0);
      if (couponId > 0) {
        await userCouponModel.where({
          user_id: this.toInt(vipOrder.user_id, 0),
          coupon_id: couponId,
          status: 'unused',
          is_delete: 0,
          claim_time: ['BETWEEN', [this.toInt(vipOrder.pay_time, 0), this.toInt(vipOrder.expire_time, 0)]],
          grant_batch_key: ['like', `vip:${this.toInt(plan.id, 0)}:%`]
        }).update({
          status: 'expired',
          expire_time: now
        });
      }

      await orderModel.where({
        id: this.toInt(vipOrder.order_id, 0)
      }).update({
        order_status: 203
      });

      const refundSn = this.buildRefundSn(now);
      await vipOrderModel.where({
        id: normalizedVipOrderId
      }).update({
        refund_status: VIP_REFUND_STATUS_COMPLETED,
        refund_amount: this.formatPrice(this.toPrice(vipOrder.pay_amount || vipOrder.order_amount, 0)),
        refund_sn: refundSn,
        refund_audit_at: now,
        refund_completed_at: now,
        refund_audit_admin_id: this.toInt(adminId, 0),
        refund_remark: this.toText(remark),
        pay_status: VIP_PAY_STATUS_REFUNDED,
        status: VIP_ORDER_STATUS_REFUNDED,
        update_time: now
      });

      finalResult = {
        vipOrderId: normalizedVipOrderId,
        refundSn,
        userId: this.toInt(vipOrder.user_id, 0),
        orderId: this.toInt(vipOrder.order_id, 0)
      };
    });

    await this.logVipEvent({
      userId: finalResult.userId,
      eventType: 'refund',
      eventAction: 'approve',
      orderId: finalResult.orderId,
      vipOrderId: finalResult.vipOrderId,
      requestId,
      operatorType: 'admin',
      operatorId: this.toInt(adminId, 0),
      payload: {
        refund_sn: finalResult.refundSn,
        remark: this.toText(remark)
      }
    });

    return finalResult;
  }

  async rejectRefund({vipOrderId, adminId = 0, reason = '', requestId = ''} = {}) {
    const normalizedVipOrderId = this.toInt(vipOrderId, 0);
    if (normalizedVipOrderId <= 0) {
      throw new Error('退款订单参数错误');
    }
    const vipOrder = await this.model('vip_order').where({
      id: normalizedVipOrderId,
      is_delete: 0
    }).find();
    if (think.isEmpty(vipOrder)) {
      throw new Error('会员订单不存在');
    }
    if (this.toText(vipOrder.refund_status) !== VIP_REFUND_STATUS_PENDING) {
      throw new Error('该退款单状态不可驳回');
    }

    const now = this.nowTs();
    await this.model('vip_order').where({
      id: normalizedVipOrderId
    }).update({
      refund_status: VIP_REFUND_STATUS_REJECTED,
      refund_audit_at: now,
      refund_audit_admin_id: this.toInt(adminId, 0),
      refund_remark: this.toText(reason),
      update_time: now
    });

    await this.logVipEvent({
      userId: this.toInt(vipOrder.user_id, 0),
      eventType: 'refund',
      eventAction: 'reject',
      orderId: this.toInt(vipOrder.order_id, 0),
      vipOrderId: normalizedVipOrderId,
      requestId,
      operatorType: 'admin',
      operatorId: this.toInt(adminId, 0),
      payload: {
        reason: this.toText(reason)
      }
    });

    return {
      vipOrderId: normalizedVipOrderId,
      refund_status: VIP_REFUND_STATUS_REJECTED
    };
  }

  async listVipMembers({page = 1, size = 10, keyword = '', planId = 0, status = ''} = {}) {
    const normalizedPage = Math.max(1, this.toInt(page, 1));
    const normalizedSize = Math.min(100, Math.max(1, this.toInt(size, 10)));
    const normalizedKeyword = this.toText(keyword);
    const normalizedPlanId = this.toInt(planId, 0);
    const normalizedStatus = this.toText(status);

    const where = ['vu.is_delete = 0'];
    if (normalizedKeyword) {
      const escaped = normalizedKeyword.replace(/'/g, "''");
      where.push(`(vu.user_id = '${escaped}' OR u.mobile LIKE '%${escaped}%' OR u.nickname LIKE '%${escaped}%')`);
    }
    if (normalizedPlanId > 0) {
      where.push(`vu.plan_id = ${normalizedPlanId}`);
    }
    if (normalizedStatus) {
      const escapedStatus = normalizedStatus.replace(/'/g, "''");
      where.push(`vu.status = '${escapedStatus}'`);
    }

    const offset = (normalizedPage - 1) * normalizedSize;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT
        vu.id,
        vu.user_id,
        vu.plan_id,
        vu.plan_name,
        vu.status,
        vu.start_time,
        vu.expire_time,
        vu.autorenew_status,
        vu.next_renew_at,
        vu.grace_expire_at,
        vu.retry_count,
        vu.update_time,
        u.nickname,
        u.mobile
      FROM hiolabs_vip_user vu
      LEFT JOIN hiolabs_user u ON vu.user_id = u.id
      ${whereSql}
      ORDER BY vu.id DESC
      LIMIT ${offset}, ${normalizedSize}
    `;
    const countSql = `SELECT COUNT(1) AS total FROM hiolabs_vip_user vu LEFT JOIN hiolabs_user u ON vu.user_id = u.id ${whereSql}`;

    const model = this.model('vip_user');
    const rows = await model.query(listSql);
    const countRows = await model.query(countSql);
    const total = this.toInt(countRows[0] && countRows[0].total, 0);

    return {
      count: total,
      totalPages: Math.max(1, Math.ceil(total / normalizedSize)),
      pageSize: normalizedSize,
      currentPage: normalizedPage,
      data: (rows || []).map((item) => ({
        ...item,
        status_text: this.statusTextByVipUser(item.status)
      }))
    };
  }

  statusTextByVipUser(status) {
    const normalized = this.toText(status);
    if (normalized === VIP_USER_STATUS_ACTIVE) return '有效';
    if (normalized === VIP_USER_STATUS_EXPIRED) return '已过期';
    if (normalized === VIP_USER_STATUS_CANCELLED) return '已取消';
    return normalized || '-';
  }

  async listVipOrders({page = 1, size = 10, orderSn = '', memberKeyword = '', status = ''} = {}) {
    const normalizedPage = Math.max(1, this.toInt(page, 1));
    const normalizedSize = Math.min(100, Math.max(1, this.toInt(size, 10)));
    const normalizedOrderSn = this.toText(orderSn);
    const normalizedMemberKeyword = this.toText(memberKeyword);
    const normalizedStatus = this.toText(status);

    const where = ['vo.is_delete = 0'];
    if (normalizedOrderSn) {
      const escaped = normalizedOrderSn.replace(/'/g, "''");
      where.push(`vo.order_sn LIKE '%${escaped}%'`);
    }
    if (normalizedMemberKeyword) {
      const escaped = normalizedMemberKeyword.replace(/'/g, "''");
      where.push(`(vo.user_id = '${escaped}' OR u.mobile LIKE '%${escaped}%' OR u.nickname LIKE '%${escaped}%')`);
    }
    if (normalizedStatus) {
      const escapedStatus = normalizedStatus.replace(/'/g, "''");
      where.push(`vo.status = '${escapedStatus}'`);
    }

    const offset = (normalizedPage - 1) * normalizedSize;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT
        vo.*,
        u.nickname AS member_nickname,
        u.mobile AS member_mobile
      FROM hiolabs_vip_order vo
      LEFT JOIN hiolabs_user u ON vo.user_id = u.id
      ${whereSql}
      ORDER BY vo.id DESC
      LIMIT ${offset}, ${normalizedSize}
    `;
    const countSql = `SELECT COUNT(1) AS total FROM hiolabs_vip_order vo LEFT JOIN hiolabs_user u ON vo.user_id = u.id ${whereSql}`;

    const model = this.model('vip_order');
    const rows = await model.query(listSql);
    const countRows = await model.query(countSql);
    const total = this.toInt(countRows[0] && countRows[0].total, 0);

    return {
      count: total,
      totalPages: Math.max(1, Math.ceil(total / normalizedSize)),
      pageSize: normalizedSize,
      currentPage: normalizedPage,
      data: rows || []
    };
  }

  async listVipRefunds({page = 1, size = 10, refundSn = '', orderSn = '', status = ''} = {}) {
    const normalizedPage = Math.max(1, this.toInt(page, 1));
    const normalizedSize = Math.min(100, Math.max(1, this.toInt(size, 10)));
    const normalizedRefundSn = this.toText(refundSn);
    const normalizedOrderSn = this.toText(orderSn);
    const normalizedStatus = this.toText(status);

    const where = ['vo.is_delete = 0', `vo.refund_status <> '${VIP_REFUND_STATUS_NONE}'`];
    if (normalizedRefundSn) {
      const escaped = normalizedRefundSn.replace(/'/g, "''");
      where.push(`vo.refund_sn LIKE '%${escaped}%'`);
    }
    if (normalizedOrderSn) {
      const escaped = normalizedOrderSn.replace(/'/g, "''");
      where.push(`vo.order_sn LIKE '%${escaped}%'`);
    }
    if (normalizedStatus) {
      const escapedStatus = normalizedStatus.replace(/'/g, "''");
      where.push(`vo.refund_status = '${escapedStatus}'`);
    }

    const offset = (normalizedPage - 1) * normalizedSize;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT
        vo.id,
        vo.order_id,
        vo.order_sn,
        vo.user_id AS member_user_id,
        vo.plan_name,
        vo.refund_status AS status,
        vo.refund_amount,
        vo.refund_reason AS reason,
        vo.refund_sn,
        vo.refund_apply_at AS create_time,
        vo.refund_audit_at,
        vo.refund_completed_at,
        vo.refund_remark,
        u.nickname AS member_nickname
      FROM hiolabs_vip_order vo
      LEFT JOIN hiolabs_user u ON vo.user_id = u.id
      ${whereSql}
      ORDER BY vo.id DESC
      LIMIT ${offset}, ${normalizedSize}
    `;
    const countSql = `SELECT COUNT(1) AS total FROM hiolabs_vip_order vo LEFT JOIN hiolabs_user u ON vo.user_id = u.id ${whereSql}`;

    const model = this.model('vip_order');
    const rows = await model.query(listSql);
    const countRows = await model.query(countSql);
    const total = this.toInt(countRows[0] && countRows[0].total, 0);

    return {
      count: total,
      totalPages: Math.max(1, Math.ceil(total / normalizedSize)),
      pageSize: normalizedSize,
      currentPage: normalizedPage,
      data: (rows || []).map((item) => ({
        ...item,
        status_text: this.refundStatusText(item.status)
      }))
    };
  }

  refundStatusText(status) {
    const normalized = this.toText(status);
    if (normalized === VIP_REFUND_STATUS_PENDING) return '待审核';
    if (normalized === VIP_REFUND_STATUS_APPROVED) return '已通过';
    if (normalized === VIP_REFUND_STATUS_REJECTED) return '已驳回';
    if (normalized === VIP_REFUND_STATUS_COMPLETED) return '已完成';
    return normalized || '-';
  }

  async listSkuPrices({page = 1, size = 10, keyword = '', planId = 0, status = ''} = {}) {
    const normalizedPage = Math.max(1, this.toInt(page, 1));
    const normalizedSize = Math.min(100, Math.max(1, this.toInt(size, 10)));
    const normalizedKeyword = this.toText(keyword);
    const normalizedPlanId = this.toInt(planId, 0);
    const normalizedStatus = this.toText(status);

    const where = ['sp.is_delete = 0'];
    if (normalizedKeyword) {
      const escaped = normalizedKeyword.replace(/'/g, "''");
      where.push(`(sp.goods_name LIKE '%${escaped}%' OR sp.sku_name LIKE '%${escaped}%')`);
    }
    if (normalizedPlanId > 0) {
      where.push(`sp.plan_id = ${normalizedPlanId}`);
    }
    if (normalizedStatus === '1' || normalizedStatus === 'enabled') {
      where.push('sp.enabled = 1');
    }
    if (normalizedStatus === '0' || normalizedStatus === 'disabled') {
      where.push('sp.enabled = 0');
    }

    const offset = (normalizedPage - 1) * normalizedSize;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT
        sp.*,
        vp.plan_name
      FROM hiolabs_vip_sku_price sp
      LEFT JOIN hiolabs_vip_plan vp ON sp.plan_id = vp.id
      ${whereSql}
      ORDER BY sp.id DESC
      LIMIT ${offset}, ${normalizedSize}
    `;
    const countSql = `SELECT COUNT(1) AS total FROM hiolabs_vip_sku_price sp LEFT JOIN hiolabs_vip_plan vp ON sp.plan_id = vp.id ${whereSql}`;

    const model = this.model('vip_sku_price');
    const rows = await model.query(listSql);
    const countRows = await model.query(countSql);
    const total = this.toInt(countRows[0] && countRows[0].total, 0);

    return {
      count: total,
      totalPages: Math.max(1, Math.ceil(total / normalizedSize)),
      pageSize: normalizedSize,
      currentPage: normalizedPage,
      data: rows || []
    };
  }

  async saveSkuPrice(payload = {}) {
    const now = this.nowTs();
    const id = this.toInt(payload.id, 0);
    const planId = this.toInt(payload.plan_id || payload.planId, 0);
    const skuId = this.toInt(payload.sku_id || payload.skuId, 0);
    if (planId <= 0) {
      throw new Error('会员方案不能为空');
    }
    if (skuId <= 0) {
      throw new Error('SKU不能为空');
    }
    const vipPrice = this.toPrice(payload.vip_price || payload.vipPrice, 0);
    const originPrice = this.toPrice(payload.origin_price || payload.original_price || payload.originPrice, 0);
    if (vipPrice <= 0) {
      throw new Error('会员价必须大于0');
    }
    if (originPrice > 0 && vipPrice > originPrice) {
      throw new Error('会员价不能高于原价');
    }

    const data = {
      plan_id: planId,
      goods_id: this.toInt(payload.goods_id || payload.goodsId, 0),
      goods_name: this.toText(payload.goods_name || payload.goodsName),
      sku_id: skuId,
      sku_name: this.toText(payload.sku_name || payload.skuName),
      origin_price: this.formatPrice(originPrice),
      vip_price: this.formatPrice(vipPrice),
      enabled: this.toInt(payload.enabled, 1) === 1 ? 1 : 0,
      remark: this.toText(payload.remark),
      update_time: now
    };

    const model = this.model('vip_sku_price');
    if (id > 0) {
      const affected = await model.where({
        id,
        is_delete: 0
      }).update(data);
      if (this.toInt(affected, 0) !== 1) {
        throw new Error('会员价记录不存在');
      }
      return {
        id
      };
    }

    const insertId = await model.add({
      ...data,
      is_delete: 0,
      add_time: now
    });
    return {
      id: this.toInt(insertId, 0)
    };
  }

  async createPlan(payload = {}) {
    const now = this.nowTs();
    const planName = this.toText(payload.plan_name || payload.name);
    const durationDays = this.toInt(payload.duration_days, 0);
    const price = this.toPrice(payload.price, 0);
    const originalPrice = this.toPrice(payload.original_price, price);
    if (!planName) {
      throw new Error('方案名称不能为空');
    }
    if (durationDays <= 0) {
      throw new Error('方案时长必须大于0');
    }
    if (price <= 0) {
      throw new Error('方案价格必须大于0');
    }

    const id = await this.model('vip_plan').add({
      plan_name: planName,
      plan_code: this.toText(payload.plan_code) || '',
      duration_days: durationDays,
      price: this.formatPrice(price),
      original_price: this.formatPrice(originalPrice),
      sort_order: this.toInt(payload.sort_order, 100),
      enabled: this.toInt(payload.enabled, 1) === 1 ? 1 : 0,
      monthly_coupon_id: this.toInt(payload.monthly_coupon_id, this.defaultMonthlyCouponId()),
      monthly_coupon_count: Math.max(0, this.toInt(payload.monthly_coupon_count, this.defaultMonthlyCouponCount())),
      monthly_coupon_valid_days: Math.max(1, this.toInt(payload.monthly_coupon_valid_days, this.defaultMonthlyCouponValidDays())),
      remark: this.toText(payload.remark),
      is_delete: 0,
      add_time: now,
      update_time: now
    });

    return {
      id: this.toInt(id, 0)
    };
  }

  async updatePlan(payload = {}) {
    const id = this.toInt(payload.id, 0);
    if (id <= 0) {
      throw new Error('方案ID不能为空');
    }
    const now = this.nowTs();
    const updatePayload = {
      plan_name: this.toText(payload.plan_name || payload.name),
      duration_days: this.toInt(payload.duration_days, 0),
      price: this.formatPrice(this.toPrice(payload.price, 0)),
      original_price: this.formatPrice(this.toPrice(payload.original_price, payload.price || 0)),
      sort_order: this.toInt(payload.sort_order, 100),
      enabled: this.toInt(payload.enabled, 0) === 1 ? 1 : 0,
      monthly_coupon_id: this.toInt(payload.monthly_coupon_id, this.defaultMonthlyCouponId()),
      monthly_coupon_count: Math.max(0, this.toInt(payload.monthly_coupon_count, this.defaultMonthlyCouponCount())),
      monthly_coupon_valid_days: Math.max(1, this.toInt(payload.monthly_coupon_valid_days, this.defaultMonthlyCouponValidDays())),
      remark: this.toText(payload.remark),
      update_time: now
    };

    if (!updatePayload.plan_name) {
      throw new Error('方案名称不能为空');
    }
    if (updatePayload.duration_days <= 0) {
      throw new Error('方案时长必须大于0');
    }
    if (this.toPrice(updatePayload.price, 0) <= 0) {
      throw new Error('方案价格必须大于0');
    }

    const affected = await this.model('vip_plan').where({
      id,
      is_delete: 0
    }).update(updatePayload);
    if (this.toInt(affected, 0) !== 1) {
      throw new Error('方案不存在');
    }
    return {
      id
    };
  }

  async togglePlan({id, enabled}) {
    const planId = this.toInt(id, 0);
    if (planId <= 0) {
      throw new Error('方案ID不能为空');
    }
    const nextEnabled = this.toInt(enabled, 0) === 1 ? 1 : 0;
    const affected = await this.model('vip_plan').where({
      id: planId,
      is_delete: 0
    }).update({
      enabled: nextEnabled,
      update_time: this.nowTs()
    });
    if (this.toInt(affected, 0) !== 1) {
      throw new Error('方案不存在');
    }
    return {
      id: planId,
      enabled: nextEnabled
    };
  }

  async signAutoRenew({userId, contractId = ''} = {}) {
    if (!this.isPapayConfigured()) {
      throw new Error('自动续费未配置，请联系管理员');
    }
    const uid = this.toInt(userId, 0);
    if (uid <= 0) {
      throw new Error('请先登录');
    }
    const now = this.nowTs();
    const vipUser = await this.model('vip_user').where({
      user_id: uid,
      is_delete: 0
    }).order('id DESC').find();
    if (think.isEmpty(vipUser)) {
      throw new Error('当前没有可签约会员');
    }
    const nextRenewAt = this.toInt(vipUser.expire_time, now + 24 * 60 * 60);
    const finalContractId = this.toText(contractId) || `VIPC${uid}${now}`;

    await this.model('vip_user').where({
      id: this.toInt(vipUser.id, 0)
    }).update({
      autorenew_status: VIP_AUTORENEW_ON,
      contract_id: finalContractId,
      next_renew_at: nextRenewAt,
      retry_count: 0,
      update_time: now
    });

    await this.logVipEvent({
      userId: uid,
      eventType: 'autorenew',
      eventAction: 'sign',
      requestId: '',
      payload: {
        contract_id: finalContractId,
        next_renew_at: nextRenewAt
      }
    });

    return {
      autorenew_status: VIP_AUTORENEW_ON,
      contract_id: finalContractId,
      next_renew_at: nextRenewAt
    };
  }

  async cancelAutoRenew({userId} = {}) {
    const uid = this.toInt(userId, 0);
    if (uid <= 0) {
      throw new Error('请先登录');
    }
    const now = this.nowTs();
    const vipUser = await this.model('vip_user').where({
      user_id: uid,
      is_delete: 0
    }).order('id DESC').find();
    if (think.isEmpty(vipUser)) {
      throw new Error('当前没有可解约会员');
    }

    await this.model('vip_user').where({
      id: this.toInt(vipUser.id, 0)
    }).update({
      autorenew_status: VIP_AUTORENEW_OFF,
      next_renew_at: 0,
      retry_count: 0,
      update_time: now
    });

    await this.logVipEvent({
      userId: uid,
      eventType: 'autorenew',
      eventAction: 'cancel',
      payload: {
        contract_id: this.toText(vipUser.contract_id)
      }
    });

    return {
      autorenew_status: VIP_AUTORENEW_OFF
    };
  }

  async handleAutoRenewNotify(payload = {}) {
    if (!this.isPapayConfigured()) {
      return {
        processed: false,
        reason: 'papay_not_configured'
      };
    }
    const orderId = this.toInt(payload.orderId || payload.order_id, 0);
    const requestId = this.toText(payload.requestId || payload.request_id);
    if (orderId <= 0) {
      return {
        processed: false,
        reason: 'missing_order_id'
      };
    }
    try {
      await this.handleOrderPaid(orderId, {
        requestId,
        payResult: payload.payResult || payload
      });
      return {
        processed: true,
        orderId
      };
    } catch (error) {
      think.logger && think.logger.error && think.logger.error(`[vip.autorenew.notify] orderId=${orderId} ${error.message || error}`);
      return {
        processed: false,
        reason: error.message || 'notify_process_failed'
      };
    }
  }

  async scanAutoRenewTasks(nowTs = this.nowTs()) {
    if (!this.isPapayConfigured()) {
      return {
        scanned: 0,
        success: 0,
        failed: 0,
        expired: 0,
        skipped: 1
      };
    }
    const now = this.toInt(nowTs, this.nowTs());
    let dueUsers = [];
    try {
      dueUsers = await this.model('vip_user').where(
        `is_delete = 0 AND status = '${VIP_USER_STATUS_ACTIVE}' AND autorenew_status = '${VIP_AUTORENEW_ON}' AND next_renew_at > 0 AND next_renew_at <= ${now}`
      ).select();
    } catch (error) {
      if (this.isMissingVipTableError(error)) {
        return {
          scanned: 0,
          success: 0,
          failed: 0,
          expired: 0
        };
      }
      throw error;
    }

    let success = 0;
    let failed = 0;
    let expired = 0;

    for (const user of dueUsers) {
      const retryCount = this.toInt(user.retry_count, 0);
      const nextRetryCount = retryCount + 1;
      const canRetry = nextRetryCount < 3;
      const graceExpireAt = now + 3 * 24 * 60 * 60;
      if (canRetry) {
        await this.model('vip_user').where({
          id: this.toInt(user.id, 0)
        }).update({
          retry_count: nextRetryCount,
          grace_expire_at: graceExpireAt,
          next_renew_at: now + 12 * 60 * 60,
          update_time: now
        });
        failed += 1;
        await this.logVipEvent({
          userId: this.toInt(user.user_id, 0),
          eventType: 'autorenew',
          eventAction: 'retry_scheduled',
          payload: {
            retry_count: nextRetryCount,
            grace_expire_at: graceExpireAt
          }
        });
      } else {
        await this.model('vip_user').where({
          id: this.toInt(user.id, 0)
        }).update({
          status: VIP_USER_STATUS_EXPIRED,
          autorenew_status: VIP_AUTORENEW_OFF,
          next_renew_at: 0,
          grace_expire_at: graceExpireAt,
          retry_count: nextRetryCount,
          update_time: now
        });
        expired += 1;
        await this.logVipEvent({
          userId: this.toInt(user.user_id, 0),
          eventType: 'autorenew',
          eventAction: 'expired_after_retry',
          payload: {
            retry_count: nextRetryCount,
            grace_expire_at: graceExpireAt
          }
        });
      }
    }

    return {
      scanned: dueUsers.length,
      success,
      failed,
      expired
    };
  }
};
