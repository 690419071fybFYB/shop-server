const PROMOTION_TYPE = {
  SECKILL: 'seckill',
  TIMED_DISCOUNT: 'timed_discount',
  TIMED_FULL_REDUCTION: 'timed_full_reduction'
};

module.exports = class extends think.Service {
  now() {
    return parseInt(Date.now() / 1000, 10);
  }

  isPromotionEnabled() {
    const features = think.config('features') || {};
    const rawValue = features.promotionV1;
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return true;
    }
    if (typeof rawValue === 'boolean') {
      return rawValue;
    }
    const flag = String(rawValue).toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(flag);
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

  trimPriceText(value) {
    return String(value || '0.00').replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  normalizeIdList(value) {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map(item => Number(item)).filter(item => item > 0)));
    }
    if (value === undefined || value === null || value === '') {
      return [];
    }
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return [];
      return Array.from(new Set(text.split(',').map(item => Number(String(item).trim())).filter(item => item > 0)));
    }
    const one = Number(value);
    return one > 0 ? [one] : [];
  }

  choosePromoTag(type, row) {
    if (type === PROMOTION_TYPE.SECKILL) {
      return '秒杀价';
    }
    if (type === PROMOTION_TYPE.TIMED_DISCOUNT) {
      const rate = Number(row && row.discount_rate || 0);
      return rate > 0 ? `${this.trimPriceText(rate.toFixed(2))}折限时` : '限时折扣';
    }
    return '限时满减';
  }

  getModel(model, name) {
    if (model && typeof model.model === 'function') {
      const child = model.model(name);
      if (typeof model.db === 'function' && typeof child.db === 'function') {
        child.db(model.db());
      }
      return child;
    }
    return this.model(name);
  }

  async listActivePromotions(nowTs = this.now(), model = null) {
    if (!this.isPromotionEnabled()) {
      return [];
    }
    const promotionModel = this.getModel(model, 'promotion');
    return promotionModel.where({
      is_delete: 0,
      status: 'enabled',
      start_at: ['<=', nowTs],
      end_at: ['>=', nowTs]
    }).order('id DESC').select();
  }

  async listActiveSkuPromotions({ nowTs = this.now(), goodsIds = [], productIds = [], model = null } = {}) {
    if (!this.isPromotionEnabled()) {
      return [];
    }
    const idsByGoods = this.normalizeIdList(goodsIds);
    const idsByProduct = this.normalizeIdList(productIds);
    const filters = ['p.is_delete = 0', `p.status = 'enabled'`, `p.start_at <= ${Number(nowTs)}`, `p.end_at >= ${Number(nowTs)}`];
    if (idsByGoods.length) {
      filters.push(`ps.goods_id IN (${idsByGoods.join(',')})`);
    }
    if (idsByProduct.length) {
      filters.push(`ps.product_id IN (${idsByProduct.join(',')})`);
    }
    const whereSql = filters.join(' AND ');
    const sql = `
      SELECT
        p.id AS promotion_id,
        p.name AS promotion_name,
        p.type AS promotion_type,
        p.start_at,
        p.end_at,
        ps.id AS promotion_sku_id,
        ps.goods_id,
        ps.product_id,
        ps.seckill_price,
        ps.discount_rate,
        ps.seckill_stock,
        ps.locked_stock,
        ps.sold_stock,
        ps.per_user_limit,
        pr.retail_price AS product_retail_price
      FROM hiolabs_promotion_sku ps
      INNER JOIN hiolabs_promotion p ON ps.promotion_id = p.id
      LEFT JOIN hiolabs_product pr ON ps.product_id = pr.id
      WHERE ${whereSql}
      ORDER BY p.start_at ASC, p.id DESC, ps.id DESC
    `;
    const skuModel = this.getModel(model, 'promotion_sku');
    return skuModel.query(sql);
  }

  async listActiveFullReductionPromotions(nowTs = this.now(), model = null) {
    if (!this.isPromotionEnabled()) {
      return [];
    }
    const promotionModel = this.getModel(model, 'promotion');
    return promotionModel.where({
      is_delete: 0,
      status: 'enabled',
      type: PROMOTION_TYPE.TIMED_FULL_REDUCTION,
      start_at: ['<=', nowTs],
      end_at: ['>=', nowTs]
    }).order('start_at ASC, id DESC').select();
  }

  async getFullReductionGoodsMap(promotionIds, model = null) {
    if (!this.isPromotionEnabled()) {
      return new Map();
    }
    const ids = this.normalizeIdList(promotionIds);
    const result = new Map();
    ids.forEach((id) => {
      result.set(Number(id), new Set());
    });
    if (!ids.length) return result;
    const promotionGoodsModel = this.getModel(model, 'promotion_goods');
    const rows = await promotionGoodsModel.where({
      promotion_id: ['IN', ids]
    }).select();
    rows.forEach((item) => {
      const promotionId = Number(item.promotion_id);
      if (!result.has(promotionId)) {
        result.set(promotionId, new Set());
      }
      result.get(promotionId).add(Number(item.goods_id || 0));
    });
    return result;
  }

  async getFullReductionTierMap(promotionIds, model = null) {
    if (!this.isPromotionEnabled()) {
      return new Map();
    }
    const ids = this.normalizeIdList(promotionIds);
    const result = new Map();
    ids.forEach((id) => {
      result.set(Number(id), []);
    });
    if (!ids.length) return result;
    const tierModel = this.getModel(model, 'promotion_tier');
    const rows = await tierModel.where({
      promotion_id: ['IN', ids]
    }).order('promotion_id ASC, threshold_amount ASC, sort_order ASC, id ASC').select();
    rows.forEach((item) => {
      const promotionId = Number(item.promotion_id);
      if (!result.has(promotionId)) {
        result.set(promotionId, []);
      }
      result.get(promotionId).push({
        thresholdCents: this.toCents(item.threshold_amount || 0),
        reduceCents: this.toCents(item.reduce_amount || 0),
        threshold_amount: Number(item.threshold_amount || 0),
        reduce_amount: Number(item.reduce_amount || 0)
      });
    });
    return result;
  }

  chooseBestSkuRow(rows, baseUnitCents = 0) {
    const sorted = Array.isArray(rows) ? rows : [];
    if (!sorted.length) {
      return {
        applied: false,
        type: '',
        row: null,
        promoUnitCents: baseUnitCents
      };
    }

    const seckillRows = sorted.filter((item) => {
      const stock = Number(item.seckill_stock || 0) - Number(item.locked_stock || 0) - Number(item.sold_stock || 0);
      return String(item.promotion_type) === PROMOTION_TYPE.SECKILL && stock > 0 && this.toCents(item.seckill_price || 0) > 0;
    });

    if (seckillRows.length) {
      let best = seckillRows[0];
      let bestPrice = this.toCents(best.seckill_price || 0);
      seckillRows.forEach((item) => {
        const price = this.toCents(item.seckill_price || 0);
        if (price > 0 && price < bestPrice) {
          best = item;
          bestPrice = price;
        }
      });
      return {
        applied: true,
        type: PROMOTION_TYPE.SECKILL,
        row: best,
        promoUnitCents: bestPrice
      };
    }

    const discountRows = sorted.filter((item) => String(item.promotion_type) === PROMOTION_TYPE.TIMED_DISCOUNT && Number(item.discount_rate || 0) > 0);
    if (discountRows.length) {
      let best = null;
      let bestPrice = 0;
      discountRows.forEach((item) => {
        const rate = Math.max(0, Math.min(10, Number(item.discount_rate || 10)));
        const price = Math.round(baseUnitCents * rate / 10);
        if (!best || price < bestPrice) {
          best = item;
          bestPrice = price;
        }
      });
      if (best && bestPrice < baseUnitCents) {
        return {
          applied: true,
          type: PROMOTION_TYPE.TIMED_DISCOUNT,
          row: best,
          promoUnitCents: bestPrice
        };
      }
    }

    return {
      applied: false,
      type: '',
      row: null,
      promoUnitCents: baseUnitCents
    };
  }

  normalizePromoDisplayFields(item, fallbackOriginalCents) {
    const promotionEndAt = Number(item.promo_end_at || 0);
    const nowTs = this.now();
    const countdown = promotionEndAt > nowTs ? promotionEndAt - nowTs : 0;
    const originalCents = this.toCents(item.original_price || this.fromCents(fallbackOriginalCents || 0));
    const promoCents = this.toCents(item.promo_price || this.fromCents(originalCents));
    const hasPriceDrop = promoCents < originalCents;
    return Object.assign({}, item, {
      has_promo: Number(item.has_promo || 0),
      promo_source: item.promo_source || 'none',
      promo_type: item.promo_type || '',
      promo_price: this.trimPriceText(item.promo_price || this.fromCents(originalCents)),
      original_price: this.trimPriceText(item.original_price || this.fromCents(originalCents)),
      promo_tag: item.promo_tag || '',
      promo_end_at: promotionEndAt,
      promo_countdown_seconds: countdown,
      promo_stock_percent: Number(item.promo_stock_percent || 0),
      // backward compatibility for old mini templates
      has_coupon_promo: hasPriceDrop ? 1 : 0
    });
  }

  async decorateGoodsWithPromotion(userId, goodsList, model = null) {
    const list = Array.isArray(goodsList) ? goodsList : [];
    if (!list.length) return [];

    const goodsIds = this.normalizeIdList(list.map(item => Number(item.id || item.goods_id || 0)));
    const nowTs = this.now();
    let skuRows = [];
    let fullReductionPromotions = [];
    if (this.isPromotionEnabled()) {
      [skuRows, fullReductionPromotions] = await Promise.all([
        this.listActiveSkuPromotions({ nowTs, goodsIds, model }),
        this.listActiveFullReductionPromotions(nowTs, model)
      ]);
    }

    const skuRowsByGoods = new Map();
    skuRows.forEach((row) => {
      const gid = Number(row.goods_id || 0);
      if (!skuRowsByGoods.has(gid)) {
        skuRowsByGoods.set(gid, []);
      }
      skuRowsByGoods.get(gid).push(row);
    });

    const fullReductionIds = fullReductionPromotions.map(item => Number(item.id || 0));
    const fullReductionGoodsMap = fullReductionIds.length ? await this.getFullReductionGoodsMap(fullReductionIds, model) : new Map();
    const fullReductionGoodsHitMap = new Map();
    fullReductionPromotions.forEach((promotion) => {
      const goodsSet = fullReductionGoodsMap.get(Number(promotion.id)) || new Set();
      goodsSet.forEach((gid) => {
        if (!fullReductionGoodsHitMap.has(gid)) {
          fullReductionGoodsHitMap.set(gid, promotion);
        }
      });
    });

    const promoted = [];
    const undecoratedForCoupon = [];

    list.forEach((item) => {
      const goodsId = Number(item.id || item.goods_id || 0);
      const basePriceCents = this.toCents(item.min_retail_price || item.retail_price || 0);
      const rows = skuRowsByGoods.get(goodsId) || [];
      const chosen = this.chooseBestSkuRow(rows, basePriceCents);

      if (chosen.applied && chosen.row) {
        const row = chosen.row;
        const available = Math.max(0, Number(row.seckill_stock || 0) - Number(row.locked_stock || 0) - Number(row.sold_stock || 0));
        const percent = Number(row.seckill_stock || 0) > 0 ? Math.max(0, Math.min(100, Math.round(available * 100 / Number(row.seckill_stock)))) : 0;
        promoted.push(this.normalizePromoDisplayFields(Object.assign({}, item, {
          has_promo: 1,
          promo_source: 'promotion',
          promo_type: chosen.type,
          promo_price: this.fromCents(chosen.promoUnitCents),
          original_price: this.fromCents(basePriceCents),
          promo_tag: this.choosePromoTag(chosen.type, row),
          promo_end_at: Number(row.end_at || 0),
          promo_stock_percent: chosen.type === PROMOTION_TYPE.SECKILL ? percent : 0
        }), basePriceCents));
        return;
      }

      const fullReduction = fullReductionGoodsHitMap.get(goodsId);
      if (fullReduction) {
        promoted.push(this.normalizePromoDisplayFields(Object.assign({}, item, {
          has_promo: 1,
          promo_source: 'promotion',
          promo_type: PROMOTION_TYPE.TIMED_FULL_REDUCTION,
          promo_price: this.fromCents(basePriceCents),
          original_price: this.fromCents(basePriceCents),
          promo_tag: this.choosePromoTag(PROMOTION_TYPE.TIMED_FULL_REDUCTION, fullReduction),
          promo_end_at: Number(fullReduction.end_at || 0),
          promo_stock_percent: 0
        }), basePriceCents));
        return;
      }

      const clean = this.normalizePromoDisplayFields(Object.assign({}, item, {
        has_promo: 0,
        promo_source: 'none',
        promo_type: '',
        promo_price: this.fromCents(basePriceCents),
        original_price: this.fromCents(basePriceCents),
        promo_tag: '',
        promo_end_at: 0,
        promo_stock_percent: 0
      }), basePriceCents);
      promoted.push(clean);
      undecoratedForCoupon.push(clean);
    });

    if (Number(userId || 0) > 0 && undecoratedForCoupon.length > 0) {
      try {
        const couponService = think.service('coupon', 'api');
        const couponDecorated = await couponService.decorateGoodsWithCouponPromo(userId, undecoratedForCoupon, model);
        const couponMap = new Map((couponDecorated || []).map((item) => [Number(item.id || item.goods_id || 0), item]));
        return promoted.map((item) => {
          if (Number(item.has_promo || 0) === 1) {
            return item;
          }
          const couponItem = couponMap.get(Number(item.id || item.goods_id || 0));
          if (!couponItem || Number(couponItem.has_coupon_promo || 0) !== 1) {
            return item;
          }
          const originalCents = this.toCents(couponItem.original_price || item.original_price || item.min_retail_price || item.retail_price || 0);
          return this.normalizePromoDisplayFields(Object.assign({}, item, {
            has_promo: 1,
            promo_source: 'coupon',
            promo_type: 'coupon',
            promo_price: couponItem.promo_price || item.promo_price,
            original_price: couponItem.original_price || item.original_price,
            promo_tag: couponItem.promo_tag || '优惠券',
            promo_end_at: 0,
            promo_stock_percent: 0
          }), originalCents);
        });
      } catch (err) {
        think.logger && think.logger.error && think.logger.error(`[promotion.decorateGoodsWithPromotion.couponFallback] ${err.message || err}`);
      }
    }

    return promoted;
  }

  async decorateSkuListWithPromotion(userId, goodsId, skuList, model = null) {
    const list = Array.isArray(skuList) ? skuList : [];
    if (!list.length) return [];
    const nowTs = this.now();
    const productIds = this.normalizeIdList(list.map(item => Number(item.id || item.product_id || 0)));
    const skuRows = this.isPromotionEnabled()
      ? await this.listActiveSkuPromotions({ nowTs, goodsIds: [goodsId], productIds, model })
      : [];
    const rowsByProduct = new Map();
    skuRows.forEach((row) => {
      const productId = Number(row.product_id || 0);
      if (!rowsByProduct.has(productId)) {
        rowsByProduct.set(productId, []);
      }
      rowsByProduct.get(productId).push(row);
    });

    const promoted = [];
    const undecoratedForCoupon = [];
    list.forEach((item) => {
      const productId = Number(item.id || item.product_id || 0);
      const basePriceCents = this.toCents(item.retail_price || 0);
      const rows = rowsByProduct.get(productId) || [];
      const chosen = this.chooseBestSkuRow(rows, basePriceCents);
      if (chosen.applied && chosen.row) {
        const row = chosen.row;
        const available = Math.max(0, Number(row.seckill_stock || 0) - Number(row.locked_stock || 0) - Number(row.sold_stock || 0));
        const percent = Number(row.seckill_stock || 0) > 0 ? Math.max(0, Math.min(100, Math.round(available * 100 / Number(row.seckill_stock)))) : 0;
        promoted.push(this.normalizePromoDisplayFields(Object.assign({}, item, {
          has_promo: 1,
          promo_source: 'promotion',
          promo_type: chosen.type,
          promo_price: this.fromCents(chosen.promoUnitCents),
          original_price: this.fromCents(basePriceCents),
          promo_tag: this.choosePromoTag(chosen.type, row),
          promo_end_at: Number(row.end_at || 0),
          promo_stock_percent: chosen.type === PROMOTION_TYPE.SECKILL ? percent : 0
        }), basePriceCents));
      } else {
        const clean = this.normalizePromoDisplayFields(Object.assign({}, item, {
          has_promo: 0,
          promo_source: 'none',
          promo_type: '',
          promo_price: this.fromCents(basePriceCents),
          original_price: this.fromCents(basePriceCents),
          promo_tag: '',
          promo_end_at: 0,
          promo_stock_percent: 0
        }), basePriceCents);
        promoted.push(clean);
        undecoratedForCoupon.push(clean);
      }
    });

    if (Number(userId || 0) > 0 && undecoratedForCoupon.length > 0) {
      try {
        const couponService = think.service('coupon', 'api');
        const couponDecorated = await couponService.decorateGoodsWithCouponPromo(userId, undecoratedForCoupon.map((item) => ({
          id: Number(goodsId || 0),
          min_retail_price: Number(item.retail_price || 0)
        })), model);
        // coupon service returns goods-id granularity. Apply same fallback rule to undecorated SKUs by discount rate equivalence.
        const couponMeta = Array.isArray(couponDecorated) && couponDecorated[0] ? couponDecorated[0] : null;
        if (couponMeta && Number(couponMeta.has_coupon_promo || 0) === 1) {
          const promoPrice = Number(couponMeta.promo_price || 0);
          const originalPrice = Number(couponMeta.original_price || 0);
          const rate = originalPrice > 0 ? Math.max(0, Math.min(1, promoPrice / originalPrice)) : 1;
          return promoted.map((item) => {
            if (Number(item.has_promo || 0) === 1) {
              return item;
            }
            const originalCents = this.toCents(item.retail_price || 0);
            const finalCents = Math.round(originalCents * rate);
            return this.normalizePromoDisplayFields(Object.assign({}, item, {
              has_promo: 1,
              promo_source: 'coupon',
              promo_type: 'coupon',
              promo_price: this.fromCents(finalCents),
              original_price: this.fromCents(originalCents),
              promo_tag: couponMeta.promo_tag || '优惠券'
            }), originalCents);
          });
        }
      } catch (err) {
        think.logger && think.logger.error && think.logger.error(`[promotion.decorateSkuListWithPromotion.couponFallback] ${err.message || err}`);
      }
    }

    return promoted;
  }

  async previewCartPromotions({ userId = 0, cartItems = [], freightPrice = 0, model = null }) {
    const items = Array.isArray(cartItems) ? cartItems : [];
    const nowTs = this.now();
    const freightCents = this.toCents(freightPrice || 0);

    const normalizedItems = items.map((item, idx) => {
      const goodsId = Number(item.goods_id || item.goodsId || 0);
      const productId = Number(item.product_id || item.productId || 0);
      const number = Math.max(0, Number(item.number || 0));
      const unitCents = this.toCents(item.retail_price || item.retailPrice || 0);
      return {
        idx,
        goods_id: goodsId,
        product_id: productId,
        number,
        unit_cents: unitCents,
        raw: item
      };
    }).filter(item => item.goods_id > 0 && item.product_id > 0 && item.number > 0 && item.unit_cents >= 0);

    if (!normalizedItems.length) {
      return {
        originalGoodsTotalPrice: this.fromCents(0),
        goodsTotalPrice: this.fromCents(0),
        orderTotalPrice: this.fromCents(freightCents),
        actualPrice: this.fromCents(freightCents),
        promotionPrice: this.fromCents(0),
        selectedPromotions: [],
        seckillItems: [],
        hasSeckill: false,
        pricedItems: []
      };
    }

    if (!this.isPromotionEnabled()) {
      const originalGoodsTotalCents = normalizedItems.reduce((sum, item) => {
        return sum + Number(item.unit_cents || 0) * Number(item.number || 0);
      }, 0);
      const orderTotalCents = originalGoodsTotalCents + freightCents;
      return {
        originalGoodsTotalPrice: this.fromCents(originalGoodsTotalCents),
        goodsTotalPrice: this.fromCents(originalGoodsTotalCents),
        orderTotalPrice: this.fromCents(orderTotalCents),
        actualPrice: this.fromCents(orderTotalCents),
        promotionPrice: this.fromCents(0),
        selectedPromotions: [],
        seckillItems: [],
        hasSeckill: false,
        pricedItems: normalizedItems.map((item) => ({
          goods_id: item.goods_id,
          product_id: item.product_id,
          number: item.number,
          original_unit_cents: item.unit_cents,
          final_unit_cents: item.unit_cents,
          original_unit_price: this.fromCents(item.unit_cents),
          final_unit_price: this.fromCents(item.unit_cents),
          discount_amount: this.fromCents(0),
          applied_promotion: null,
          has_sku_promotion: false
        }))
      };
    }

    const goodsIds = this.normalizeIdList(normalizedItems.map(item => item.goods_id));
    const productIds = this.normalizeIdList(normalizedItems.map(item => item.product_id));
    const [skuRows, fullReductionPromotions] = await Promise.all([
      this.listActiveSkuPromotions({ nowTs, goodsIds, productIds, model }),
      this.listActiveFullReductionPromotions(nowTs, model)
    ]);

    const rowsByProduct = new Map();
    skuRows.forEach((row) => {
      const pid = Number(row.product_id || 0);
      if (!rowsByProduct.has(pid)) {
        rowsByProduct.set(pid, []);
      }
      rowsByProduct.get(pid).push(row);
    });

    let originalGoodsTotalCents = 0;
    let skuAdjustedGoodsTotalCents = 0;
    const selectedPromotionsMap = new Map();
    const seckillItems = [];

    const pricedItems = normalizedItems.map((item) => {
      const rowList = rowsByProduct.get(item.product_id) || [];
      const chosen = this.chooseBestSkuRow(rowList, item.unit_cents);
      const finalUnitCents = chosen.applied ? chosen.promoUnitCents : item.unit_cents;
      const originalSubtotal = item.unit_cents * item.number;
      const finalSubtotal = finalUnitCents * item.number;
      const discountCents = Math.max(0, originalSubtotal - finalSubtotal);
      originalGoodsTotalCents += originalSubtotal;
      skuAdjustedGoodsTotalCents += finalSubtotal;

      let appliedPromotion = null;
      if (chosen.applied && chosen.row) {
        const row = chosen.row;
        const promotionId = Number(row.promotion_id || 0);
        const record = selectedPromotionsMap.get(promotionId) || {
          promotion_id: promotionId,
          promotion_type: row.promotion_type,
          promotion_name: row.promotion_name,
          discount_cents: 0,
          detail: {
            start_at: Number(row.start_at || 0),
            end_at: Number(row.end_at || 0),
            items: []
          }
        };
        record.discount_cents += discountCents;
        record.detail.items.push({
          goods_id: item.goods_id,
          product_id: item.product_id,
          number: item.number,
          original_unit_price: this.fromCents(item.unit_cents),
          final_unit_price: this.fromCents(finalUnitCents),
          discount_amount: this.fromCents(discountCents)
        });
        selectedPromotionsMap.set(promotionId, record);
        appliedPromotion = {
          promotion_id: promotionId,
          promotion_type: row.promotion_type,
          promotion_name: row.promotion_name,
          promotion_sku_id: Number(row.promotion_sku_id || 0),
          end_at: Number(row.end_at || 0),
          per_user_limit: Number(row.per_user_limit || 0)
        };

        if (String(row.promotion_type) === PROMOTION_TYPE.SECKILL) {
          seckillItems.push({
            promotion_id: promotionId,
            promotion_sku_id: Number(row.promotion_sku_id || 0),
            goods_id: item.goods_id,
            product_id: item.product_id,
            quantity: item.number,
            per_user_limit: Number(row.per_user_limit || 0)
          });
        }
      }

      return {
        goods_id: item.goods_id,
        product_id: item.product_id,
        number: item.number,
        original_unit_cents: item.unit_cents,
        final_unit_cents: finalUnitCents,
        original_unit_price: this.fromCents(item.unit_cents),
        final_unit_price: this.fromCents(finalUnitCents),
        discount_amount: this.fromCents(discountCents),
        applied_promotion: appliedPromotion,
        has_sku_promotion: !!appliedPromotion
      };
    });

    const fullReductionIds = fullReductionPromotions.map(item => Number(item.id || 0));
    const [fullReductionGoodsMap, fullReductionTierMap] = await Promise.all([
      this.getFullReductionGoodsMap(fullReductionIds, model),
      this.getFullReductionTierMap(fullReductionIds, model)
    ]);

    let fullReductionWinner = null;
    fullReductionPromotions.forEach((promotion) => {
      const promotionId = Number(promotion.id || 0);
      const goodsSet = fullReductionGoodsMap.get(promotionId) || new Set();
      const tiers = fullReductionTierMap.get(promotionId) || [];
      if (!tiers.length || !goodsSet.size) return;

      let subtotalCents = 0;
      pricedItems.forEach((item) => {
        if (item.has_sku_promotion) return;
        if (!goodsSet.has(Number(item.goods_id || 0))) return;
        subtotalCents += Number(item.final_unit_cents || 0) * Number(item.number || 0);
      });
      if (subtotalCents <= 0) return;

      let matchedTier = null;
      tiers.forEach((tier) => {
        if (subtotalCents >= Number(tier.thresholdCents || 0)) {
          matchedTier = tier;
        }
      });
      if (!matchedTier) return;

      const discountCents = Math.min(subtotalCents, Number(matchedTier.reduceCents || 0));
      if (discountCents <= 0) return;

      if (!fullReductionWinner || discountCents > fullReductionWinner.discount_cents) {
        fullReductionWinner = {
          promotion_id: promotionId,
          promotion_type: PROMOTION_TYPE.TIMED_FULL_REDUCTION,
          promotion_name: promotion.name,
          discount_cents: discountCents,
          detail: {
            threshold_amount: matchedTier.threshold_amount,
            reduce_amount: matchedTier.reduce_amount,
            eligible_subtotal: this.fromCents(subtotalCents),
            start_at: Number(promotion.start_at || 0),
            end_at: Number(promotion.end_at || 0)
          }
        };
      }
    });

    if (fullReductionWinner) {
      const existed = selectedPromotionsMap.get(fullReductionWinner.promotion_id);
      if (existed) {
        existed.discount_cents += fullReductionWinner.discount_cents;
        existed.detail.full_reduction = fullReductionWinner.detail;
        selectedPromotionsMap.set(fullReductionWinner.promotion_id, existed);
      } else {
        selectedPromotionsMap.set(fullReductionWinner.promotion_id, fullReductionWinner);
      }
    }

    const skuDiscountCents = Math.max(0, originalGoodsTotalCents - skuAdjustedGoodsTotalCents);
    const fullReductionDiscountCents = fullReductionWinner ? Number(fullReductionWinner.discount_cents || 0) : 0;
    const promotionDiscountCents = Math.max(0, skuDiscountCents + fullReductionDiscountCents);

    const finalGoodsTotalCents = Math.max(0, skuAdjustedGoodsTotalCents - fullReductionDiscountCents);
    const finalOrderTotalCents = finalGoodsTotalCents + freightCents;

    const selectedPromotions = Array.from(selectedPromotionsMap.values()).map((item) => ({
      promotion_id: Number(item.promotion_id || 0),
      promotion_type: item.promotion_type,
      promotion_name: item.promotion_name,
      discount_amount: this.fromCents(Number(item.discount_cents || 0)),
      detail: item.detail || {}
    })).sort((a, b) => Number(a.promotion_id || 0) - Number(b.promotion_id || 0));

    return {
      originalGoodsTotalPrice: this.fromCents(originalGoodsTotalCents),
      goodsTotalPrice: this.fromCents(finalGoodsTotalCents),
      orderTotalPrice: this.fromCents(finalOrderTotalCents),
      actualPrice: this.fromCents(finalOrderTotalCents),
      promotionPrice: this.fromCents(promotionDiscountCents),
      selectedPromotions,
      seckillItems,
      hasSeckill: seckillItems.length > 0,
      pricedItems
    };
  }

  mergeSeckillItems(seckillItems) {
    const merged = new Map();
    (Array.isArray(seckillItems) ? seckillItems : []).forEach((item) => {
      const skuId = Number(item.promotion_sku_id || 0);
      const promotionId = Number(item.promotion_id || 0);
      const qty = Math.max(0, Number(item.quantity || 0));
      if (skuId <= 0 || promotionId <= 0 || qty <= 0) return;
      const key = `${promotionId}_${skuId}`;
      const current = merged.get(key) || {
        promotion_id: promotionId,
        promotion_sku_id: skuId,
        quantity: 0,
        per_user_limit: Number(item.per_user_limit || 0)
      };
      current.quantity += qty;
      if (Number(item.per_user_limit || 0) > 0) {
        current.per_user_limit = Number(item.per_user_limit || 0);
      }
      merged.set(key, current);
    });
    return Array.from(merged.values());
  }

  async lockSeckillStockForOrder({ orderId, userId, seckillItems, expireAt, transactionModel }) {
    if (!this.isPromotionEnabled()) {
      return { count: 0 };
    }
    const uid = Number(userId || 0);
    const oid = Number(orderId || 0);
    if (uid <= 0 || oid <= 0) {
      throw new Error('秒杀锁库参数错误');
    }

    const items = this.mergeSeckillItems(seckillItems);
    if (!items.length) {
      return { count: 0 };
    }

    const nowTs = this.now();
    const lockModel = this.getModel(transactionModel, 'promotion_order_lock');
    const skuModel = this.getModel(transactionModel, 'promotion_sku');

    for (const item of items) {
      const skuInfo = await skuModel.where({
        id: Number(item.promotion_sku_id || 0),
        promotion_id: Number(item.promotion_id || 0)
      }).find();
      if (think.isEmpty(skuInfo)) {
        throw new Error('秒杀活动不存在');
      }
      const quantity = Math.max(0, Number(item.quantity || 0));
      if (quantity <= 0) {
        continue;
      }

      const limit = Number(item.per_user_limit || skuInfo.per_user_limit || 0);
      if (limit > 0) {
        const usedCount = await lockModel.where({
          user_id: uid,
          promotion_sku_id: Number(item.promotion_sku_id || 0),
          status: ['IN', 'locked,paid']
        }).sum('quantity');
        if (Number(usedCount || 0) + quantity > limit) {
          throw new Error('超过秒杀限购数量');
        }
      }

      const affectedRows = await skuModel.where({
        id: Number(skuInfo.id),
        promotion_id: Number(item.promotion_id || 0)
      }).where(`(seckill_stock - locked_stock - sold_stock) >= ${quantity}`).increment('locked_stock', quantity);
      if (Number(affectedRows) !== 1) {
        throw new Error('秒杀库存不足，请刷新后重试');
      }
      await skuModel.where({ id: Number(skuInfo.id) }).update({ update_time: nowTs });

      await lockModel.add({
        order_id: oid,
        promotion_id: Number(item.promotion_id || 0),
        promotion_sku_id: Number(item.promotion_sku_id || 0),
        user_id: uid,
        quantity: quantity,
        status: 'locked',
        lock_expire_at: Number(expireAt || 0),
        add_time: nowTs,
        update_time: nowTs
      });
    }

    return {
      count: items.length
    };
  }

  async consumeSeckillLocks(orderId, transactionModel = null) {
    const oid = Number(orderId || 0);
    if (oid <= 0) return { count: 0 };

    const lockModel = this.getModel(transactionModel, 'promotion_order_lock');
    const skuModel = this.getModel(transactionModel, 'promotion_sku');
    const nowTs = this.now();

    const rows = await lockModel.where({
      order_id: oid,
      status: 'locked'
    }).select();
    if (!rows.length) {
      return { count: 0 };
    }

    for (const row of rows) {
      const skuInfo = await skuModel.where({
        id: Number(row.promotion_sku_id || 0)
      }).find();
      if (think.isEmpty(skuInfo)) {
        continue;
      }
      const qty = Math.max(0, Number(row.quantity || 0));
      const nextLocked = Math.max(0, Number(skuInfo.locked_stock || 0) - qty);
      const nextSold = Math.max(0, Number(skuInfo.sold_stock || 0) + qty);
      await skuModel.where({ id: Number(skuInfo.id) }).update({
        locked_stock: nextLocked,
        sold_stock: nextSold,
        update_time: nowTs
      });
      await lockModel.where({ id: Number(row.id) }).update({
        status: 'paid',
        update_time: nowTs
      });
    }

    return { count: rows.length };
  }

  async releaseSeckillLocks(orderId, transactionModel = null) {
    const oid = Number(orderId || 0);
    if (oid <= 0) return { count: 0 };

    const lockModel = this.getModel(transactionModel, 'promotion_order_lock');
    const skuModel = this.getModel(transactionModel, 'promotion_sku');
    const nowTs = this.now();

    const rows = await lockModel.where({
      order_id: oid,
      status: 'locked'
    }).select();
    if (!rows.length) {
      return { count: 0 };
    }

    for (const row of rows) {
      const skuInfo = await skuModel.where({
        id: Number(row.promotion_sku_id || 0)
      }).find();
      if (think.isEmpty(skuInfo)) {
        continue;
      }
      const qty = Math.max(0, Number(row.quantity || 0));
      const nextLocked = Math.max(0, Number(skuInfo.locked_stock || 0) - qty);
      await skuModel.where({ id: Number(skuInfo.id) }).update({
        locked_stock: nextLocked,
        update_time: nowTs
      });
      await lockModel.where({ id: Number(row.id) }).update({
        status: 'released',
        update_time: nowTs
      });
    }

    return { count: rows.length };
  }

  async releaseExpiredSeckillLocksBatch(nowTs = this.now()) {
    const lockModel = this.model('promotion_order_lock');
    const skuModel = this.model('promotion_sku');
    let totalReleased = 0;

    for (let i = 0; i < 5; i++) {
      let releasedInRound = 0;
      await lockModel.transaction(async () => {
        const txLock = lockModel.model('promotion_order_lock');
        txLock.db(lockModel.db());
        const txSku = lockModel.model('promotion_sku');
        txSku.db(lockModel.db());

        const rows = await txLock.where({
          status: 'locked',
          lock_expire_at: ['<=', Number(nowTs || 0)]
        }).limit(200).select();

        if (!rows.length) {
          releasedInRound = 0;
          return;
        }

        const updateTime = this.now();
        for (const row of rows) {
          const sku = await txSku.where({ id: Number(row.promotion_sku_id || 0) }).find();
          if (!think.isEmpty(sku)) {
            const qty = Math.max(0, Number(row.quantity || 0));
            const nextLocked = Math.max(0, Number(sku.locked_stock || 0) - qty);
            await txSku.where({ id: Number(sku.id) }).update({
              locked_stock: nextLocked,
              update_time: updateTime
            });
          }
          await txLock.where({ id: Number(row.id) }).update({
            status: 'released',
            update_time: updateTime
          });
        }
        releasedInRound = rows.length;
      });

      totalReleased += releasedInRound;
      if (releasedInRound < 200) {
        break;
      }
    }

    return {
      releasedCount: totalReleased
    };
  }

  async saveOrderPromotionSnapshot({ orderId, selectedPromotions, transactionModel = null }) {
    const oid = Number(orderId || 0);
    if (oid <= 0) return { count: 0 };
    const promotions = Array.isArray(selectedPromotions) ? selectedPromotions : [];
    if (!promotions.length) return { count: 0 };

    const model = this.getModel(transactionModel, 'order_promotion');
    const nowTs = this.now();
    const rows = promotions.map((item) => ({
      order_id: oid,
      promotion_id: Number(item.promotion_id || 0),
      promotion_type: String(item.promotion_type || ''),
      promotion_name_snapshot: String(item.promotion_name || ''),
      discount_amount: Number(item.discount_amount || 0).toFixed(2),
      detail_json: JSON.stringify(item.detail || {}),
      add_time: nowTs
    })).filter(item => item.promotion_id > 0);

    if (!rows.length) return { count: 0 };
    await model.addMany(rows);
    return {
      count: rows.length
    };
  }
};
