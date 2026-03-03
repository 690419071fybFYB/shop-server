const Base = require('./base.js');
module.exports = class extends Base {
    /**
     * 获取分类栏目数据
     * @returns {Promise.<Promise|void|PreventPromise>}
     */
    async indexAction() {
        const categoryId = this.get('id');
        const model = this.model('category');
        const data = await model.limit(10).where({
            parent_id: 0,
            is_category: 1
        }).order('sort_order ASC').select();
        let currentCategory = null;
        if (categoryId) {
            currentCategory = await model.where({
                'id': categoryId
            }).find();
        }
        if (think.isEmpty(currentCategory)) {
            currentCategory = data[0];
        }
        return this.success({
            categoryList: data,
        });
    }
    async currentAction() {
        const categoryId = this.get('id');
        let data = await this.model('category').where({
            id: categoryId
        }).field('id,name,img_url,p_height').find();
        return this.success(data);
    }
    async currentlistAction() {
        const page = this.post('page');
        const size = this.post('size');
        const categoryId = this.post('id');
        const where = {
            is_on_sale: 1,
            is_delete: 0
        };
        if (Number(categoryId) !== 0) {
            where.category_id = categoryId;
        }
        let list = await this.model('goods').where(where).order({
            sort_order: 'asc'
        }).field('name,id,goods_brief,min_retail_price,list_pic_url,goods_number').page(page, size).countSelect();
        if (Array.isArray(list.data) && list.data.length > 0) {
            const userId = this.getLoginUserId();
            if (Number(userId) > 0) {
                try {
                    const couponService = this.service('coupon', 'api');
                    list.data = await couponService.decorateGoodsWithCouponPromo(userId, list.data);
                } catch (err) {
                    think.logger && think.logger.error && think.logger.error(`[catalog.currentlist.decorateGoodsWithCouponPromo] ${err.message || err}`);
                }
            }
        }
        return this.success(list);
    }
};
