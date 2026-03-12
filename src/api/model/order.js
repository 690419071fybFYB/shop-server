const orderSnUtil = require('../../common/utils/order_sn');

const ORDER_STATUS_BY_SHOW_TYPE = Object.freeze({
    0: Object.freeze([101, 102, 103, 201, 202, 203, 300, 301, 302, 303, 401, 501, 801, 802]),
    1: Object.freeze([101, 801]),
    2: Object.freeze([300]),
    3: Object.freeze([301]),
    4: Object.freeze([302, 303])
});

const ORDER_STATUS_TEXT_MAP = Object.freeze({
    101: '待付款',
    102: '交易关闭',
    103: '交易关闭',
    201: '待发货',
    202: '退款中',
    203: '已退款',
    300: '待发货',
    301: '已发货',
    302: '待评价',
    303: '待评价',
    401: '交易成功',
    501: '售后处理中',
    801: '拼团待付款',
    802: '拼团中'
});

module.exports = class extends think.Model {
    /**
     * 生成订单的编号order_sn
     * @returns {string}
     */
    generateOrderNumber() {
        return orderSnUtil.generateOrderSn();
    }
    getOrderStatus(showType) {
        const status = ORDER_STATUS_BY_SHOW_TYPE[Number(showType)];
        if (!Array.isArray(status)) {
            return null;
        }
        return status.slice();
    }
    /**
     * 获取订单可操作的选项
     * @param orderId
     */
    async getOrderHandleOption(orderId, userId) {
        const handleOption = {
            cancel: false, // 取消操作
            delete: false, // 删除操作
            pay: false, // 支付操作
            confirm: false, // 确认收货完成订单操作
            cancel_refund: false
        };
        const where = {
            id: orderId
        };
        if (Number(userId) > 0) {
            where.user_id = userId;
        }
        const orderInfo = await this.where(where).find();
        if (think.isEmpty(orderInfo)) {
            return handleOption;
        }
        // 订单流程：下单成功－》支付订单－》发货－》收货－》评论
        // 订单相关状态字段设计，采用单个字段表示全部的订单状态
        // 1xx表示订单取消和删除等状态：  101订单创建成功等待付款、102订单已取消、103订单已取消(自动)
        // 2xx表示订单支付状态：        201订单已付款，等待发货、202订单取消，退款中、203已退款
        // 3xx表示订单物流相关状态：     300订单待发货，301订单已发货，302用户确认收货、303系统自动收货
        // 4xx表示订单完成的状态：      401已收货已评价
        // 5xx表示订单退换货相关的状态：  501售后处理中（退款/退货流程中）
        // 如果订单已经取消或是已完成，则可删除和再次购买
        // if (status == 101) "未付款";
        // if (status == 102) "已取消";
        // if (status == 103) "已取消(系统)";
        // if (status == 201) "已付款";
        // if (status == 300) "待发货";
        // if (status == 301) "已发货";
        // if (status == 302) "已收货";
        // if (status == 303) "已收货(系统)";
        // 已通过 crontab/timetask 自动将超期已确认订单置为完成
        // 订单刚创建，可以取消订单，可以继续支付
        if (orderInfo.order_status === 101 || orderInfo.order_status === 801) {
            handleOption.cancel = true;
            handleOption.pay = true;
        }
        // 如果订单被取消
        if (orderInfo.order_status === 102 || orderInfo.order_status === 103) {
            handleOption.delete = true;
        }
        // 如果订单已付款，没有发货，则可退款操作
        if (orderInfo.order_status === 201) {
            // handleOption.return = true;
        }
        // 如果订单申请退款中，没有相关操作
        if (orderInfo.order_status === 202) {
            handleOption.cancel_refund = true;
        }
        if (orderInfo.order_status === 300) {}
        // 如果订单已经退款，则可删除
        if (orderInfo.order_status === 203) {
            handleOption.delete = true;
        }
        // 如果订单已经发货，没有收货，则可收货操作,
        // 此时不能取消订单
        if (orderInfo.order_status === 301) {
            handleOption.confirm = true;
        }
        if (orderInfo.order_status === 401) {
            handleOption.delete = true;
        }
        return handleOption;
    }
    async getOrderTextCode(orderId) {
        const textCode = {
            pay: false,
            close: false,
            delivery: false,
            receive: false,
            success: false,
            countdown: false,
        };
        const orderInfo = await this.where({
            id: orderId
        }).find();
        if (orderInfo.order_status === 101 || orderInfo.order_status === 801) {
            textCode.pay = true;
            textCode.countdown = true;
        }
        if (orderInfo.order_status === 102 || orderInfo.order_status === 103) {
            textCode.close = true;
        }
        if (orderInfo.order_status === 201 || orderInfo.order_status === 300) { //待发货
            textCode.delivery = true;
        }
        if (orderInfo.order_status === 301) { //已发货
            textCode.receive = true;
        }
        if (orderInfo.order_status === 401) {
            textCode.success = true;
        }
        return textCode;
    }
    // if (status == 101) "未付款";
    // if (status == 102) "已取消";
    // if (status == 103) "已取消(系统)";
    // if (status == 201) "已付款";
    // if (status == 301) "已发货";
    // if (status == 302) "已收货";
    // if (status == 303) "已收货(系统)";
    // if (status == 401) "已完成";
    async getOrderStatusText(orderId) {
        const orderInfo = await this.where({
            id: orderId
        }).find();
        const orderStatus = Number(orderInfo.order_status || 0);
        return ORDER_STATUS_TEXT_MAP[orderStatus] || '待付款';
    }
    // 返回创建时间
    async getOrderAddTime(orderId) {
        const orderInfo = await this.where({
            id: orderId
        }).find();
        let add_time = orderInfo.add_time;
        return add_time;
    }
    // 支付时间
    async setOrderPayTime(orderId, payTime) {
        const orderInfo = await this.where({
            id: orderId
        }).update({
            pay_time,
            payTime
        });
        return orderInfo;
    }
    // 删除订单，将is_delete置为0
    async orderDeleteById(orderId, userId) {
        const where = {
            id: orderId
        };
        if (Number(userId) > 0) {
            where.user_id = userId;
        }
        return this.where(where).update({
            is_delete: 1
        });
    }
    /**
     * check订单状态
     * @param orderId
     * @param payStatus
     * @returns {Promise.<boolean>}
     */
    async checkPayStatus(orderId) {
        let info = await this.where({
            id: orderId,
            pay_status: 2
        }).select();
        let _length = info.length;
        if (_length > 0) {
            return false;
        } else {
            return true;
        }
    }
    /**
     * 更改订单支付状态
     * @param orderId
     * @param payStatus
     * @returns {Promise.<boolean>}
     */
    async updatePayStatus(orderId, payStatus = 0) {
        return this.where({
            id: orderId
        }).limit(1).update({
            pay_status: parseInt(payStatus)
        });
    }
    /**
     * 更改订单状态
     * @param orderId
     * @param order_Status
     * @returns {Promise.<boolean>}
     */
    async updateOrderStatus(orderId, orderStatus = 0) {
        return this.where({
            id: orderId
        }).limit(1).update({
            order_status: parseInt(orderStatus)
        });
    }
    /**
     * 根据订单编号查找订单信息
     * @param orderSn
     * @returns {Promise.<Promise|Promise<any>|T|*>}
     */
    async getOrderByOrderSn(orderSn) {
        if (think.isEmpty(orderSn)) {
            return {};
        }
        return this.where({
            order_sn: orderSn
        }).find();
    }
    /**
     * 更新订单状态,包括更新库存数据，现在可以开始写了
     * @param orderId
     * @param
     * @returns {Promise.<boolean>}
     */
    async updatePayData(orderId, info) {
        const orderInfo = await this.where({
            id: orderId
        }).field('id,order_type').find();
        const orderType = Number(orderInfo.order_type || 0);
        let data = {
            pay_status: 2,
            order_status: orderType === 2 ? 802 : 300,
            pay_id: info.transaction_id,
            pay_time: info.time_end
        }
        return this.where({
            id: orderId
        }).limit(1).update(data);
    }
};
