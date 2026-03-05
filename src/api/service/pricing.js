module.exports = class extends think.Service {
  normalizeIdList(value) {
    const couponService = think.service('coupon', 'api');
    if (couponService && typeof couponService.normalizeIdList === 'function') {
      return couponService.normalizeIdList(value);
    }
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

  toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isNaN(num) ? fallback : num;
  }

  buildFallbackPromotionPreview(cartItems = [], freightPrice = 0) {
    const list = Array.isArray(cartItems) ? cartItems : [];
    let goodsTotal = 0;
    list.forEach((item) => {
      const number = Math.max(0, Number(item.number || 0));
      const retailPrice = this.toNumber(item.retail_price || item.retailPrice, 0);
      goodsTotal += number * retailPrice;
    });
    const orderTotal = goodsTotal + this.toNumber(freightPrice, 0);
    return {
      originalGoodsTotalPrice: goodsTotal.toFixed(2),
      goodsTotalPrice: goodsTotal.toFixed(2),
      orderTotalPrice: orderTotal.toFixed(2),
      actualPrice: orderTotal.toFixed(2),
      promotionPrice: '0.00',
      selectedPromotions: [],
      seckillItems: [],
      hasSeckill: false,
      pricedItems: []
    };
  }

  async resolveFinalPrice({
    userId = 0,
    cartItems = [],
    selectedUserCouponIds = [],
    freightPrice = 0,
    model = null
  } = {}) {
    const uid = Number(userId || 0);
    const selectedCouponIds = this.normalizeIdList(selectedUserCouponIds);
    const couponService = think.service('coupon', 'api');
    const promotionService = think.service('promotion', 'api');

    const couponPreview = await couponService.previewCartCoupons({
      userId: uid,
      cartItems,
      selectedUserCouponIds: selectedCouponIds,
      freightPrice,
      model
    });
    let promotionPreview = null;
    try {
      promotionPreview = await promotionService.previewCartPromotions({
        userId: uid,
        cartItems,
        freightPrice,
        model
      });
    } catch (err) {
      think.logger && think.logger.warn && think.logger.warn(`[pricing.resolveFinalPrice.promotionPreviewFallback] ${err.message || err}`);
      promotionPreview = this.buildFallbackPromotionPreview(cartItems, freightPrice);
    }

    const couponPrice = this.toNumber(couponPreview && couponPreview.couponPrice, 0);
    const promotionPrice = this.toNumber(promotionPreview && promotionPreview.promotionPrice, 0);
    const couponActualPrice = this.toNumber(couponPreview && couponPreview.actualPrice, 0);
    const promotionActualPrice = this.toNumber(promotionPreview && promotionPreview.actualPrice, 0);
    const baseGoodsTotalPrice = this.toNumber(couponPreview && couponPreview.goodsTotalPrice, this.toNumber(promotionPreview && promotionPreview.originalGoodsTotalPrice, 0));
    const couponOrderTotalPrice = this.toNumber(couponPreview && couponPreview.orderTotalPrice, 0);
    const defaultOrderTotalPrice = couponOrderTotalPrice || this.toNumber(promotionPreview && promotionPreview.orderTotalPrice, 0);

    let appliedDiscountType = 'none';
    let mutualExclusionReason = '';
    let actualPrice = defaultOrderTotalPrice;
    let goodsTotalPrice = baseGoodsTotalPrice;

    if (promotionPrice > 0 && couponPrice > 0) {
      if (promotionActualPrice <= couponActualPrice) {
        appliedDiscountType = 'promotion';
        actualPrice = promotionActualPrice;
        mutualExclusionReason = '已为你自动选择更优惠方案：促销';
      } else {
        appliedDiscountType = 'coupon';
        actualPrice = couponActualPrice;
        mutualExclusionReason = '已为你自动选择更优惠方案：优惠券';
      }
    } else if (promotionPrice > 0) {
      appliedDiscountType = 'promotion';
      actualPrice = promotionActualPrice;
    } else if (couponPrice > 0) {
      appliedDiscountType = 'coupon';
      actualPrice = couponActualPrice;
    }

    const selectedCoupons = appliedDiscountType === 'coupon' ? (couponPreview.selectedCoupons || []) : [];
    const selectedPromotions = appliedDiscountType === 'promotion' ? (promotionPreview.selectedPromotions || []) : [];
    const seckillItems = appliedDiscountType === 'promotion' ? (promotionPreview.seckillItems || []) : [];
    const hasSeckill = appliedDiscountType === 'promotion' && (Number(promotionPreview.hasSeckill || 0) === 1 || seckillItems.length > 0);

    return {
      appliedDiscountType,
      mutualExclusionReason,
      actualPrice: actualPrice.toFixed(2),
      goodsTotalPrice: this.toNumber(goodsTotalPrice, 0).toFixed(2),
      orderTotalPrice: defaultOrderTotalPrice.toFixed(2),
      couponPrice: couponPrice.toFixed(2),
      promotionPrice: promotionPrice.toFixed(2),
      couponPreview,
      promotionPreview,
      couponCandidates: couponPreview.couponCandidates || [],
      selectedCoupons,
      selectedPromotions,
      invalidSelectedIds: couponPreview.invalidSelectedIds || [],
      pricingDecision: {
        appliedType: appliedDiscountType,
        couponActualPrice: couponActualPrice.toFixed(2),
        promotionActualPrice: promotionActualPrice.toFixed(2),
        finalActualPrice: actualPrice.toFixed(2),
        mutualExclusionReason
      },
      hasSeckill,
      seckillItems
    };
  }
};
