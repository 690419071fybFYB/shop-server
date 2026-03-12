const Base = require('./base.js');
const moment = require('moment');
const httpClient = require('../../common/utils/http');
module.exports = class extends Base {
    parseSelectedCouponIds(value) {
        const couponService = this.service('coupon', 'api');
        return couponService.normalizeIdList(value);
    }

    requireUserIdOrAbort() {
        const userId = this.requireLoginUserId();
        return userId > 0 ? userId : 0;
    }

    getCurrentUnixTime() {
        return Math.floor(Date.now() / 1000);
    }

    decodeBase64Text(value) {
        return Buffer.from(String(value || ''), 'base64').toString();
    }

    formatNullableUnixTime(value) {
        if (think.isEmpty(value)) {
            return 0;
        }
        return moment.unix(value).format('YYYY-MM-DD HH:mm:ss');
    }

    sumGoodsCount(goodsList = []) {
        return (Array.isArray(goodsList) ? goodsList : []).reduce((sum, goods) => {
            return sum + Number(goods.number || 0);
        }, 0);
    }

    isOrderAddressEditable(orderStatus) {
        const editableStatuses = new Set([101, 801]);
        return editableStatuses.has(Number(orderStatus));
    }

    async buildOrderFreightItems(orderId, userId) {
        const orderGoodsList = await this.model('order_goods').where({
            order_id: orderId,
            user_id: userId,
            is_delete: 0
        }).select();
        const freightItems = [];
        for (const item of orderGoodsList) {
            const goodsInfo = await this.model('goods').where({
                id: item.goods_id
            }).field('id,freight_template_id').find();
            const productInfo = await this.model('product').where({
                id: item.product_id
            }).field('id,goods_weight').find();
            freightItems.push({
                number: Number(item.number || 0),
                retail_price: Number(item.retail_price || 0),
                freight_template_id: Number(goodsInfo.freight_template_id || 0),
                goods_weight: Number(productInfo.goods_weight || 0)
            });
        }
        return freightItems;
    }

    async calculateOrderFreightPrice({orderId, userId, provinceId}) {
        const freightItems = await this.buildOrderFreightItems(orderId, userId);
        if (!Array.isArray(freightItems) || freightItems.length === 0) {
            return 0;
        }
        const freightService = this.service('freight', 'api');
        const freightPrice = await freightService.calculateFreightPrice({
            provinceId,
            items: freightItems
        });
        return Number(freightPrice || 0);
    }

    buildOrderPrintInfo(pricedGoodsList = []) {
        const list = Array.isArray(pricedGoodsList) ? pricedGoodsList : [];
        if (list.length === 0) {
            return '';
        }
        const segments = list.map((item, index) => `${index + 1}、${item.goods_aka}【${item.number}】`);
        return `${segments.join(' ')} `;
    }

    async ensureOwnedOrder(orderId, userId, {allowDeleted = false} = {}) {
        const orderInfo = await this.model('order').field('id,user_id,is_delete,order_status,order_type,goods_price,coupon_price,freight_price').where({
            id: orderId
        }).find();
        if (think.isEmpty(orderInfo)) {
            this.fail(404, '订单不存在');
            return null;
        }
        if (Number(orderInfo.user_id) !== Number(userId)) {
            this.failForbidden('无权限访问该订单');
            return null;
        }
        if (!allowDeleted && Number(orderInfo.is_delete) === 1) {
            this.fail(404, '订单不存在');
            return null;
        }
        return orderInfo;
    }
    /**
     * 获取订单列表
     * @return {Promise} []
     */
    async listAction() {
		// const userId = this.getLoginUserId();;
		const userId = this.getLoginUserId();
		const showType = this.get('showType');
        const page = this.get('page');
        const size = this.get('size');
        let status = [];
        status = await this.model('order').getOrderStatus(showType);
        let is_delete = 0;
        const orderList = await this.model('order').field('id,add_time,actual_price,freight_price,offline_pay').where({
            user_id: userId,
            is_delete: is_delete,
            order_type: ['<', 7],
            order_status: ['IN', status]
        }).page(page, size).order('add_time DESC').countSelect();
        const newOrderList = [];
        for (const item of orderList.data) {
            // 订单的商品
            item.goodsList = await this.model('order_goods').field('id,list_pic_url,number').where({
                user_id: userId,
                order_id: item.id,
                is_delete: 0
            }).select();
            item.goodsCount = 0;
            item.goodsList.forEach(v => {
                item.goodsCount += v.number;
            });
            item.add_time = moment.unix(await this.model('order').getOrderAddTime(item.id)).format('YYYY-MM-DD HH:mm:ss');
            // item.dealdone_time = moment.unix(await this.model('order').getOrderAddTime(item.id)).format('YYYY-MM-DD HH:mm:ss');
            // item.add_time =this.timestampToTime(await this.model('order').getOrderAddTime(item.id));
            // 订单状态的处理
            item.order_status_text = await this.model('order').getOrderStatusText(item.id);
            // 可操作的选项
            item.handleOption = await this.model('order').getOrderHandleOption(item.id, userId);
            newOrderList.push(item);
        }
        orderList.data = newOrderList;
        return this.success(orderList);
    }
    // 获得订单数量
    //
    async countAction() {
        const showType = this.get('showType');
		const userId = this.getLoginUserId();
        let status = [];
        status = await this.model('order').getOrderStatus(showType);
        let is_delete = 0;
        const allCount = await this.model('order').where({
            user_id: userId,
            is_delete: is_delete,
            order_status: ['IN', status]
        }).count('id');
        return this.success({
            allCount: allCount,
        });
    }
    // 获得订单数量状态
    //
    async orderCountAction() {
		// const user_id = this.getLoginUserId();;
		const user_id = this.getLoginUserId();
        if(user_id != 0){
            let toPay = await this.model('order').where({
                user_id: user_id,
                is_delete: 0,
                order_type: ['<', 7],
                order_status: ['IN', '101,801']
            }).count('id');
            let toDelivery = await this.model('order').where({
                user_id: user_id,
                is_delete: 0,
                order_type: ['<', 7],
                order_status: 300
            }).count('id');
            let toReceive = await this.model('order').where({
                user_id: user_id,
                order_type: ['<', 7],
                is_delete: 0,
                order_status: 301
            }).count('id');
            let newStatus = {
                toPay: toPay,
                toDelivery: toDelivery,
                toReceive: toReceive,
            }
            return this.success(newStatus);
        }
       
    }
    async detailAction() {
        const orderId = this.get('orderId');
		const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const orderInfo = await this.model('order').where({
            user_id: userId,
            id: orderId
        }).find();
        const currentTime = this.getCurrentUnixTime();
        if (think.isEmpty(orderInfo)) {
            return this.fail(404, '订单不存在');
        }
        orderInfo.province_name = await this.model('region').where({
            id: orderInfo.province
        }).getField('name', true);
        orderInfo.city_name = await this.model('region').where({
            id: orderInfo.city
        }).getField('name', true);
        orderInfo.district_name = await this.model('region').where({
            id: orderInfo.district
        }).getField('name', true);
        orderInfo.full_region = orderInfo.province_name + orderInfo.city_name + orderInfo.district_name;
        orderInfo.postscript = this.decodeBase64Text(orderInfo.postscript);
        const orderGoods = await this.model('order_goods').where({
            user_id: userId,
            order_id: orderId,
            is_delete: 0
        }).select();
        const goodsCount = this.sumGoodsCount(orderGoods);
        // 订单状态的处理
        orderInfo.order_status_text = await this.model('order').getOrderStatusText(orderId);
        orderInfo.confirm_time = this.formatNullableUnixTime(orderInfo.confirm_time);
        orderInfo.dealdone_time = this.formatNullableUnixTime(orderInfo.dealdone_time);
        orderInfo.pay_time = this.formatNullableUnixTime(orderInfo.pay_time);
        if (think.isEmpty(orderInfo.shipping_time)) {
            orderInfo.shipping_time = 0;
        } else {
            const shippingTime = Number(orderInfo.shipping_time || 0);
            orderInfo.confirm_remainTime = shippingTime + 10 * 24 * 60 * 60;
            orderInfo.shipping_time = moment.unix(shippingTime).format('YYYY-MM-DD HH:mm:ss');
        }
        // 订单支付倒计时
        if (orderInfo.order_status === 101 || orderInfo.order_status === 801) {
            // if (moment().subtract(60, 'minutes') < moment(orderInfo.add_time)) {
            orderInfo.final_pay_time = orderInfo.add_time + 24 * 60 * 60; //支付倒计时2小时
            if (orderInfo.final_pay_time < currentTime) {
                //超过时间不支付，更新订单状态为取消
                const updateInfo = {
                    order_status: 102
                };
                await this.model('order').where({
                    id: orderId
                }).update(updateInfo);
                const couponService = this.service('coupon', 'api');
                await couponService.releaseLockedCoupons(orderId);
                if (Number(orderInfo.order_type || 0) === 2) {
                    const grouponService = this.service('groupon', 'api');
                    await grouponService.handleUnpaidOrderClosed(orderId);
                }
            }
        }
        orderInfo.add_time = moment.unix(orderInfo.add_time).format('YYYY-MM-DD HH:mm:ss');
        orderInfo.order_status = '';
        // 订单可操作的选择,删除，支付，收货，评论，退换货
        const handleOption = await this.model('order').getOrderHandleOption(orderId, userId);
        const textCode = await this.model('order').getOrderTextCode(orderId);
        return this.success({
            orderInfo: orderInfo,
            orderGoods: orderGoods,
            handleOption: handleOption,
            textCode: textCode,
            goodsCount: goodsCount,
        });
    }
    /**
     * order 和 order-check 的goodslist
     * @return {Promise} []
     */
    async orderGoodsAction() {
		const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const orderId = this.get('orderId');
        if (orderId > 0) {
            const orderGoods = await this.model('order_goods').where({
                user_id: userId,
                order_id: orderId,
                is_delete: 0
            }).select();
            return this.success(orderGoods);
        } else {
            const cartList = await this.model('cart').where({
                user_id: userId,
                checked:1,
                is_delete: 0,
                is_fast: 0,
            }).select();
            return this.success(cartList);
        }
    }
    /**
     * 取消订单
     * @return {Promise} []
     */
    async cancelAction() {
        const orderId = this.post('orderId');
		const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const orderInfo = await this.ensureOwnedOrder(orderId, userId);
        if (!orderInfo) {
            return;
        }
        // 检测是否能够取消
        const handleOption = await this.model('order').getOrderHandleOption(orderId, userId);
        // console.log('--------------' + handleOption.cancel);
        if (!handleOption.cancel) {
            return this.fail(400, '订单不能取消');
        }
        // 设置订单已取消状态
        let updateInfo = {
            order_status: 102
        };
        if (Number(orderInfo.pay_status || 0) === 2) {
            // 已支付后取消才需要回补库存；待支付订单未扣减库存，避免重复回补。
            const goodsInfo = await this.model('order_goods').where({
                order_id: orderId,
                user_id: userId
            }).select();
            for (const item of goodsInfo) {
                let goods_id = item.goods_id;
                let product_id = item.product_id;
                let number = item.number;
                await this.model('goods').where({
                    id: goods_id
                }).increment('goods_number', number);
                await this.model('product').where({
                    id: product_id
                }).increment('goods_number', number);
            }
        }
        const succesInfo = await this.model('order').where({
            id: orderId,
            user_id: userId
        }).update(updateInfo);
        if (!succesInfo) {
            return this.fail(404, '订单不存在');
        }
        const couponService = this.service('coupon', 'api');
        await couponService.releaseLockedCoupons(orderId);
        if (Number(orderInfo.order_type || 0) === 2) {
            const grouponService = this.service('groupon', 'api');
            await grouponService.handleUnpaidOrderClosed(orderId);
        }
        return this.success(succesInfo);
    }
    /**
     * 删除订单
     * @return {Promise} []
     */
    async deleteAction() {
        const orderId = this.post('orderId');
        const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const orderInfo = await this.ensureOwnedOrder(orderId, userId, {allowDeleted: true});
        if (!orderInfo) {
            return;
        }
        // 检测是否能够取消
        const handleOption = await this.model('order').getOrderHandleOption(orderId, userId);
        if (!handleOption.delete) {
            return this.fail(400, '订单不能删除');
        }
        const succesInfo = await this.model('order').orderDeleteById(orderId, userId);
        if (!succesInfo) {
            return this.fail(404, '订单不存在');
        }
        return this.success(succesInfo);
    }
    /**
     * 确认订单
     * @return {Promise} []
     */
    async confirmAction() {
        const orderId = this.post('orderId');
        const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const orderInfo = await this.ensureOwnedOrder(orderId, userId);
        if (!orderInfo) {
            return;
        }
        // 检测是否能够取消
        const handleOption = await this.model('order').getOrderHandleOption(orderId, userId);
        if (!handleOption.confirm) {
            return this.fail(400, '订单不能确认');
        }
        // 设置订单已取消状态
        const currentTime = this.getCurrentUnixTime();
        const updateInfo = {
            order_status: 401,
            confirm_time: currentTime
        };
        const succesInfo = await this.model('order').where({
            id: orderId,
            user_id: userId
        }).update(updateInfo);
        if (!succesInfo) {
            return this.fail(404, '订单不存在');
        }
        return this.success(succesInfo);
    }
    /**
     * 完成评论后的订单
     * @return {Promise} []
     */
    async completeAction() {
        const orderId = this.get('orderId');
        const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const orderInfo = await this.ensureOwnedOrder(orderId, userId);
        if (think.isEmpty(orderInfo)) {
            return;
        }
        // 设置订单已完成
        const currentTime = this.getCurrentUnixTime();
        const updateInfo = {
            order_status: 401,
            dealdone_time: currentTime
        };
        const succesInfo = await this.model('order').where({
            id: orderId,
            user_id: userId
        }).update(updateInfo);
        return this.success(succesInfo);
    }
    /**
     * 提交订单
     * @returns {Promise.<void>}
     */
    async submitAction() {
        // 获取收货地址信息和计算运费
		const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const addressId = this.post('addressId');
        const freightPrice = Number(this.post('freightPrice') || 0);
        const offlinePay = Number(this.post('offlinePay') || 0);
        const selectedUserCouponIds = this.parseSelectedCouponIds(this.post('selectedUserCouponIds') || []);
        const postscript = String(this.post('postscript') || '');
        const buffer = Buffer.from(postscript); // 留言
        const checkedAddress = await this.model('address').where({
            id: addressId,
            user_id: userId
        }).find();
        if (think.isEmpty(checkedAddress)) {
            return this.fail('请选择收货地址');
        }
        // 获取要购买的商品
        const checkedGoodsList = await this.model('cart').where({
            user_id: userId,
            checked: 1,
            is_delete: 0
        }).select();
        if (think.isEmpty(checkedGoodsList)) {
            return this.fail('请选择商品');
        }
        let checkPrice = 0;
        let checkStock = 0;
        for (const item of checkedGoodsList) {
            const product = await this.model('product').where({
                id:item.product_id
            }).find();
            if (think.isEmpty(product) || item.number > product.goods_number) {
                checkStock++;
            }
            if (item.retail_price != item.add_price) {
                checkPrice++;
            }
        }
        if(checkStock > 0){
            return this.fail(400, '库存不足，请重新下单');
        }
        if(checkPrice > 0){
            return this.fail(400, '价格发生变化，请重新下单');
        }
        const promotionService = this.service('promotion', 'api');
        let pricedGoodsList = checkedGoodsList;
        try {
            pricedGoodsList = await promotionService.decorateCartItemsWithPromotion(checkedGoodsList);
        } catch (err) {
            think.logger && think.logger.error && think.logger.error(`[order.submit.promotionDecorate] ${err.message || err}`);
        }
        const pricedSummary = promotionService.summarizeCartItems(pricedGoodsList);
        const goodsTotalPrice = Number(pricedSummary.goodsTotalNumber || 0);
        const promotionPrice = Number(pricedSummary.promotionNumber || 0);

        const couponService = this.service('coupon', 'api');
        const couponCartItems = pricedGoodsList.map(item => Object.assign({}, item, {
            retail_price: item.display_price || item.promotion_price || item.retail_price
        }));
        const couponPreview = await couponService.previewCartCoupons({
            userId: userId,
            cartItems: couponCartItems,
            selectedUserCouponIds: selectedUserCouponIds,
            freightPrice: freightPrice
        });
        if (selectedUserCouponIds.length > 0 && (couponPreview.invalidSelectedIds || []).length > 0) {
            return this.fail(400, '优惠券不可用，请重新选择');
        }

        // 订单价格计算
        const orderTotalPrice = goodsTotalPrice + freightPrice; // 订单的总价
        const couponPrice = Number(couponPreview.couponPrice || 0);
        const totalPromotionPrice = Math.max(0, promotionPrice + couponPrice);
        const actualPrice = Math.max(0, Number(couponPreview.actualPrice || orderTotalPrice)); // 减去其它支付的金额后，要实际支付的金额 比如满减等优惠
        const currentTime = this.getCurrentUnixTime();
        const printInfo = this.buildOrderPrintInfo(pricedGoodsList);

        const orderInfo = {
            order_sn: this.model('order').generateOrderNumber(),
            user_id: userId,
            // 收货地址和运费
            consignee: checkedAddress.name,
            mobile: checkedAddress.mobile,
            province: checkedAddress.province_id,
            city: checkedAddress.city_id,
            district: checkedAddress.district_id,
            address: checkedAddress.address,
            order_status: 101, // 订单初始状态为 101
            // 根据城市得到运费，这里需要建立表：所在城市的具体运费
            freight_price: freightPrice,
            postscript: buffer.toString('base64'),
            add_time: currentTime,
            goods_price: goodsTotalPrice,
            order_price: orderTotalPrice,
            actual_price: actualPrice,
            change_price: actualPrice,
            coupon_price: couponPrice,
            promotions_price: Number(totalPromotionPrice.toFixed(2)),
            coupon_detail_json: JSON.stringify(couponPreview.selectedCoupons || []),
            print_info: printInfo,
            offline_pay:offlinePay
        };
        const orderService = this.service('order', 'api');
        const persistedOrderInfo = await orderService.createOrderWithItems({
            orderInfo,
            pricedGoodsList,
            userId,
            selectedCoupons: couponPreview.selectedCoupons || [],
            consumeCouponDirect: offlinePay === 1
        });
        await this.model('cart').clearBuyGoods(userId);
        return this.success({
            orderInfo: persistedOrderInfo
        });
    }
    async updateAction() {
        const addressId = this.post('addressId');
        const orderId = this.post('orderId');
        const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const currentOrder = await this.ensureOwnedOrder(orderId, userId);
        if (think.isEmpty(currentOrder)) {
            return;
        }
        if (!this.isOrderAddressEditable(currentOrder.order_status)) {
            return this.fail(400, '当前订单状态不支持修改地址');
        }
        // 备注
        // let postscript = this.post('postscript');
        // const buffer = Buffer.from(postscript);
        const updateAddress = await this.model('address').where({
            id: addressId,
            user_id: userId,
            is_delete: 0
        }).find();
        if (think.isEmpty(updateAddress)) {
            return this.fail(400, '收货地址不存在');
        }
        const freightPrice = await this.calculateOrderFreightPrice({
            orderId,
            userId,
            provinceId: updateAddress.province_id
        });
        const goodsPrice = Number(currentOrder.goods_price || 0);
        const couponPrice = Number(currentOrder.coupon_price || 0);
        const orderPrice = Number((goodsPrice + freightPrice).toFixed(2));
        const actualPrice = Math.max(0, Number((orderPrice - couponPrice).toFixed(2)));
        const orderInfo = {
            // 收货地址和运费
            consignee: updateAddress.name,
            mobile: updateAddress.mobile,
            province: updateAddress.province_id,
            city: updateAddress.city_id,
            district: updateAddress.district_id,
            address: updateAddress.address,
            freight_price: freightPrice,
            order_price: orderPrice,
            actual_price: actualPrice,
            change_price: actualPrice,
            // 备注
            // postscript: buffer.toString('base64'),
            // add_time: currentTime
        };
        const updateInfo = await this.model('order').where({
            id: orderId,
            user_id: userId
        }).update(orderInfo);
        return this.success(updateInfo);
    }
    /**
     * 查询物流信息asd
     * @returns {Promise.<void>}
     */
    async expressAction() {
        const currentTime = this.getCurrentUnixTime();
        const orderId = this.get('orderId');
        const userId = this.requireUserIdOrAbort();
        if (!userId) {
            return;
        }
        const orderInfo = await this.ensureOwnedOrder(orderId, userId);
        if (think.isEmpty(orderInfo)) {
            return;
        }
        const expressInfo = await this.model('order_express').where({
            order_id: orderId
        }).find();
        if (think.isEmpty(expressInfo)) {
            return this.fail(400, '暂无物流信息');
        }
        // 如果is_finish == 1；或者 updateTime 小于 1分钟，
        let updateTime = expressInfo.update_time;
        let com = (currentTime - updateTime) / 60;
        let is_finish = expressInfo.is_finish;
        if (is_finish == 1) {
            return this.success(expressInfo);
        } else if (updateTime != 0 && com < 20) {
            return this.success(expressInfo);
        } else {
            let shipperCode = expressInfo.shipper_code;
            let expressNo = expressInfo.logistic_code;
            let lastExpressInfo = await this.getExpressInfo(shipperCode, expressNo);
            let deliverystatus = lastExpressInfo.deliverystatus;
            let newUpdateTime = lastExpressInfo.updateTime;
            newUpdateTime = parseInt(new Date(newUpdateTime).getTime() / 1000);
            deliverystatus = await this.getDeliverystatus(deliverystatus);
            let issign = lastExpressInfo.issign;
            let traces = lastExpressInfo.list;
            traces = JSON.stringify(traces);
            let dataInfo = {
                express_status: deliverystatus,
                is_finish: issign,
                traces: traces,
                update_time: newUpdateTime
            }
            await this.model('order_express').where({
                order_id: orderId
            }).update(dataInfo);
            let express = await this.model('order_express').where({
                order_id: orderId
            }).find();
            return this.success(express);
        }
        // return this.success(latestExpressInfo);
    }
    async getExpressInfo(shipperCode, expressNo) {
        const aliConfig = think.config('aliexpress') || {};
        const aliUrl = String(aliConfig.url || '').trim();
        const aliAppCode = String(aliConfig.appcode || '').trim();
        if (!aliUrl || !aliAppCode) {
            throw new Error('[order.getExpressInfo] missing config: aliexpress.url/aliexpress.appcode');
        }
        const appCode = `APPCODE ${aliAppCode}`;
        const queryNo = encodeURIComponent(String(expressNo || ''));
        const queryType = encodeURIComponent(String(shipperCode || ''));
        const options = {
            method: 'GET',
            url: `${aliUrl}?no=${queryNo}&type=${queryType}`,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": appCode
            }
        };
        const sessionData = await httpClient.requestJson(options);
        return sessionData.result;
    }
    async getDeliverystatus(status) {
        if (status == 0) {
            return '快递收件(揽件)';
        } else if (status == 1) {
            return '在途中';
        } else if (status == 2) {
            return '正在派件';
        } else if (status == 3) {
            return '已签收';
        } else if (status == 4) {
            return '派送失败(无法联系到收件人或客户要求择日派送，地址不详或手机号不清)';
        } else if (status == 5) {
            return '疑难件(收件人拒绝签收，地址有误或不能送达派送区域，收费等原因无法正常派送)';
        } else if (status == 6) {
            return '退件签收';
        }
    }
};
