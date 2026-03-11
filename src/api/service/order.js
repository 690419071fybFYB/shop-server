const orderSnUtil = require('../../common/utils/order_sn');

module.exports = class extends think.Service {
    buildOrderGoodsData({orderId, userId, pricedGoodsList = []} = {}) {
        const list = Array.isArray(pricedGoodsList) ? pricedGoodsList : [];
        return list.map((goodsItem) => {
            const dealUnitPrice = Number(goodsItem.display_price || goodsItem.promotion_price || goodsItem.retail_price || 0);
            return {
                user_id: Number(userId || 0),
                order_id: Number(orderId || 0),
                goods_id: goodsItem.goods_id,
                product_id: goodsItem.product_id,
                goods_name: goodsItem.goods_name,
                goods_aka: goodsItem.goods_aka,
                list_pic_url: goodsItem.list_pic_url,
                retail_price: Number(dealUnitPrice.toFixed(2)),
                number: goodsItem.number,
                goods_specifition_name_value: goodsItem.goods_specifition_name_value,
                goods_specifition_ids: goodsItem.goods_specifition_ids
            };
        });
    }

    async createOrderWithItems({
        orderInfo = {},
        pricedGoodsList = [],
        userId = 0,
        selectedCoupons = [],
        consumeCouponDirect = false
    } = {}) {
        const orderPayload = Object.assign({}, orderInfo);
        const transactionModel = this.model('order');
        const couponService = think.service('coupon', 'api');
        const requestId = String(this.ctx && this.ctx.state && this.ctx.state.requestId || '');
        const createOrderSn = () => {
            if (transactionModel && typeof transactionModel.generateOrderNumber === 'function') {
                return transactionModel.generateOrderNumber();
            }
            return orderSnUtil.generateOrderSn();
        };

        await orderSnUtil.withOrderSnRetry({
            maxRetries: 3,
            context: 'api.service.order.createOrderWithItems',
            logger: think.logger,
            requestId,
            createOrderSn,
            execute: async (orderSn) => {
                orderPayload.order_sn = orderSn;
                delete orderPayload.id;
                await transactionModel.transaction(async () => {
                    const bindModel = (name) => {
                        const model = transactionModel.model(name);
                        model.db(transactionModel.db());
                        return model;
                    };
                    const orderModel = bindModel('order');
                    const orderGoodsModel = bindModel('order_goods');
                    const orderId = await orderModel.add(orderPayload);
                    orderPayload.id = orderId;
                    if (!orderId) {
                        throw new Error('订单提交失败');
                    }

                    const orderGoodsData = this.buildOrderGoodsData({
                        orderId,
                        userId,
                        pricedGoodsList
                    });
                    if (orderGoodsData.length > 0) {
                        await orderGoodsModel.addMany(orderGoodsData);
                    }

                    if ((selectedCoupons || []).length > 0) {
                        await couponService.lockOrConsumeCouponsForOrder({
                            userId: Number(userId || 0),
                            orderId,
                            selectedCoupons,
                            consumeDirect: consumeCouponDirect,
                            transactionModel
                        });
                    }
                });
            }
        });

        return orderPayload;
    }
};
