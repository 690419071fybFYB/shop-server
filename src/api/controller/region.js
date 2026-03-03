const Base = require('./base.js');
module.exports = class extends Base {
    async infoAction() {
        const region = await this.model('region').getRegionInfo(this.get('regionId'));
        return this.success(region);
    }
    async listAction() {
        const rawParentId = this.get('parentId') || this.get('parent_id');
        let parentId = Number(rawParentId);
        if (Number.isNaN(parentId)) {
            parentId = 1;
        }
        let regionList = await this.model('region').getRegionList(parentId);
        // 兼容部分数据集（省份直接挂在 parent_id=0）
        if (Array.isArray(regionList) && regionList.length === 0 && parentId === 1) {
            regionList = await this.model('region').getRegionList(0);
        }
        return this.success(regionList);
    }
    async dataAction() {
        let parentId = this.post('parent_id');
        let info = await this.model('region').where({
            parent_id: parentId
        }).getField('id,name');
        return this.success(info);
    }
    async codeAction() {
        let province = this.post('Province');
        let city = this.post('City');
        let country = this.post('Country');
        let provinceInfo = await this.model('region').where({
            name: province
        }).field('id').find();
        let province_id = provinceInfo.id;
        let cityInfo = await this.model('region').where({
            name: city
        }).field('id').find();
        let city_id = cityInfo.id;
        let countryInfo = await this.model('region').where({
            name: country
        }).field('id').find();
        let country_id = countryInfo.id;
        let data = {
            province_id: province_id,
            city_id: city_id,
            country_id: country_id
        }
        return this.success(data);
    }
};
