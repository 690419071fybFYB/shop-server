const Base = require('./base.js');
module.exports = class extends Base {
    parseGoodsSpecificationIdList(rawValue) {
        if (think.isEmpty(rawValue)) {
            return [];
        }
        return String(rawValue)
            .split('_')
            .map(item => Number(item))
            .filter(id => Number.isInteger(id) && id > 0);
    }
    toNumber(value, fallback = 0) {
        const normalized = Number(value);
        return Number.isFinite(normalized) ? normalized : fallback;
    }
    formatPriceRange(minPrice, maxPrice) {
        const left = this.toNumber(minPrice, 0);
        const right = this.toNumber(maxPrice, left);
        const normalizedMin = Math.min(left, right);
        const normalizedMax = Math.max(left, right);
        if (normalizedMin === normalizedMax) {
            return String(normalizedMin);
        }
        return `${normalizedMin}-${normalizedMax}`;
    }
    buildGoodsAggregatePayload({
        goodsNumber = 0,
        minRetailPrice = 0,
        maxRetailPrice = 0,
        minCostPrice = 0,
        maxCostPrice = 0
    } = {}) {
        const normalizedGoodsNumber = this.toNumber(goodsNumber, 0);
        const normalizedMinRetailPrice = this.toNumber(minRetailPrice, 0);
        const normalizedMaxRetailPrice = this.toNumber(maxRetailPrice, normalizedMinRetailPrice);
        const normalizedMinCostPrice = this.toNumber(minCostPrice, 0);
        const normalizedMaxCostPrice = this.toNumber(maxCostPrice, normalizedMinCostPrice);
        return {
            goods_number: normalizedGoodsNumber,
            retail_price: this.formatPriceRange(normalizedMinRetailPrice, normalizedMaxRetailPrice),
            cost_price: this.formatPriceRange(normalizedMinCostPrice, normalizedMaxCostPrice),
            min_retail_price: Math.min(normalizedMinRetailPrice, normalizedMaxRetailPrice),
            min_cost_price: Math.min(normalizedMinCostPrice, normalizedMaxCostPrice),
        };
    }
    async getProductAggregateByGoodsId(goodsId) {
        const productModel = this.model('product');
        return {
            goodsNumber: this.toNumber(await productModel.where({
                goods_id: goodsId
            }).sum('goods_number'), 0),
            minRetailPrice: this.toNumber(await productModel.where({
                goods_id: goodsId
            }).min('retail_price'), 0),
            maxRetailPrice: this.toNumber(await productModel.where({
                goods_id: goodsId
            }).max('retail_price'), 0),
            minCostPrice: this.toNumber(await productModel.where({
                goods_id: goodsId
            }).min('cost'), 0),
            maxCostPrice: this.toNumber(await productModel.where({
                goods_id: goodsId
            }).max('cost'), 0)
        };
    }

    /**
     * index action
     * @return {Promise} []
     */
    async indexAction() {
        const model = this.model('specification');
        const data = await model.where({
            id: ['>', 0]
        }).select();
        return this.success(data);
    }
    async getGoodsSpecAction() {
        const id = this.post('id');
        const model = this.model('product');
        const data = await model.where({
            goods_id: id,
            is_delete: 0
        }).select();
        const allSpecIds = [];
        for (const item of data) {
            allSpecIds.push(...this.parseGoodsSpecificationIdList(item.goods_specification_ids));
        }
        const uniqueSpecIds = Array.from(new Set(allSpecIds));
        let specRows = [];
        if (uniqueSpecIds.length > 0) {
            specRows = await this.model('goods_specification').where({
                id: {
                    in: uniqueSpecIds
                },
                is_delete: 0
            }).select();
        }
        const specRowMap = new Map();
        for (const row of specRows) {
            specRowMap.set(Number(row.id), row);
        }
        let specification_id = 0;
        for (const item of data) {
            const goodsSpecIdList = this.parseGoodsSpecificationIdList(item.goods_specification_ids);
            const specValueRows = goodsSpecIdList
                .map(specId => specRowMap.get(Number(specId)))
                .filter(specRow => !think.isEmpty(specRow));
            if (specification_id === 0 && specValueRows.length > 0) {
                specification_id = Number(specValueRows[0].specification_id || 0);
            }
            item.value = specValueRows
                .map(specRow => String(specRow.value || ''))
                .filter(value => value !== '')
                .join('/');
        }
        let dataInfo = {
            specData: data,
            specValue: specification_id
        };
        return this.success(dataInfo);
    }
    async productUpdateAction() {
        const goods_number = this.post('goods_number');
        const goods_weight = this.post('goods_weight');
        const goods_sn = this.post('goods_sn');
        const retail_price = this.post('retail_price');
        const cost = this.post('cost');
        const value = this.post('value');
        let updateInfo = {
            goods_number: goods_number,
            goods_weight: goods_weight,
            cost: cost,
            retail_price: retail_price
        }
        await this.model('cart').where({
            goods_sn: goods_sn
        }).update({
            retail_price: retail_price
        });
        const model = this.model('product');
        await model.where({
            goods_sn: goods_sn
        }).update(updateInfo);
        let idData = await model.where({
            goods_sn: goods_sn
        }).field('goods_specification_ids,goods_id').find();
        let goods_specification_id = idData.goods_specification_ids
        let info = await this.model('goods_specification').where({
            id: goods_specification_id
        }).update({
            value: value
        });
        let goods_id = idData.goods_id;
        let pro = await this.model('product').where({
            goods_id: goods_id
        }).select();
        const aggregatePayload = pro.length > 0
            ? this.buildGoodsAggregatePayload(await this.getProductAggregateByGoodsId(goods_id))
            : this.buildGoodsAggregatePayload();
        await this.model('goods').where({
            id: goods_id
        }).update(aggregatePayload);
        return this.success(info);
    }
    async productDeleAction() {
        const productId = this.post('id');
        const model = this.model('product');
        let idData = await model.where({
            id: productId
        }).field('goods_specification_ids,goods_id').find();
        let goods_specification_id = idData.goods_specification_ids;
        let goods_id = idData.goods_id;
        await model.where({
            id: productId
        }).limit(1).delete();
        let info = await this.model('goods_specification').where({
            id: goods_specification_id
        }).limit(1).delete();
        let lastData = await model.where({
            goods_id: goods_id
        }).select();
        if (lastData.length != 0) {
            const aggregatePayload = this.buildGoodsAggregatePayload(await this.getProductAggregateByGoodsId(goods_id));
            await this.model('goods').where({
                id: goods_id
            }).update(aggregatePayload);
        } else {
            await this.model('goods').where({
                id: goods_id
            }).update(this.buildGoodsAggregatePayload());
        }
        return this.success(info);
    }
    async delePrimarySpecAction() {
        const goods_id = this.post('id');
        const model = this.model('product');
        await model.where({
            goods_id: goods_id
        }).delete();
        let info = await this.model('goods_specification').where({
            goods_id: goods_id
        }).delete();
        await this.model('goods').where({
            id: goods_id
        }).update({
            goods_number: 0,
            retail_price: 0
        });
        return this.success(info);
    }
    async detailAction(){
        let id = this.post('id');
        let info = await this.model('specification').where({
            id:id
        }).find();
        return this.success(info);
    }
    async addAction() {
        const value = this.post('name');
        const sort = this.post('sort_order');
        let info = {
            name: value,
            sort_order: sort
        }
        const model = this.model('specification');
        const data = await model.add(info);
        return this.success(data);
    }
    async checkSnAction() {
        const sn = this.post('sn');
        const model = this.model('product');
        const data = await model.where({
            goods_sn: sn
        }).select();
        if (data.length > 0) {
            return this.fail('sn已存在');
        } else {
            return this.success(data);
        }
    }
    async updateAction() {
        const id = this.post('id');
        const value = this.post('name');
        const sort = this.post('sort_order');
        let info = {
            name: value,
            sort_order: sort
        }
        const model = this.model('specification');
        const data = await model.where({
            id: id
        }).update(info);
        return this.success(data);
    }
    async deleteAction() {
        const id = this.post('id');
        const goods_spec = await this.model('goods_specification').where({
            specification_id: id,
            is_delete: 0
        }).select();
        console.log(goods_spec);
        if (goods_spec.length > 0) {
            return this.fail('该型号下有商品，暂不能删除')
        } else {
            const model = this.model('specification');
            const data = await model.where({
                id: id
            }).limit(1).delete();
            return this.success(data);
        }
    }
};
