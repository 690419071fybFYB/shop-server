module.exports = class extends think.Model {
    normalizeUserId(userId) {
        const fromArg = Number(userId || 0);
        if (fromArg > 0) {
            return fromArg;
        }
        const fromCtx = Number(this.ctx && this.ctx.state && this.ctx.state.userId || 0);
        if (fromCtx > 0) {
            return fromCtx;
        }
        return 0;
    }
    /**
     * 获取购物车的商品
     * @returns {Promise.<*>}
     */
    async getGoodsList(userId) {
        const uid = this.normalizeUserId(userId);
        if (uid <= 0) {
            return [];
        }
        const goodsList = await this.model('cart').where({
            user_id: uid,
            is_delete: 0
        }).select();
        return goodsList;
    }
    /**
     * 获取购物车的选中的商品
     * @returns {Promise.<*>}
     */
    async getCheckedGoodsList(userId) {
        const uid = this.normalizeUserId(userId);
        if (uid <= 0) {
            return [];
        }
        const goodsList = await this.model('cart').where({
            user_id: uid,
            checked: 1,
            is_delete: 0
        }).select();
        return goodsList;
    }
    /**
     * 清空已购买的商品
     * @returns {Promise.<*>}
     */
    async clearBuyGoods(userId) {
        const uid = this.normalizeUserId(userId);
        if (uid <= 0) {
            return 0;
        }
        const $res = await this.model('cart').where({
            user_id: uid,
            checked: 1,
            is_delete: 0
        }).update({
            is_delete: 1
        });
        return $res;
    }
};
