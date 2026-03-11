module.exports = class extends think.Service {
    async decorateCartForResponse(cartList, {userId = 0, numberChange = 0} = {}) {
        const list = Array.isArray(cartList) ? cartList : [];
        const promotionService = think.service('promotion', 'api');
        let decoratedList = [];
        try {
            decoratedList = await promotionService.decorateCartItemsWithPromotion(list);
        } catch (err) {
            think.logger && think.logger.error && think.logger.error(`[cart.decorateCartForResponse] ${err.message || err}`);
            decoratedList = list.map((item) => {
                const price = Number(item && item.retail_price || 0);
                const priceText = Number.isFinite(price) ? price.toFixed(2) : '0.00';
                return Object.assign({}, item, {
                    has_promotion: 0,
                    promotion_price: priceText,
                    promotion_original_price: priceText,
                    promotion_tag: '',
                    promotion_end_at: 0,
                    promotion_countdown_seconds: 0,
                    display_price: priceText,
                    effective_unit_price: priceText,
                    promotion_discount_per_unit: '0.00',
                    // 兼容旧前端字段
                    has_coupon_promo: 0,
                    promo_price: priceText,
                    original_price: priceText,
                    promo_tag: ''
                });
            });
        }
        let goodsCount = 0;
        let goodsAmount = 0;
        let checkedGoodsCount = 0;
        let checkedGoodsAmount = 0;
        decoratedList.forEach((item) => {
            const number = Number(item.number || 0);
            if (number <= 0) {
                return;
            }
            const unitPrice = Number(item.display_price || item.promotion_price || item.retail_price || 0);
            goodsCount += number;
            goodsAmount += number * unitPrice;
            if (Number(item.checked || 0) === 1) {
                checkedGoodsCount += number;
                checkedGoodsAmount += number * unitPrice;
            }
        });
        const checkedList = decoratedList.filter(item => Number(item.checked || 0) === 1);
        const checkedSummary = promotionService.summarizeCartItems(checkedList);
        return {
            cartList: decoratedList,
            cartTotal: {
                goodsCount: goodsCount,
                goodsAmount: goodsAmount.toFixed(2),
                checkedGoodsCount: checkedGoodsCount,
                checkedGoodsAmount: checkedGoodsAmount.toFixed(2),
                checkedGoodsOriginalPrice: checkedSummary.goodsOriginalPrice,
                checkedPromotionPrice: checkedSummary.promotionPrice,
                user_id: userId,
                numberChange: numberChange
            }
        };
    }
};
