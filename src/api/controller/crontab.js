const Base = require('./base.js');
const moment = require('moment');
module.exports = class extends Base {
    getOrderAutoCompleteDays() {
        const configured = Number(process.env.ORDER_AUTO_COMPLETE_DAYS || 7);
        if (!Number.isFinite(configured)) {
            return 7;
        }
        return Math.max(1, Math.floor(configured));
    }

    resolveOrderCompleteBaseTime(orderInfo = {}) {
        const confirmTime = Number(orderInfo.confirm_time || 0);
        if (confirmTime > 0) {
            return confirmTime;
        }
        return Number(orderInfo.shipping_time || 0);
    }

    async autoCompleteConfirmedOrders(currentTime) {
        const now = Number(currentTime || Math.floor(Date.now() / 1000));
        const autoCompleteDays = this.getOrderAutoCompleteDays();
        const deadline = now - autoCompleteDays * 24 * 60 * 60;
        const candidateList = await this.model('order').where({
            order_status: ['IN', [302, 303]],
            is_delete: 0
        }).field('id,confirm_time,shipping_time').select();
        const orderIds = [];
        for (const item of candidateList) {
            const baseTime = this.resolveOrderCompleteBaseTime(item);
            if (baseTime > 0 && baseTime <= deadline) {
                orderIds.push(Number(item.id));
            }
        }
        if (orderIds.length === 0) {
            return 0;
        }
        return this.model('order').where({
            id: ['IN', orderIds]
        }).update({
            order_status: 401,
            dealdone_time: now
        });
    }

    async timetaskAction() {
        console.log("=============开始============");
        let currentTime = parseInt(new Date().getTime() / 1000);
        let newday = new Date(new Date().setHours(3, 0, 0, 0)) / 1000;
        let newday_over = new Date(new Date().setHours(3, 0, 59, 0)) / 1000;
        if (currentTime > newday && currentTime < newday_over) {
        }
        // 将公告下掉
        let notice = await this.model('notice').where({
            is_delete: 0
        }).select();
        if (notice.length > 0) {
            for (const noticeItem of notice) {
                let notice_exptime = noticeItem.end_time;
                if (currentTime > notice_exptime) {
                    await this.model('notice').where({
                        id: noticeItem.id
                    }).update({
                        is_delete: 1
                    });
                }
            }
        }
        const expiretime = parseInt(new Date().getTime() / 1000) - 24 * 60 * 60;
        const orderList = await this.model('order').where(`order_status IN (101,801) AND is_delete = 0 AND ((pay_expire_at > 0 AND pay_expire_at < ${currentTime}) OR (pay_expire_at = 0 AND add_time < ${expiretime}))`).select();
        if (orderList.length != 0) {
            // await this.model('order').where({id: ['IN', orderList.map((ele) => ele.id)]}).update({order_status: 102});
            const couponService = this.service('coupon', 'api');
            const promotionService = this.service('promotion', 'api');
            const grouponService = this.service('groupon', 'api');
            for (const item of orderList) {

                let orderId = item.id;
                await this.model('order').where({
                    id: orderId
                }).update({
                    order_status: 102
                });
                await couponService.releaseLockedCoupons(orderId);
                try {
                    await promotionService.releaseSeckillLocks(orderId);
                } catch (err) {
                    think.logger && think.logger.warn && think.logger.warn(`[crontab.releaseSeckillLocks] ${err.message || err}`);
                }
                if (Number(item.order_type || 0) === 2) {
                    try {
                        await grouponService.handleUnpaidOrderClosed(orderId);
                    } catch (err) {
                        think.logger && think.logger.warn && think.logger.warn(`[crontab.handleUnpaidOrderClosed] orderId=${orderId} ${err.message || err}`);
                    }
                }
            }
        }
        // 定时将到期的广告停掉
        let ad_info = await this.model('ad').where({
            end_time: ['<', currentTime],
            enabled: 1
        }).select();
        if (ad_info.length != 0) {
            await this.model('ad').where({
                id: ['IN', ad_info.map((ele) => ele.id)]
            }).update({
                enabled: 0
            });
        }
        //定时将长时间没收货的订单确认收货
        const noConfirmTime = parseInt(new Date().getTime() / 1000) - 5 * 24 * 60 * 60;
        // 5天没确认收货就自动确认
        let noConfirmList = await this.model('order').where({
            order_status: 301,
            shipping_time: {
                '<=': noConfirmTime,
                '<>': 0
            },
            is_delete: 0,
        }).select();
        if (noConfirmList.length != 0) {
            for (const citem of noConfirmList) {
                let orderId = citem.id;
                await this.model('order').where({
                    id: orderId
                }).update({
                    order_status: 401,
                    confirm_time: currentTime
                });
            }
        }
        await this.autoCompleteConfirmedOrders(currentTime);
        const couponService = this.service('coupon', 'api');
        await couponService.expireCouponsBatch();
        const promotionService = this.service('promotion', 'api');
        try {
            await promotionService.releaseExpiredSeckillLocksBatch(currentTime);
        } catch (err) {
            think.logger && think.logger.warn && think.logger.warn(`[crontab.releaseExpiredSeckillLocksBatch] ${err.message || err}`);
        }
        const grouponService = this.service('groupon', 'api');
        try {
            await grouponService.expireTeamsAndCreateRefundTasks(currentTime);
        } catch (err) {
            think.logger && think.logger.error && think.logger.error(`[crontab.grouponExpireScan] ${err.message || err}`);
        }
        return this.success();
    }
    async resetSqlAction() {
        let time = parseInt(new Date().getTime() / 1000 + 300);
        let info = await this.model('settings').where({id:1}).find();
        if(info.reset == 0){
            await this.model('settings').where({id:1}).update({countdown:time,reset:1});
            console.log('重置了！');
            return this.success({ reset: 1 });
        }
        console.log('还没到呢！');
        return this.success({ reset: Number(info.reset || 0) });
    }
    async processGoodsImportTaskAction() {
        try {
            const service = this.service('goods_import', 'admin');
            const result = await service.processNextPendingTask();
            return this.success(result);
        } catch (error) {
            console.error('处理商品导入任务失败:', error);
            return this.fail(500, error.message || '处理商品导入任务失败');
        }
    }
};
