const Base = require('./base.js');

module.exports = class extends Base {
    normalizeId(value) {
        const normalized = Number(value);
        if (!Number.isFinite(normalized)) {
            return 0;
        }
        return Math.max(0, Math.floor(normalized));
    }

    normalizeText(value) {
        return String(value || '').trim();
    }

    parseStatus(value) {
        const normalized = this.normalizeText(value).toLowerCase();
        if (!normalized) {
            return 'all';
        }
        if (['all', 'ongoing', 'success', 'failed'].includes(normalized)) {
            return normalized;
        }
        return 'all';
    }

    grouponService() {
        return this.service('groupon', 'api');
    }

    async activityListAction() {
        try {
            const goodsId = this.normalizeId(this.get('goodsId') || this.get('goods_id') || 0);
            const page = this.normalizeId(this.get('page') || 1) || 1;
            const size = this.normalizeId(this.get('size') || 10) || 10;
            const data = await this.grouponService().listActivities({
                goodsId,
                page,
                size
            });
            return this.success(data);
        } catch (error) {
            return this.fail(400, error.message || '获取拼团活动失败');
        }
    }

    async activityDetailAction() {
        try {
            const activityId = this.normalizeId(this.get('activityId') || this.get('id') || 0);
            if (activityId <= 0) {
                return this.fail(400, 'activityId 不能为空');
            }
            const data = await this.grouponService().getActivityDetail(activityId);
            return this.success(data);
        } catch (error) {
            return this.fail(400, error.message || '获取拼团活动详情失败');
        }
    }

    async teamDetailAction() {
        try {
            const teamId = this.normalizeId(this.get('teamId') || this.get('id') || 0);
            if (teamId <= 0) {
                return this.fail(400, 'teamId 不能为空');
            }
            const data = await this.grouponService().getTeamDetail(teamId);
            return this.success(data);
        } catch (error) {
            return this.fail(400, error.message || '获取拼团详情失败');
        }
    }

    async checkoutAction() {
        const userId = this.requireLoginUserId();
        if (userId <= 0) {
            return;
        }
        const selectedUserCouponIds = this.normalizeText(this.get('selectedUserCouponIds') || '');
        if (selectedUserCouponIds) {
            return this.fail(400, '拼团订单不支持叠加优惠券');
        }
        try {
            const activityId = this.normalizeId(this.get('activityId') || this.get('grouponActivityId') || 0);
            const teamId = this.normalizeId(this.get('teamId') || 0);
            const addressId = this.normalizeId(this.get('addressId') || 0);
            if (activityId <= 0) {
                return this.fail(400, 'activityId 不能为空');
            }
            const data = await this.grouponService().checkout({
                userId,
                activityId,
                teamId,
                addressId
            });
            return this.success(data);
        } catch (error) {
            return this.fail(400, error.message || '拼团结算失败');
        }
    }

    async submitAction() {
        const userId = this.requireLoginUserId();
        if (userId <= 0) {
            return;
        }
        const selectedUserCouponIds = this.normalizeText(this.post('selectedUserCouponIds') || '');
        if (selectedUserCouponIds) {
            return this.fail(400, '拼团订单不支持叠加优惠券');
        }
        const activityId = this.normalizeId(this.post('activityId') || this.post('grouponActivityId') || 0);
        const teamId = this.normalizeId(this.post('teamId') || 0);
        const addressId = this.normalizeId(this.post('addressId') || 0);
        const postscript = this.normalizeText(this.post('postscript') || '');
        const offlinePay = this.normalizeId(this.post('offlinePay') || 0);

        if (activityId <= 0) {
            return this.fail(400, 'activityId 不能为空');
        }
        try {
            const requestId = String(this.ctx.state.requestId || '');
            const result = await this.grouponService().createOrderWithTeamMember({
                userId,
                activity: {
                    id: activityId
                },
                teamId,
                address: await this.grouponService().resolveCheckoutAddress(userId, addressId),
                postscript,
                offlinePay,
                requestId
            });
            return this.success(result);
        } catch (error) {
            return this.fail(400, error.message || '拼团下单失败');
        }
    }

    async myTeamsAction() {
        const userId = this.requireLoginUserId();
        if (userId <= 0) {
            return;
        }
        try {
            const status = this.parseStatus(this.get('status') || 'all');
            const page = this.normalizeId(this.get('page') || 1) || 1;
            const size = this.normalizeId(this.get('size') || 10) || 10;
            const data = await this.grouponService().listMyTeams({
                userId,
                status,
                page,
                size
            });
            return this.success(data);
        } catch (error) {
            return this.fail(400, error.message || '获取我的拼团失败');
        }
    }
};
