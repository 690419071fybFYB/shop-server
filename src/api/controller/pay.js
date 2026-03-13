const Base = require('./base.js');
module.exports = class extends Base {
    isTestPayEndpointEnabled() {
        const features = think.config('features') || {};
        const fromConfig = features.enableTestPayEndpoint;
        const fromEnv = process.env.ENABLE_TEST_PAY_ENDPOINT;
        const raw = String(fromEnv !== undefined ? fromEnv : fromConfig || '').toLowerCase();
        return ['1', 'true', 'yes', 'on'].includes(raw);
    }

    buildMockPayNotifyResult(orderInfo) {
        const now = new Date();
        const pad = (v) => String(v).padStart(2, '0');
        const timeEnd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        return {
            out_trade_no: orderInfo.order_sn,
            transaction_id: `mock_tx_${Date.now()}`,
            time_end: timeEnd
        };
    }

    /**
     * 获取支付的请求参数
     * @returns {Promise<PreventPromise|void|Promise>}
     */
    // 测试时付款，将真实接口注释。 在小程序的services/pay.js中按照提示注释和打开
    async preWeixinPayaAction() {
        if (!this.isTestPayEndpointEnabled()) {
            return this.fail(404, '接口不存在');
        }
        if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
            return this.fail(404, '接口不存在');
        }
        const userId = this.requireLoginUserId();
        if (userId <= 0) {
            return;
        }
        const orderId = this.get('orderId');
        const orderInfo = await this.model('order').where({
            id: orderId,
            user_id: userId,
            is_delete: 0
        }).find();
        if (think.isEmpty(orderInfo)) {
            return this.fail(404, '订单不存在');
        }
        if (parseInt(orderInfo.pay_status, 10) === 2) {
            return this.fail(400, '订单已支付，请不要重复操作');
        }
        if (!(orderInfo.order_type == 0 || orderInfo.order_type == 1 || orderInfo.order_type == 2 || orderInfo.order_type == 8)) {
            return this.fail(400, '当前订单类型暂不支持测试支付');
        }
        const result = this.buildMockPayNotifyResult(orderInfo);
        if (Number(orderInfo.order_type) === 2) {
            const grouponService = this.service('groupon', 'api');
            await grouponService.handleOrderPaid(orderInfo.id, {
                requestId: String(this.ctx.state.requestId || ''),
                payResult: result
            });
        } else if (Number(orderInfo.order_type) === 8) {
            const vipService = this.service('vip', 'api');
            await vipService.handleOrderPaid(orderInfo.id, {
                requestId: String(this.ctx.state.requestId || ''),
                payResult: result
            });
        } else {
            const orderModel = this.model('order');
            await orderModel.updatePayData(orderInfo.id, result);
            const couponService = this.service('coupon', 'api');
            const promotionService = this.service('promotion', 'api');
            await couponService.consumeCouponsForOrder(orderInfo.id);
            try {
                await promotionService.consumeSeckillLocks(orderInfo.id);
            } catch (err) {
                think.logger && think.logger.warn && think.logger.warn(`[pay.preWeixinPaya.consumeSeckillLocks] ${err.message || err}`);
            }
            await this.afterPay(orderInfo);
        }
        return this.success({
            orderId: orderInfo.id,
            transactionId: result.transaction_id,
            testMode: true
        });
    }
    // 真实的付款接口
    async preWeixinPayAction() {
        const userId = this.requireLoginUserId();
        if (userId <= 0) {
            return;
        }
        const orderId = this.get('orderId');
        const orderInfo = await this.model('order').where({
            id: orderId,
            user_id: userId
        }).find();
        if (think.isEmpty(orderInfo)) {
            return this.fail(404, '订单不存在');
        }
        // 再次确认库存和价格
        let orderGoods = await this.model('order_goods').where({
            order_id:orderId,
            user_id: userId,
            is_delete:0
        }).select();
        let checkPrice = 0;
        let checkStock = 0;
        for(const item of orderGoods){
            let product = await this.model('product').where({
                id:item.product_id
            }).find();
            if(item.number > product.goods_number){
                checkStock++;
            }
            if(item.retail_price != product.retail_price){
                checkPrice++;
            }
        }
        if(checkStock > 0){
            return this.fail(400, '库存不足，请重新下单');
        }
        if(checkPrice > 0){
            return this.fail(400, '价格发生变化，请重新下单');
        }
        if (parseInt(orderInfo.pay_status) !== 0) {
            return this.fail(400, '订单已支付，请不要重复操作');
        }
        if (!(orderInfo.order_type == 0 || orderInfo.order_type == 1 || orderInfo.order_type == 2 || orderInfo.order_type == 8)) {
            return this.fail(400, '当前订单类型暂不支持在线支付');
        }
        const nowTs = parseInt(Date.now() / 1000, 10);
        const payExpireAt = Number(orderInfo.pay_expire_at || 0);
        if (payExpireAt > 0 && nowTs > payExpireAt) {
            return this.fail(400, '订单已超时关闭，请重新下单');
        }
        const openid = await this.model('user').where({
            id: orderInfo.user_id
        }).getField('weixin_openid', true);
        if (think.isEmpty(openid)) {
            return this.fail(400, '微信支付失败，没有openid');
        }
        const WeixinSerivce = this.service('weixin', 'api');
        try {
            const returnParams = await WeixinSerivce.createUnifiedOrder({
                openid: openid,
                body: '[海风小店]：' + orderInfo.order_sn,
                out_trade_no: orderInfo.order_sn,
                total_fee: parseInt(orderInfo.actual_price * 100),
                spbill_create_ip: ''
            });
            return this.success(returnParams);
        } catch (err) {
            return this.fail(400, '微信支付失败?');
        }
    }
    async notifyAction() {
        const WeixinSerivce = this.service('weixin', 'api');
        const result = WeixinSerivce.payNotify(this.post('xml'));
        
        if (!result) {
            let echo = 'FAIL';
            return this.json(echo);
        }
        const orderModel = this.model('order');
        const orderInfo = await orderModel.getOrderByOrderSn(result.out_trade_no);
        if (think.isEmpty(orderInfo)) {
            let echo = 'FAIL';
            return this.json(echo);
        }
        let bool = await orderModel.checkPayStatus(orderInfo.id);
        if (bool == true) {
            if (orderInfo.order_type == 0 || orderInfo.order_type == 1) { //普通订单和秒杀订单
                await orderModel.updatePayData(orderInfo.id, result);
                const couponService = this.service('coupon', 'api');
                const promotionService = this.service('promotion', 'api');
                await couponService.consumeCouponsForOrder(orderInfo.id);
                try {
                    await promotionService.consumeSeckillLocks(orderInfo.id);
                } catch (err) {
                    think.logger && think.logger.warn && think.logger.warn(`[pay.notify.consumeSeckillLocks] ${err.message || err}`);
                }
                this.afterPay(orderInfo);
            } else if (Number(orderInfo.order_type) === 2) {
                const grouponService = this.service('groupon', 'api');
                await grouponService.handleOrderPaid(orderInfo.id, {
                    requestId: String(this.ctx.state.requestId || ''),
                    payResult: result
                });
            } else if (Number(orderInfo.order_type) === 8) {
                const vipService = this.service('vip', 'api');
                await vipService.handleOrderPaid(orderInfo.id, {
                    requestId: String(this.ctx.state.requestId || ''),
                    payResult: result
                });
            } else {
                return '<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[订单类型不支持]]></return_msg></xml>';
            } 
        } else {
            return '<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[订单已支付]]></return_msg></xml>';
        }
        let echo = 'SUCCESS'
        return this.json(echo);
    }
    async afterPay(orderInfo) {
        if (orderInfo.order_type == 0 || orderInfo.order_type == 1) {
            let orderGoodsList = await this.model('order_goods').where({
                order_id: orderInfo.id
            }).select();
            for (const cartItem of orderGoodsList) {
                let goods_id = cartItem.goods_id;
                let product_id = cartItem.product_id;
                let number = cartItem.number;
                let specification = cartItem.goods_specifition_name_value;
                await this.model('goods').where({
                    id: goods_id
                }).decrement('goods_number', number);
                await this.model('goods').where({
                    id: goods_id
                }).increment('sell_volume', number);
                await this.model('product').where({
                    id: product_id
                }).decrement('goods_number', number);
            }
            // version 1.01
        }
    }
};
