const moment = require('moment');

const USER_COUPON_STATUS = {
  UNUSED: 'unused',
  LOCKED: 'locked',
  USED: 'used',
  EXPIRED: 'expired'
};

const COUPON_TYPE = {
  FULL_REDUCTION: 'full_reduction',
  DISCOUNT: 'discount'
};

module.exports = class extends think.Service {
  isMissingCouponTableError(err) {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const message = String(err.message || err.errmsg || '');
    if (code === 'ER_NO_SUCH_TABLE') return true;
    return /doesn't exist/i.test(message) && /hiolabs_(coupon|user_coupon|coupon_goods|order_coupon)/i.test(message);
  }

  trimPriceText(value) {
    return String(value || '0.00')
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  formatPromotionTag(coupon) {
    const type = String(coupon.type || COUPON_TYPE.FULL_REDUCTION);
    if (type === COUPON_TYPE.DISCOUNT) {
      const rate = Number(coupon.discount_rate || 0);
      if (rate > 0 && rate < 10) {
        return `${this.trimPriceText(rate.toFixed(2))}折`;
      }
      return '折扣券';
    }
    const threshold = Number(coupon.threshold_amount || 0);
    const reduceAmount = Number(coupon.reduce_amount || 0);
    if (threshold > 0 && reduceAmount > 0) {
      return `满${this.trimPriceText(threshold.toFixed(2))}减${this.trimPriceText(reduceAmount.toFixed(2))}`;
    }
    return '满减券';
  }

  now() {
    return parseInt(Date.now() / 1000, 10);
  }

  toCents(value) {
    const num = Number(value || 0);
    if (Number.isNaN(num)) return 0;
    return Math.round(num * 100);
  }

  fromCents(value) {
    const num = Number(value || 0);
    return (num / 100).toFixed(2);
  }

  normalizeIdList(value) {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map(item => Number(item)).filter(item => item > 0)));
    }
    if (value === undefined || value === null || value === '') {
      return [];
    }
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw) return [];
      let parsed = null;
      if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          parsed = null;
        }
      }
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map(item => Number(item)).filter(item => item > 0)));
      }
      return Array.from(new Set(raw.split(',').map(item => Number(String(item).trim())).filter(item => item > 0)));
    }
    const one = Number(value);
    return one > 0 ? [one] : [];
  }

  parseSegmentRules(raw) {
    const fallback = {
      groups: ['new_customer', 'old_customer'],
      match: 'OR'
    };
    if (!raw) return fallback;
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const groups = Array.isArray(data.groups) ? data.groups.filter(Boolean) : [];
      if (!groups.length) return fallback;
      const match = String(data.match || 'OR').toUpperCase() === 'AND' ? 'AND' : 'OR';
      return {
        groups,
        match
      };
    } catch (err) {
      return fallback;
    }
  }

  async getUserSegmentKeys(userId, model) {
    const queryModel = model || this.model('order');
    const rows = await queryModel.where({
      user_id: Number(userId),
      pay_status: 2,
      is_delete: 0
    }).count();
    if (Number(rows) > 0) {
      return ['old_customer'];
    }
    return ['new_customer'];
  }

  matchSegments(userSegments, rule) {
    const segmentSet = new Set(userSegments || []);
    const groups = Array.isArray(rule.groups) ? rule.groups : [];
    if (!groups.length) return true;
    if (rule.match === 'AND') {
      return groups.every(item => segmentSet.has(item));
    }
    return groups.some(item => segmentSet.has(item));
  }

  async getScopeGoodsMap(couponIds, model) {
    const ids = this.normalizeIdList(couponIds);
    const map = new Map();
    ids.forEach(id => map.set(Number(id), new Set()));
    if (!ids.length) return map;

    const queryModel = model || this.model('coupon_goods');
    const rows = await queryModel.where({
      coupon_id: ['IN', ids]
    }).select();
    rows.forEach((row) => {
      const couponId = Number(row.coupon_id);
      const goodsId = Number(row.goods_id);
      if (!map.has(couponId)) {
        map.set(couponId, new Set());
      }
      if (goodsId > 0) {
        map.get(couponId).add(goodsId);
      }
    });
    return map;
  }

  buildGoodsAmountMaps(cartItems) {
    const originalMap = new Map();
    let goodsTotalCents = 0;
    (cartItems || []).forEach((item) => {
      const goodsId = Number(item.goods_id || item.goodsId || 0);
      const priceCents = this.toCents(item.retail_price || item.retailPrice || 0);
      const number = Number(item.number || 0);
      if (goodsId <= 0 || number <= 0 || priceCents <= 0) return;
      const subtotal = priceCents * number;
      goodsTotalCents += subtotal;
      originalMap.set(goodsId, (originalMap.get(goodsId) || 0) + subtotal);
    });
    return {
      originalMap,
      goodsTotalCents
    };
  }

  getApplicableGoodsIds(coupon, originalMap, scopeGoodsSet) {
    const scopeType = String(coupon.scope_type || 'all');
    if (scopeType === 'all') {
      return Array.from(originalMap.keys());
    }
    return Array.from(scopeGoodsSet || []).filter(goodsId => originalMap.has(goodsId));
  }

  sumByGoodsIds(amountMap, goodsIds) {
    return goodsIds.reduce((acc, goodsId) => acc + Number(amountMap.get(goodsId) || 0), 0);
  }

  distributeDeduction(remainingMap, goodsIds, discountCents) {
    let remain = discountCents;
    const baseTotal = this.sumByGoodsIds(remainingMap, goodsIds);
    if (baseTotal <= 0 || discountCents <= 0) {
      return;
    }
    for (let i = 0; i < goodsIds.length; i++) {
      const goodsId = goodsIds[i];
      const base = Number(remainingMap.get(goodsId) || 0);
      if (base <= 0) continue;
      let deduct = 0;
      if (i === goodsIds.length - 1) {
        deduct = remain;
      } else {
        deduct = Math.min(remain, Math.floor((discountCents * base) / baseTotal));
      }
      const next = Math.max(0, base - deduct);
      remainingMap.set(goodsId, next);
      remain -= deduct;
      if (remain <= 0) break;
    }
  }

  computeCouponDiscount(coupon, originalMap, remainingMap, scopeGoodsSet) {
    const nowTs = this.now();
    if (Number(coupon.use_start_at || 0) > nowTs || Number(coupon.use_end_at || 0) < nowTs) {
      return {ok: false, reason: '优惠券不在可用时间内'};
    }
    if (String(coupon.status || 'enabled') !== 'enabled') {
      return {ok: false, reason: '优惠券当前不可用'};
    }

    const goodsIds = this.getApplicableGoodsIds(coupon, originalMap, scopeGoodsSet);
    if (!goodsIds.length) {
      return {ok: false, reason: '优惠券不适用于当前商品'};
    }

    const thresholdCents = this.toCents(coupon.threshold_amount || 0);
    const originalApplicable = this.sumByGoodsIds(originalMap, goodsIds);
    if (originalApplicable < thresholdCents) {
      return {ok: false, reason: '未满足使用门槛'};
    }

    const remainingApplicable = this.sumByGoodsIds(remainingMap, goodsIds);
    if (remainingApplicable <= 0) {
      return {ok: false, reason: '优惠金额为0'};
    }

    let discountCents = 0;
    const type = String(coupon.type || COUPON_TYPE.FULL_REDUCTION);
    if (type === COUPON_TYPE.FULL_REDUCTION) {
      discountCents = Math.min(this.toCents(coupon.reduce_amount || 0), remainingApplicable);
    } else if (type === COUPON_TYPE.DISCOUNT) {
      const discountRate = Number(coupon.discount_rate || 10);
      const payRate = Math.min(10, Math.max(0, discountRate)) / 10;
      discountCents = Math.round(remainingApplicable * (1 - payRate));
      const maxReduce = this.toCents(coupon.discount_max_reduce || 0);
      if (maxReduce > 0) {
        discountCents = Math.min(discountCents, maxReduce);
      }
      discountCents = Math.min(discountCents, remainingApplicable);
    } else {
      return {ok: false, reason: '未知优惠券类型'};
    }

    if (discountCents <= 0) {
      return {ok: false, reason: '优惠金额为0'};
    }

    this.distributeDeduction(remainingMap, goodsIds, discountCents);
    return {
      ok: true,
      discountCents,
      goodsIds
    };
  }

  async listUsableUserCoupons(userId, model) {
    const queryModel = model || this.model('user_coupon');
    const nowTs = this.now();
    const sql = `
      SELECT
        uc.id AS user_coupon_id,
        uc.user_id,
        uc.status AS user_coupon_status,
        uc.expire_time,
        c.id AS coupon_id,
        c.coupon_key,
        c.name,
        c.type,
        c.threshold_amount,
        c.reduce_amount,
        c.discount_rate,
        c.discount_max_reduce,
        c.scope_type,
        c.segment_rules_json,
        c.use_start_at,
        c.use_end_at,
        c.status
      FROM hiolabs_user_coupon uc
      INNER JOIN hiolabs_coupon c ON uc.coupon_id = c.id
      WHERE uc.is_delete = 0
        AND uc.user_id = ${Number(userId)}
        AND uc.status = '${USER_COUPON_STATUS.UNUSED}'
        AND c.is_delete = 0
        AND c.status = 'enabled'
        AND c.use_start_at <= ${nowTs}
        AND c.use_end_at >= ${nowTs}
      ORDER BY uc.id DESC
    `;
    return queryModel.query(sql);
  }

  async calculateDiscount(userId, cartItems, selectedUserCouponIds, model) {
    const selectedIds = this.normalizeIdList(selectedUserCouponIds);
    const {originalMap, goodsTotalCents} = this.buildGoodsAmountMaps(cartItems);
    if (!goodsTotalCents) {
      return {
        goodsTotalCents: 0,
        couponPriceCents: 0,
        selectedCoupons: [],
        couponCandidates: [],
        invalidSelectedIds: selectedIds
      };
    }

    let coupons = [];
    let scopeGoodsMap = new Map();
    try {
      coupons = await this.listUsableUserCoupons(userId, model);
      const couponIds = coupons.map(item => Number(item.coupon_id));
      scopeGoodsMap = await this.getScopeGoodsMap(couponIds, model);
    } catch (err) {
      if (this.isMissingCouponTableError(err)) {
        return {
          goodsTotalCents,
          couponPriceCents: 0,
          selectedCoupons: [],
          couponCandidates: [],
          invalidSelectedIds: selectedIds
        };
      }
      throw err;
    }

    const couponCandidates = [];
    coupons.forEach((item) => {
      const copyRemaining = new Map(originalMap);
      const result = this.computeCouponDiscount(item, originalMap, copyRemaining, scopeGoodsMap.get(Number(item.coupon_id)));
      couponCandidates.push({
        user_coupon_id: Number(item.user_coupon_id),
        coupon_id: Number(item.coupon_id),
        coupon_name: item.name,
        coupon_type: item.type,
        threshold_amount: Number(item.threshold_amount || 0),
        reduce_amount: Number(item.reduce_amount || 0),
        discount_rate: Number(item.discount_rate || 0),
        discount_max_reduce: Number(item.discount_max_reduce || 0),
        estimated_discount: result.ok ? this.fromCents(result.discountCents) : '0.00',
        disabled_reason: result.ok ? '' : result.reason
      });
    });

    if (!selectedIds.length) {
      return {
        goodsTotalCents,
        couponPriceCents: 0,
        selectedCoupons: [],
        couponCandidates,
        invalidSelectedIds: []
      };
    }

    const couponByUserCouponId = new Map(coupons.map(item => [Number(item.user_coupon_id), item]));
    const invalidSelectedIds = [];
    const selectedCouponRows = [];
    selectedIds.forEach((id) => {
      const row = couponByUserCouponId.get(Number(id));
      if (!row) {
        invalidSelectedIds.push(Number(id));
      } else {
        selectedCouponRows.push(row);
      }
    });

    const typeCounter = {};
    selectedCouponRows.forEach((item) => {
      const type = String(item.type || COUPON_TYPE.FULL_REDUCTION);
      typeCounter[type] = (typeCounter[type] || 0) + 1;
    });
    Object.keys(typeCounter).forEach((type) => {
      if (typeCounter[type] > 1) {
        selectedCouponRows
          .filter(item => String(item.type || COUPON_TYPE.FULL_REDUCTION) === type)
          .forEach(item => invalidSelectedIds.push(Number(item.user_coupon_id)));
      }
    });

    const validSelectedRows = selectedCouponRows.filter(item => !invalidSelectedIds.includes(Number(item.user_coupon_id)));
    validSelectedRows.sort((a, b) => {
      const order = (row) => (String(row.type) === COUPON_TYPE.FULL_REDUCTION ? 1 : 2);
      return order(a) - order(b);
    });

    const remainingMap = new Map(originalMap);
    const selectedCoupons = [];
    let couponPriceCents = 0;
    validSelectedRows.forEach((item) => {
      const result = this.computeCouponDiscount(item, originalMap, remainingMap, scopeGoodsMap.get(Number(item.coupon_id)));
      if (!result.ok) {
        invalidSelectedIds.push(Number(item.user_coupon_id));
        return;
      }
      couponPriceCents += result.discountCents;
      selectedCoupons.push({
        user_coupon_id: Number(item.user_coupon_id),
        coupon_id: Number(item.coupon_id),
        coupon_name: item.name,
        coupon_type: item.type,
        discount_amount: this.fromCents(result.discountCents)
      });
    });

    return {
      goodsTotalCents,
      couponPriceCents: Math.min(couponPriceCents, goodsTotalCents),
      selectedCoupons,
      couponCandidates,
      invalidSelectedIds: Array.from(new Set(invalidSelectedIds))
    };
  }

  async previewCartCoupons({userId, cartItems, selectedUserCouponIds, freightPrice = 0, model}) {
    const result = await this.calculateDiscount(userId, cartItems, selectedUserCouponIds, model);
    const freightCents = this.toCents(freightPrice || 0);
    const orderTotalCents = result.goodsTotalCents + freightCents;
    const actualPriceCents = Math.max(0, orderTotalCents - result.couponPriceCents);
    return {
      goodsTotalPrice: this.fromCents(result.goodsTotalCents),
      couponPrice: this.fromCents(result.couponPriceCents),
      orderTotalPrice: this.fromCents(orderTotalCents),
      actualPrice: this.fromCents(actualPriceCents),
      couponCandidates: result.couponCandidates,
      selectedCoupons: result.selectedCoupons,
      invalidSelectedIds: result.invalidSelectedIds
    };
  }

  async listCenterCoupons(userId) {
    const nowTs = this.now();
    const couponModel = this.model('coupon');
    const orderModel = this.model('order');
    let allRows = [];
    try {
      allRows = await couponModel.where({
        is_delete: 0,
        status: 'enabled',
        claim_start_at: ['<=', nowTs],
        claim_end_at: ['>=', nowTs]
      }).order('id DESC').select();
    } catch (err) {
      if (this.isMissingCouponTableError(err)) {
        return [];
      }
      throw err;
    }
    if (!allRows.length) return [];

    const segmentKeys = await this.getUserSegmentKeys(userId, orderModel);
    const filtered = allRows.filter((row) => {
      const rule = this.parseSegmentRules(row.segment_rules_json);
      if (!this.matchSegments(segmentKeys, rule)) return false;
      const totalLimit = Number(row.total_limit || 0);
      const receivedCount = Number(row.received_count || 0);
      if (totalLimit > 0 && receivedCount >= totalLimit) return false;
      return true;
    });
    if (!filtered.length) return [];

    const couponIds = filtered.map(item => Number(item.id));
    const userCoupons = await this.model('user_coupon').where({
      user_id: Number(userId),
      coupon_id: ['IN', couponIds],
      is_delete: 0
    }).select();
    const ownedSet = new Set(userCoupons.map(item => Number(item.coupon_id)));

    return filtered.map(item => ({
      id: Number(item.id),
      coupon_key: item.coupon_key,
      name: item.name,
      type: item.type,
      threshold_amount: Number(item.threshold_amount || 0),
      reduce_amount: Number(item.reduce_amount || 0),
      discount_rate: Number(item.discount_rate || 0),
      discount_max_reduce: Number(item.discount_max_reduce || 0),
      claim_start_at: Number(item.claim_start_at || 0),
      claim_end_at: Number(item.claim_end_at || 0),
      use_start_at: Number(item.use_start_at || 0),
      use_end_at: Number(item.use_end_at || 0),
      total_limit: Number(item.total_limit || 0),
      received_count: Number(item.received_count || 0),
      has_received: ownedSet.has(Number(item.id))
    }));
  }

  async receiveCoupon(userId, couponId) {
    const uid = Number(userId);
    const cid = Number(couponId);
    if (uid <= 0 || cid <= 0) {
      throw new Error('参数错误');
    }
    const nowTs = this.now();
    const txModel = this.model('coupon');
    let receiveResult = null;

    await txModel.transaction(async () => {
      const bindModel = (name) => {
        const model = txModel.model(name);
        model.db(txModel.db());
        return model;
      };
      const couponModel = bindModel('coupon');
      const userCouponModel = bindModel('user_coupon');
      const orderModel = bindModel('order');

      const coupon = await couponModel.where({
        id: cid,
        is_delete: 0
      }).find();
      if (think.isEmpty(coupon)) {
        throw new Error('优惠券不存在');
      }
      if (String(coupon.status) !== 'enabled') {
        throw new Error('优惠券未启用');
      }
      if (Number(coupon.claim_start_at || 0) > nowTs || Number(coupon.claim_end_at || 0) < nowTs) {
        throw new Error('不在领取时间内');
      }

      const rule = this.parseSegmentRules(coupon.segment_rules_json);
      const segmentKeys = await this.getUserSegmentKeys(uid, orderModel);
      if (!this.matchSegments(segmentKeys, rule)) {
        throw new Error('当前用户不满足领取条件');
      }

      const existed = await userCouponModel.where({
        user_id: uid,
        coupon_id: cid,
        is_delete: 0
      }).find();
      if (!think.isEmpty(existed)) {
        throw new Error('该优惠券已领取');
      }

      let incQuery = couponModel.where({
        id: cid,
        is_delete: 0,
        status: 'enabled',
        claim_start_at: ['<=', nowTs],
        claim_end_at: ['>=', nowTs]
      });
      const totalLimit = Number(coupon.total_limit || 0);
      if (totalLimit > 0) {
        incQuery = incQuery.where(`received_count < ${totalLimit}`);
      }
      const affectedRows = await incQuery.increment('received_count', 1);
      if (Number(affectedRows) !== 1) {
        throw new Error('优惠券已领完');
      }

      const userCouponId = await userCouponModel.add({
        coupon_id: cid,
        user_id: uid,
        status: USER_COUPON_STATUS.UNUSED,
        claim_time: nowTs,
        lock_time: 0,
        used_time: 0,
        expire_time: Number(coupon.use_end_at || 0),
        lock_order_id: 0,
        used_order_id: 0,
        discount_amount: '0.00',
        is_delete: 0
      });

      receiveResult = {
        userCouponId: Number(userCouponId),
        couponId: cid
      };
    });

    return receiveResult;
  }

  async listMyCoupons(userId, status) {
    const uid = Number(userId);
    if (uid <= 0) return [];
    const safeStatus = String(status || '').trim();
    const where = [`uc.user_id = ${uid}`, 'uc.is_delete = 0', 'c.is_delete = 0'];
    if (safeStatus && ['unused', 'used', 'expired', 'locked'].includes(safeStatus)) {
      where.push(`uc.status = '${safeStatus}'`);
    }
    const sql = `
      SELECT
        uc.id AS user_coupon_id,
        uc.status,
        uc.claim_time,
        uc.lock_time,
        uc.used_time,
        uc.expire_time,
        uc.discount_amount,
        c.id AS coupon_id,
        c.name,
        c.type,
        c.threshold_amount,
        c.reduce_amount,
        c.discount_rate,
        c.discount_max_reduce,
        c.use_start_at,
        c.use_end_at
      FROM hiolabs_user_coupon uc
      INNER JOIN hiolabs_coupon c ON uc.coupon_id = c.id
      WHERE ${where.join(' AND ')}
      ORDER BY uc.id DESC
    `;
    try {
      return await this.model('user_coupon').query(sql);
    } catch (err) {
      if (this.isMissingCouponTableError(err)) {
        return [];
      }
      throw err;
    }
  }

  async decorateGoodsWithCouponPromo(userId, goodsList, model) {
    const uid = Number(userId || 0);
    const list = Array.isArray(goodsList) ? goodsList : [];
    const normalizedList = list.map((item) => {
      const minRetailPrice = Number(item.min_retail_price || item.retail_price || 0);
      const formattedPrice = this.trimPriceText(minRetailPrice.toFixed(2));
      return Object.assign({}, item, {
        has_coupon_promo: 0,
        promo_price: formattedPrice,
        original_price: formattedPrice,
        promo_tag: ''
      });
    });

    if (!normalizedList.length || uid <= 0) {
      return normalizedList;
    }

    let coupons = [];
    let scopeGoodsMap = new Map();
    try {
      coupons = await this.listUsableUserCoupons(uid, model);
      if (!coupons.length) {
        return normalizedList;
      }
      const couponIds = coupons.map(item => Number(item.coupon_id));
      scopeGoodsMap = await this.getScopeGoodsMap(couponIds, model);
    } catch (err) {
      if (this.isMissingCouponTableError(err)) {
        return normalizedList;
      }
      throw err;
    }

    return normalizedList.map((item) => {
      const goodsId = Number(item.id || item.goods_id || 0);
      const priceCents = this.toCents(item.min_retail_price || item.retail_price || 0);
      if (goodsId <= 0 || priceCents <= 0) {
        return item;
      }

      const originalMap = new Map([[goodsId, priceCents]]);
      let bestDiscountCents = 0;
      let bestCoupon = null;
      coupons.forEach((coupon) => {
        const remainingMap = new Map(originalMap);
        const result = this.computeCouponDiscount(coupon, originalMap, remainingMap, scopeGoodsMap.get(Number(coupon.coupon_id)));
        if (result.ok && Number(result.discountCents || 0) > bestDiscountCents) {
          bestDiscountCents = Number(result.discountCents || 0);
          bestCoupon = coupon;
        }
      });

      if (!bestCoupon || bestDiscountCents <= 0) {
        return item;
      }

      const promoPriceCents = Math.max(0, priceCents - bestDiscountCents);
      if (promoPriceCents >= priceCents) {
        return item;
      }

      const promoPrice = this.trimPriceText(this.fromCents(promoPriceCents));
      const originalPrice = this.trimPriceText(this.fromCents(priceCents));
      return Object.assign({}, item, {
        has_coupon_promo: 1,
        promo_price: promoPrice,
        original_price: originalPrice,
        promo_tag: this.formatPromotionTag(bestCoupon)
      });
    });
  }

  async lockOrConsumeCouponsForOrder({
    userId,
    orderId,
    selectedCoupons,
    consumeDirect = false,
    transactionModel
  }) {
    if (!Array.isArray(selectedCoupons) || !selectedCoupons.length) {
      return {count: 0};
    }
    const nowTs = this.now();
    const baseModel = transactionModel || this.model('coupon');
    const bindModel = (name) => {
      const model = baseModel.model ? baseModel.model(name) : this.model(name);
      if (baseModel.db && model.db) {
        model.db(baseModel.db());
      }
      return model;
    };
    const userCouponModel = bindModel('user_coupon');
    const orderCouponModel = bindModel('order_coupon');
    const couponModel = bindModel('coupon');

    const usedCounter = {};
    for (const item of selectedCoupons) {
      const userCouponId = Number(item.user_coupon_id || 0);
      const couponId = Number(item.coupon_id || 0);
      const discountAmount = Number(item.discount_amount || 0).toFixed(2);
      if (userCouponId <= 0 || couponId <= 0) {
        throw new Error('优惠券参数无效');
      }

      let updateData = {};
      let where = {
        id: userCouponId,
        user_id: Number(userId),
        is_delete: 0
      };
      if (consumeDirect) {
        where.status = USER_COUPON_STATUS.UNUSED;
        updateData = {
          status: USER_COUPON_STATUS.USED,
          used_time: nowTs,
          used_order_id: Number(orderId),
          discount_amount: discountAmount
        };
      } else {
        where.status = USER_COUPON_STATUS.UNUSED;
        updateData = {
          status: USER_COUPON_STATUS.LOCKED,
          lock_time: nowTs,
          lock_order_id: Number(orderId),
          discount_amount: discountAmount
        };
      }
      const affected = await userCouponModel.where(where).update(updateData);
      if (Number(affected) !== 1) {
        throw new Error('优惠券状态已变化，请重新提交订单');
      }

      await orderCouponModel.add({
        order_id: Number(orderId),
        user_coupon_id: userCouponId,
        coupon_id: couponId,
        coupon_type: String(item.coupon_type || ''),
        coupon_name_snapshot: String(item.coupon_name || ''),
        discount_amount: discountAmount,
        add_time: nowTs
      });
      if (consumeDirect) {
        usedCounter[couponId] = (usedCounter[couponId] || 0) + 1;
      }
    }

    const couponIds = Object.keys(usedCounter).map(id => Number(id)).filter(id => id > 0);
    for (const couponId of couponIds) {
      await couponModel.where({id: couponId, is_delete: 0}).increment('used_count', usedCounter[couponId]);
    }

    return {count: selectedCoupons.length};
  }

  async consumeCouponsForOrder(orderId, transactionModel) {
    const oid = Number(orderId);
    if (oid <= 0) return {count: 0};
    const nowTs = this.now();
    const baseModel = transactionModel || this.model('coupon');
    const bindModel = (name) => {
      const model = baseModel.model ? baseModel.model(name) : this.model(name);
      if (baseModel.db && model.db) {
        model.db(baseModel.db());
      }
      return model;
    };
    const userCouponModel = bindModel('user_coupon');
    const couponModel = bindModel('coupon');

    const lockedRows = await userCouponModel.where({
      lock_order_id: oid,
      status: USER_COUPON_STATUS.LOCKED,
      is_delete: 0
    }).select();
    if (!lockedRows.length) {
      return {count: 0};
    }

    const usedCounter = {};
    for (const row of lockedRows) {
      const affected = await userCouponModel.where({
        id: Number(row.id),
        status: USER_COUPON_STATUS.LOCKED,
        is_delete: 0
      }).update({
        status: USER_COUPON_STATUS.USED,
        used_time: nowTs,
        used_order_id: oid
      });
      if (Number(affected) === 1) {
        const couponId = Number(row.coupon_id || 0);
        if (couponId > 0) {
          usedCounter[couponId] = (usedCounter[couponId] || 0) + 1;
        }
      }
    }

    const couponIds = Object.keys(usedCounter).map(id => Number(id)).filter(id => id > 0);
    for (const couponId of couponIds) {
      await couponModel.where({id: couponId, is_delete: 0}).increment('used_count', usedCounter[couponId]);
    }
    return {count: lockedRows.length};
  }

  async releaseLockedCoupons(orderId, transactionModel) {
    const oid = Number(orderId);
    if (oid <= 0) return {count: 0};
    const baseModel = transactionModel || this.model('coupon');
    const bindModel = (name) => {
      const model = baseModel.model ? baseModel.model(name) : this.model(name);
      if (baseModel.db && model.db) {
        model.db(baseModel.db());
      }
      return model;
    };
    const userCouponModel = bindModel('user_coupon');
    const affected = await userCouponModel.where({
      lock_order_id: oid,
      status: USER_COUPON_STATUS.LOCKED,
      is_delete: 0
    }).update({
      status: USER_COUPON_STATUS.UNUSED,
      lock_order_id: 0,
      lock_time: 0,
      discount_amount: '0.00'
    });
    return {count: Number(affected || 0)};
  }

  async expireCouponsBatch() {
    const nowTs = this.now();
    const affected = await this.model('user_coupon').where({
      status: USER_COUPON_STATUS.UNUSED,
      expire_time: ['<', nowTs],
      is_delete: 0
    }).update({
      status: USER_COUPON_STATUS.EXPIRED
    });
    return Number(affected || 0);
  }

  buildCouponKey() {
    return `CP${moment().format('YYYYMMDDHHmmss')}${Math.floor(Math.random() * 9000 + 1000)}`;
  }
};
