module.exports = class extends think.Service {
  now() {
    return parseInt(Date.now() / 1000, 10);
  }

  normalizeNumber(value, fallback = 0) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : fallback;
    }
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (!text) return fallback;
    if (text.includes('-')) {
      const first = Number(text.split('-')[0]);
      return Number.isFinite(first) ? first : fallback;
    }
    const parsed = Number(text.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  normalizePrice(value, fallback = 0) {
    const parsed = this.normalizeNumber(value, fallback);
    return parsed < 0 ? 0 : parsed;
  }

  formatPrice(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed)) {
      return '0.00';
    }
    return parsed.toFixed(2);
  }

  formatDiscountRateText(rate) {
    const fixed = Number(rate || 10).toFixed(2);
    return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  formatAmountText(amount) {
    const fixed = Number(amount || 0).toFixed(2);
    return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  formatPromotionTag(promotion) {
    if (promotion && promotion.promo_tag) {
      return String(promotion.promo_tag);
    }
    const type = String((promotion && promotion.promo_type) || 'discount');
    if (type === 'direct_reduce') {
      return `直减${this.formatAmountText(promotion.reduce_amount)}元`;
    }
    return `${this.formatDiscountRateText(promotion.discount_rate)}折`;
  }

  calculatePromotionPrice(basePrice, promotion) {
    const price = this.normalizePrice(basePrice, 0);
    const promoType = String((promotion && promotion.promo_type) || 'discount');
    let promoted = price;

    if (promoType === 'direct_reduce') {
      const reduce = this.normalizePrice(promotion.reduce_amount, 0);
      promoted = price - reduce;
    } else {
      const discountRate = this.normalizePrice(promotion.discount_rate, 10);
      const ratio = Math.min(10, Math.max(0, discountRate)) / 10;
      promoted = price * ratio;
    }

    promoted = Math.max(0, promoted);
    return Math.round(promoted * 100) / 100;
  }

  buildDefaultDecoration(goods, basePrice) {
    const formattedBase = this.formatPrice(basePrice);
    return Object.assign({}, goods, {
      has_promotion: 0,
      promotion_price: formattedBase,
      promotion_original_price: formattedBase,
      promotion_tag: '',
      promotion_name: '',
      promotion_end_at: 0,
      promotion_countdown_seconds: 0,
      has_coupon_promo: 0,
      promo_price: formattedBase,
      original_price: formattedBase,
      promo_tag: ''
    });
  }

  compareCandidate(current, next) {
    if (!current) {
      return next;
    }
    if (Number(next.price) < Number(current.price)) {
      return next;
    }
    if (Number(next.price) > Number(current.price)) {
      return current;
    }
    const nextPriority = Number(next.promotion.priority || 0);
    const currentPriority = Number(current.promotion.priority || 0);
    if (nextPriority !== currentPriority) {
      return nextPriority > currentPriority ? next : current;
    }
    const nextEnd = Number(next.promotion.end_at || 0);
    const currentEnd = Number(current.promotion.end_at || 0);
    return nextEnd < currentEnd ? next : current;
  }

  async getActivePromotions(nowTs) {
    return this.model('promotion').where({
      is_delete: 0,
      status: 'enabled',
      start_at: ['<=', nowTs],
      end_at: ['>=', nowTs]
    }).order('priority DESC,id DESC').select();
  }

  async getPromotionGoodsMap(promotionIds, goodsIds) {
    const map = new Map();
    if (!promotionIds.length || !goodsIds.length) {
      return map;
    }
    const rows = await this.model('promotion_goods').where({
      promotion_id: ['IN', promotionIds],
      goods_id: ['IN', goodsIds]
    }).select();
    rows.forEach((row) => {
      const promotionId = Number(row.promotion_id || 0);
      const goodsId = Number(row.goods_id || 0);
      if (promotionId <= 0 || goodsId <= 0) {
        return;
      }
      if (!map.has(promotionId)) {
        map.set(promotionId, new Set());
      }
      map.get(promotionId).add(goodsId);
    });
    return map;
  }

  isPromotionApplicable(promotion, goodsId, promotionGoodsMap) {
    if (!promotion || goodsId <= 0) {
      return false;
    }
    const scopeType = String(promotion.scope_type || 'all');
    if (scopeType === 'all') {
      return true;
    }
    const goodsSet = promotionGoodsMap.get(Number(promotion.id || 0));
    return !!(goodsSet && goodsSet.has(goodsId));
  }

  decorateOne(goods, promotions, promotionGoodsMap, nowTs) {
    const goodsId = Number(goods && (goods.goods_id || goods.id) || 0);
    const basePrice = this.normalizePrice(
      goods && (goods.min_retail_price !== undefined ? goods.min_retail_price : goods.retail_price),
      this.normalizePrice(goods && goods.retail_price, 0)
    );
    const baseDecorated = this.buildDefaultDecoration(goods, basePrice);

    if (goodsId <= 0 || basePrice <= 0 || !Array.isArray(promotions) || promotions.length === 0) {
      return baseDecorated;
    }

    let best = null;
    promotions.forEach((promotion) => {
      if (!this.isPromotionApplicable(promotion, goodsId, promotionGoodsMap)) {
        return;
      }
      const promotedPrice = this.calculatePromotionPrice(basePrice, promotion);
      if (promotedPrice >= basePrice) {
        return;
      }
      const candidate = {
        promotion,
        price: promotedPrice
      };
      best = this.compareCandidate(best, candidate);
    });

    if (!best) {
      return baseDecorated;
    }

    const promotion = best.promotion;
    const promoPrice = this.formatPrice(best.price);
    const originalPrice = this.formatPrice(basePrice);
    const endAt = Number(promotion.end_at || 0);
    const countdown = Math.max(0, endAt - Number(nowTs || 0));
    const promoTag = this.formatPromotionTag(promotion);

    return Object.assign({}, goods, {
      has_promotion: 1,
      promotion_price: promoPrice,
      promotion_original_price: originalPrice,
      promotion_tag: promoTag,
      promotion_name: String(promotion.name || ''),
      promotion_end_at: endAt,
      promotion_countdown_seconds: countdown,
      has_coupon_promo: 1,
      promo_price: promoPrice,
      original_price: originalPrice,
      promo_tag: promoTag
    });
  }

  async decorateGoodsWithPromotion(goodsList, options = {}) {
    if (!Array.isArray(goodsList) || goodsList.length === 0) {
      return Array.isArray(goodsList) ? goodsList : [];
    }
    const nowTs = Number(options.nowTs || this.now());
    const promotions = await this.getActivePromotions(nowTs);
    if (!promotions.length) {
      return goodsList.map((goods) => {
        const basePrice = this.normalizePrice(
          goods && (goods.min_retail_price !== undefined ? goods.min_retail_price : goods.retail_price),
          this.normalizePrice(goods && goods.retail_price, 0)
        );
        return this.buildDefaultDecoration(goods, basePrice);
      });
    }
    const goodsIds = Array.from(new Set(goodsList.map(item => Number(item && (item.goods_id || item.id) || 0)).filter(id => id > 0)));
    const promotionIds = promotions.map(item => Number(item.id || 0)).filter(id => id > 0);
    const promotionGoodsMap = await this.getPromotionGoodsMap(promotionIds, goodsIds);
    return goodsList.map(goods => this.decorateOne(goods, promotions, promotionGoodsMap, nowTs));
  }

  async decorateCartItemsWithPromotion(cartItems, options = {}) {
    const list = Array.isArray(cartItems) ? cartItems : [];
    if (!list.length) {
      return [];
    }
    const nowTs = Number(options.nowTs || this.now());
    const promotions = await this.getActivePromotions(nowTs);
    let promotionGoodsMap = new Map();
    if (promotions.length) {
      const goodsIds = Array.from(new Set(
        list
          .map(item => Number(item && (item.goods_id || item.id) || 0))
          .filter(id => id > 0)
      ));
      const promotionIds = promotions.map(item => Number(item.id || 0)).filter(id => id > 0);
      promotionGoodsMap = await this.getPromotionGoodsMap(promotionIds, goodsIds);
    }
    return list.map((item) => {
      const basePrice = this.normalizePrice(
        item && item.retail_price,
        this.normalizePrice(item && item.min_retail_price, 0)
      );
      const source = Object.assign({}, item, {
        goods_id: Number(item && (item.goods_id || item.id) || 0),
        retail_price: basePrice
      });
      const decorated = promotions.length
        ? this.decorateOne(source, promotions, promotionGoodsMap, nowTs)
        : this.buildDefaultDecoration(source, basePrice);
      const hasPromotion = Number(decorated.has_promotion || 0) === 1;
      const effectiveUnitPrice = this.normalizePrice(
        hasPromotion ? decorated.promotion_price : decorated.retail_price,
        basePrice
      );
      const originalUnitPrice = this.normalizePrice(
        hasPromotion ? decorated.promotion_original_price : decorated.retail_price,
        basePrice
      );
      const unitDiscount = Math.max(0, originalUnitPrice - effectiveUnitPrice);
      const effectiveText = this.formatPrice(effectiveUnitPrice);
      const originalText = this.formatPrice(originalUnitPrice);
      const promoTag = String(decorated.promotion_tag || decorated.promo_tag || '');
      return Object.assign({}, decorated, {
        has_promotion: hasPromotion ? 1 : 0,
        promotion_price: effectiveText,
        promotion_original_price: originalText,
        promotion_tag: promoTag,
        display_price: effectiveText,
        effective_unit_price: effectiveText,
        promotion_discount_per_unit: this.formatPrice(unitDiscount),
        // 保留历史字段，兼容旧前端读取逻辑。
        has_coupon_promo: hasPromotion ? 1 : 0,
        promo_price: effectiveText,
        original_price: originalText,
        promo_tag: promoTag
      });
    });
  }

  summarizeCartItems(cartItems) {
    const list = Array.isArray(cartItems) ? cartItems : [];
    let goodsOriginal = 0;
    let goodsPromoted = 0;
    list.forEach((item) => {
      const number = Number(item && item.number || 0);
      if (number <= 0) {
        return;
      }
      const originalUnit = this.normalizePrice(
        item && (item.promotion_original_price !== undefined ? item.promotion_original_price : item.retail_price),
        this.normalizePrice(item && item.retail_price, 0)
      );
      const promotedUnit = this.normalizePrice(
        item && (item.display_price !== undefined ? item.display_price : item.promotion_price),
        originalUnit
      );
      goodsOriginal += originalUnit * number;
      goodsPromoted += promotedUnit * number;
    });
    goodsOriginal = Math.round(goodsOriginal * 100) / 100;
    goodsPromoted = Math.round(goodsPromoted * 100) / 100;
    const promotionDiscount = Math.max(0, Math.round((goodsOriginal - goodsPromoted) * 100) / 100);
    return {
      goodsOriginalNumber: goodsOriginal,
      goodsTotalNumber: goodsPromoted,
      promotionNumber: promotionDiscount,
      goodsOriginalPrice: this.formatPrice(goodsOriginal),
      goodsTotalPrice: this.formatPrice(goodsPromoted),
      promotionPrice: this.formatPrice(promotionDiscount)
    };
  }
};
