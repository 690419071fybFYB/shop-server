const Base = require('./base.js');
const moment = require('moment');
module.exports = class extends Base {
    normalizeKeyword(rawKeyword) {
        return String(rawKeyword || '').trim().slice(0, 50);
    }

    getKeywordPromoteThreshold() {
        const configured = Number(process.env.SEARCH_KEYWORD_PROMOTE_THRESHOLD || 5);
        if (!Number.isFinite(configured)) {
            return 5;
        }
        return Math.max(1, Math.floor(configured));
    }

    async promoteKeywordIfNeeded(keyword) {
        if (think.isEmpty(keyword)) {
            return;
        }
        const threshold = this.getKeywordPromoteThreshold();
        const searchCount = Number(await this.model('search_history').where({
            keyword: keyword
        }).count('id') || 0);
        if (searchCount < threshold) {
            return;
        }
        const keywordModel = this.model('keywords');
        const existing = await keywordModel.where({
            keyword: keyword
        }).find();
        if (think.isEmpty(existing)) {
            await keywordModel.add({
                keyword: keyword,
                is_hot: 1,
                is_default: 0,
                is_show: 1,
                sort_order: 100,
                type: 0
            });
            return;
        }
        const needHot = Number(existing.is_hot || 0) !== 1;
        const needShow = Number(existing.is_show || 0) !== 1;
        if (needHot || needShow) {
            await keywordModel.where({
                id: existing.id
            }).update({
                is_hot: 1,
                is_show: 1
            });
        }
    }

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
            const decoratedInfoList = await promotionService.decorateGoodsWithPromotion([{
                id: Number(info.id || goodsId),
                min_retail_price: info.min_retail_price,
                retail_price: info.retail_price
            }]);
            if (Array.isArray(decoratedInfoList) && decoratedInfoList.length > 0) {
                info = Object.assign(info, decoratedInfoList[0]);
            }
            if (Array.isArray(productList) && productList.length > 0) {
                const productPriceList = productList.map(item => ({
                    id: Number(info.id || goodsId),
                    min_retail_price: item.retail_price,
                    retail_price: item.retail_price
                }));
                const decoratedProducts = await promotionService.decorateGoodsWithPromotion(productPriceList);
                productList = productList.map((item, index) => {
                    const decorated = decoratedProducts[index] || {};
                    return Object.assign({}, item, {
                        has_promotion: Number(decorated.has_promotion || 0),
                        promotion_price: decorated.promotion_price || item.retail_price,
                        promotion_original_price: decorated.promotion_original_price || item.retail_price,
                        promotion_tag: decorated.promotion_tag || '',
                        promotion_end_at: Number(decorated.promotion_end_at || 0),
                        promotion_countdown_seconds: Number(decorated.promotion_countdown_seconds || 0),
                        has_coupon_promo: Number(decorated.has_coupon_promo || 0),
                        promo_price: decorated.promo_price || item.retail_price,
                        original_price: decorated.original_price || item.retail_price,
                        promo_tag: decorated.promo_tag || ''
                    });
                });
            }
        } catch (err) {
            think.logger && think.logger.error && think.logger.error(`[goods.detail.promotionDecorate] ${err.message || err}`);
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
        const keyword = this.normalizeKeyword(this.get('keyword'));
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
            await this.promoteKeywordIfNeeded(keyword);
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
        let goodsData = await model.where(whereMap).order(orderMap).select();
        if (Array.isArray(goodsData) && goodsData.length > 0) {
            try {
                const promotionService = this.service('promotion', 'api');
                goodsData = await promotionService.decorateGoodsWithPromotion(goodsData);
            } catch (err) {
                think.logger && think.logger.error && think.logger.error(`[goods.list.promotionDecorate] ${err.message || err}`);
            }
        }
        return this.success(goodsData);
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
