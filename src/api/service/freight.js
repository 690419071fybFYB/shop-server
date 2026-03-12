module.exports = class extends think.Service {
    toNumber(value, fallback = 0) {
        const normalized = Number(value);
        return Number.isFinite(normalized) ? normalized : fallback;
    }

    normalizeFreightItems(items = []) {
        const list = Array.isArray(items) ? items : [];
        return list
            .map((item) => ({
                freight_template_id: Number(item && item.freight_template_id || 0),
                number: this.toNumber(item && item.number, 0),
                retail_price: this.toNumber(item && item.retail_price, 0),
                goods_weight: this.toNumber(item && item.goods_weight, 0)
            }))
            .filter(item => item.freight_template_id > 0 && item.number > 0);
    }

    summarizeTemplateItems(items = []) {
        const summaryMap = new Map();
        const list = this.normalizeFreightItems(items);
        for (const item of list) {
            if (!summaryMap.has(item.freight_template_id)) {
                summaryMap.set(item.freight_template_id, {
                    number: 0,
                    money: 0,
                    goods_weight: 0
                });
            }
            const summary = summaryMap.get(item.freight_template_id);
            summary.number += item.number;
            summary.money += item.number * item.retail_price;
            summary.goods_weight += item.number * item.goods_weight;
        }
        return summaryMap;
    }

    async findFreightGroup(templateId, provinceId) {
        const detail = await this.model('freight_template_detail').where({
            template_id: templateId,
            area: provinceId,
            is_delete: 0
        }).find();
        if (!think.isEmpty(detail)) {
            return this.model('freight_template_group').where({
                id: detail.group_id,
                is_delete: 0
            }).find();
        }
        return this.model('freight_template_group').where({
            template_id: templateId,
            area: 0,
            is_delete: 0
        }).find();
    }

    calculateTemplateFreight({
        summary,
        group,
        freightType
    } = {}) {
        if (think.isEmpty(summary) || think.isEmpty(group)) {
            return 0;
        }
        const start = this.toNumber(group.start, 0);
        const startFee = this.toNumber(group.start_fee, 0);
        const addUnit = Math.max(this.toNumber(group.add, 1), 1);
        const addFee = this.toNumber(group.add_fee, 0);
        const countBasis = Number(freightType) === 1 ? this.toNumber(summary.goods_weight, 0) : this.toNumber(summary.number, 0);

        let freightPrice = 0;
        if (countBasis > start) {
            const exceededBasis = countBasis - start;
            const addCount = Math.ceil(exceededBasis / addUnit);
            freightPrice = start * startFee + addCount * addFee;
        } else {
            freightPrice = start * startFee;
        }

        const freeByNumber = this.toNumber(group.free_by_number, 0);
        if (freeByNumber > 0 && this.toNumber(summary.number, 0) >= freeByNumber) {
            freightPrice = 0;
        }
        const freeByMoney = this.toNumber(group.free_by_money, 0);
        if (freeByMoney > 0 && this.toNumber(summary.money, 0) >= freeByMoney) {
            freightPrice = 0;
        }
        return Number(freightPrice.toFixed(2));
    }

    async calculateFreightPrice({
        provinceId,
        items = []
    } = {}) {
        const normalizedProvinceId = Number(provinceId || 0);
        if (normalizedProvinceId <= 0) {
            return 0;
        }
        const summaryMap = this.summarizeTemplateItems(items);
        if (summaryMap.size === 0) {
            return 0;
        }
        const templateList = await this.model('freight_template').where({
            is_delete: 0
        }).field('id,freight_type').select();
        const freightTypeMap = new Map();
        for (const item of templateList) {
            freightTypeMap.set(Number(item.id), Number(item.freight_type || 0));
        }

        let freightPrice = 0;
        for (const [templateId, summary] of summaryMap.entries()) {
            const group = await this.findFreightGroup(templateId, normalizedProvinceId);
            if (think.isEmpty(group)) {
                continue;
            }
            const freightType = freightTypeMap.has(templateId) ? freightTypeMap.get(templateId) : 0;
            const singleFreight = this.calculateTemplateFreight({
                summary,
                group,
                freightType
            });
            freightPrice = freightPrice > singleFreight ? freightPrice : singleFreight;
        }
        return Number(freightPrice.toFixed(2));
    }
};
