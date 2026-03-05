const Base = require('./base.js');
const moment = require('moment');
module.exports = class extends Base {
    async indexAction() {
        const model = this.model('goods');
        const goodsList = await model.select();
        return this.success(goodsList);
    }
    /**
     * 商品详情页数据
     * @returns {Promise.<Promise|PreventPromise|void>}
     */
    async detailAction() {
        const goodsId = this.get('id');
		const userId = this.getLoginUserId();;
        const model = this.model('goods');
        const normalizePrice = (value, fallback = 0) => {
            if (typeof value === 'number') {
                return Number.isNaN(value) ? fallback : value;
            }
            const text = String(value || '').trim();
            if (!text) return fallback;
            if (text.includes('-')) {
                const first = Number(text.split('-')[0]);
                return Number.isNaN(first) ? fallback : first;
            }
            const num = Number(text);
            return Number.isNaN(num) ? fallback : num;
        };
        let info = await model.where({
            id: goodsId,
			is_delete:0
        }).find();
		if(think.isEmpty(info)){
			return this.fail('该商品不存在或已下架');
		}
        const gallery = await this.model('goods_gallery').where({
            goods_id: goodsId,
            is_delete: 0,
        }).order('sort_order').limit(6).select();
        await this.model('footprint').addFootprint(userId, goodsId);
        let productList = await model.getProductList(goodsId);
        let goodsNumber = 0;
        for (const item of productList) {
            if (item.goods_number > 0) {
                goodsNumber = goodsNumber + item.goods_number;
            }
        }
        let specificationList = await model.getSpecificationList(goodsId);
        info.goods_number = goodsNumber;
        try {
            const promotionService = this.service('promotion', 'api');
            const infoBasePrice = normalizePrice(info.min_retail_price, normalizePrice(info.retail_price, 0));
            const decoratedInfoList = await promotionService.decorateGoodsWithPromotion(userId, [{
                id: Number(info.id || goodsId),
                min_retail_price: infoBasePrice
            }]);
            if (Array.isArray(decoratedInfoList) && decoratedInfoList.length > 0) {
                const decoratedInfo = decoratedInfoList[0];
                info.has_promo = Number(decoratedInfo.has_promo || 0);
                info.promo_source = decoratedInfo.promo_source || 'none';
                info.promo_type = decoratedInfo.promo_type || '';
                info.promo_price = decoratedInfo.promo_price || infoBasePrice;
                info.original_price = decoratedInfo.original_price || infoBasePrice;
                info.promo_tag = decoratedInfo.promo_tag || '';
                info.promo_end_at = Number(decoratedInfo.promo_end_at || 0);
                info.promo_countdown_seconds = Number(decoratedInfo.promo_countdown_seconds || 0);
                info.promo_stock_percent = Number(decoratedInfo.promo_stock_percent || 0);
                info.has_coupon_promo = Number(decoratedInfo.has_coupon_promo || 0);
            }
            if (Array.isArray(productList) && productList.length > 0) {
                productList = await promotionService.decorateSkuListWithPromotion(userId, Number(goodsId), productList);
            }
        } catch (err) {
            think.logger && think.logger.error && think.logger.error(`[goods.detail.promotionDecorate] ${err.message || err}`);
        }
        if (!('has_promo' in info)) {
            const fallbackPrice = normalizePrice(info.min_retail_price, normalizePrice(info.retail_price, 0));
            info.has_promo = 0;
            info.promo_source = 'none';
            info.promo_type = '';
            info.promo_price = fallbackPrice;
            info.original_price = fallbackPrice;
            info.promo_tag = '';
            info.promo_end_at = 0;
            info.promo_countdown_seconds = 0;
            info.promo_stock_percent = 0;
            info.has_coupon_promo = 0;
        }
        return this.success({
            info: info,
            gallery: gallery,
            specificationList: specificationList,
            productList: productList
        });
    }
    async goodsShareAction() {
        const goodsId = this.get('id');
        const info = await this.model('goods').where({
            id: goodsId
        }).field('name,retail_price').find();
        return this.success(info);
    }
    /**
     * 获取商品列表
     * @returns {Promise.<*>}
     */
    async listAction() {
		const userId = this.getLoginUserId();;
        const keyword = this.get('keyword');
        const sort = this.get('sort');
        const order = this.get('order');
        const sales = this.get('sales');
        const model = this.model('goods');
        const whereMap = {
            is_on_sale: 1,
            is_delete: 0,
        };
        if (!think.isEmpty(keyword)) {
            whereMap.name = ['like', `%${keyword}%`];
            // 添加到搜索历史
            await this.model('search_history').add({
                keyword: keyword,
                user_id: userId,
                add_time: parseInt(new Date().getTime() / 1000)
            });
            //    TODO 之后要做个判断，这个词在搜索记录中的次数，如果大于某个值，则将他存入keyword
        }
        // 排序
        let orderMap = {};
        if (sort === 'price') {
            // 按价格
            orderMap = {
                retail_price: order
            };
        } else if (sort === 'sales') {
            // 按价格
            orderMap = {
                sell_volume: sales
            };
        } else {
            // 按商品添加时间
            orderMap = {
                sort_order: 'asc'
            };
        }
        const goodsData = await model.where(whereMap).order(orderMap).select();
        try {
            const promotionService = this.service('promotion', 'api');
            const decorated = await promotionService.decorateGoodsWithPromotion(userId, goodsData);
            return this.success(decorated);
        } catch (err) {
            think.logger && think.logger.error && think.logger.error(`[goods.list.promotionDecorate] ${err.message || err}`);
            return this.success(goodsData);
        }
    }
    /**
     * 在售的商品总数
     * @returns {Promise.<Promise|PreventPromise|void>}
     */
    async countAction() {
        const goodsCount = await this.model('goods').where({
            is_delete: 0,
            is_on_sale: 1
        }).count('id');
        return this.success({
            goodsCount: goodsCount
        });
    }
};
