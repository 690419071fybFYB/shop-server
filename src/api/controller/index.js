const Base = require('./base.js');
// const view = require('think-view');
module.exports = class extends Base {
    async queryActiveAds(nowTs) {
        const sqlWithCropColumns = `
            SELECT
                id,
                title,
                link_type,
                goods_id,
                image_url,
                IFNULL(banner_image_url, '') AS banner_image_url,
                IFNULL(popup_image_url, '') AS popup_image_url,
                link,
                IFNULL(start_time, 0) AS start_time,
                IFNULL(end_time, 0) AS end_time,
                IFNULL(sort_order, 0) AS sort_order,
                IFNULL(placement, 1) AS placement
            FROM hiolabs_ad
            WHERE enabled = 1
              AND is_delete = 0
              AND IFNULL(start_time, 0) <= ${nowTs}
              AND (IFNULL(end_time, 0) = 0 OR end_time >= ${nowTs})
            ORDER BY sort_order ASC, id DESC
        `;
        try {
            return await this.model('ad').query(sqlWithCropColumns);
        } catch (err) {
            const fallbackSql = `
                SELECT
                    id,
                    title,
                    link_type,
                    goods_id,
                    image_url,
                    '' AS banner_image_url,
                    '' AS popup_image_url,
                    link,
                    IFNULL(start_time, 0) AS start_time,
                    IFNULL(end_time, 0) AS end_time,
                    IFNULL(sort_order, 0) AS sort_order,
                    IFNULL(placement, 1) AS placement
                FROM hiolabs_ad
                WHERE enabled = 1
                  AND is_delete = 0
                  AND IFNULL(start_time, 0) <= ${nowTs}
                  AND (IFNULL(end_time, 0) = 0 OR end_time >= ${nowTs})
                ORDER BY sort_order ASC, id DESC
            `;
            return await this.model('ad').query(fallbackSql);
        }
    }
    async indexAction() {
        return this.success({
            message: 'ok'
        });
    }
    async appInfoAction() {
        const nowTs = this.getTime();
        const adRows = await this.queryActiveAds(nowTs);
        const banner = (adRows || [])
          .filter(item => [1, 3].includes(Number(item.placement || 1)))
          .map(item => ({
              id: Number(item.id || 0),
              title: String(item.title || ''),
              link_type: Number(item.link_type || 0),
              goods_id: Number(item.goods_id || 0),
              image_url: String(item.banner_image_url || item.image_url || ''),
              banner_image_url: String(item.banner_image_url || item.image_url || ''),
              popup_image_url: String(item.popup_image_url || item.image_url || ''),
              link: String(item.link || ''),
              start_time: Number(item.start_time || 0),
              end_time: Number(item.end_time || 0),
              sort_order: Number(item.sort_order || 0)
          }));
        const popupAd = (adRows || [])
          .filter(item => [2, 3].includes(Number(item.placement || 1)))
          .map(item => ({
              id: Number(item.id || 0),
              title: String(item.title || ''),
              link_type: Number(item.link_type || 0),
              goods_id: Number(item.goods_id || 0),
              image_url: String(item.popup_image_url || item.image_url || ''),
              banner_image_url: String(item.banner_image_url || item.image_url || ''),
              popup_image_url: String(item.popup_image_url || item.image_url || ''),
              link: String(item.link || ''),
              start_time: Number(item.start_time || 0),
              end_time: Number(item.end_time || 0),
              sort_order: Number(item.sort_order || 0)
          }))[0] || null;
        const notice = await this.model('notice').where({
            is_delete: 0
        }).field('content').select();
        const channel = await this.model('category').where({
            is_channel: 1,
            parent_id: 0,
        }).field('id,icon_url,name,sort_order').order({
            sort_order: 'asc'
        }).select();
        const categoryList = await this.model('category').where({
            parent_id: 0,
            is_show: 1
        }).field('id,name,img_url as banner, p_height as height').order({
            sort_order: 'asc'
        }).select();
		for (const categoryItem of categoryList) {
			const categoryGoods = await this.model('goods').where({
				category_id: categoryItem.id,
				goods_number: ['>=', 0],
				is_on_sale: 1,
				is_index: 1,
				is_delete: 0
			}).field('id,list_pic_url,is_new,goods_number,name,min_retail_price').order({
				sort_order: 'asc'
			}).select();
			categoryItem.goodsList = categoryGoods;
		}
		if (Array.isArray(categoryList) && categoryList.length > 0) {
			try {
				const promotionService = this.service('promotion', 'api');
				const flatGoodsList = [];
				categoryList.forEach((item) => {
					(item.goodsList || []).forEach((goods) => {
						if (goods && Number(goods.id || 0) > 0) {
							flatGoodsList.push(goods);
						}
					});
				});
				const decoratedGoods = await promotionService.decorateGoodsWithPromotion(flatGoodsList);
				const goodsMap = new Map(decoratedGoods.map(item => [Number(item.id), item]));
				categoryList.forEach((item) => {
					item.goodsList = (item.goodsList || []).map(goods => goodsMap.get(Number(goods.id)) || goods);
				});
			} catch (err) {
				think.logger && think.logger.error && think.logger.error(`[index.appInfo.decorateGoodsWithPromotion] ${err.message || err}`);
			}
		}
		const userId = this.getLoginUserId();
		let cartCount = await this.model('cart').where({
			user_id: userId,
			is_delete: 0
		}).sum('number');
		if(cartCount == null){
			cartCount = 0;
		}
		let data = {
			channel: channel,
			banner: banner,
            popupAd: popupAd,
			notice: notice,
			categoryList: categoryList,
			cartCount: cartCount,
		}
        return this.success(data);
    }
};
