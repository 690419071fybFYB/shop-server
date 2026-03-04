const Base = require('./base.js');
const validator = require('../../common/utils/validate');

function toPositiveInt(value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) {
        return 0;
    }
    return num;
}

module.exports = class extends Base {
    async getAddressesAction() {
		const userId = this.getLoginUserId();
        const addressList = await this.model('address').where({
            user_id: userId,
            is_delete: 0
        }).order('id desc').select();
        let itemKey = 0;
        for (const addressItem of addressList) {
            addressList[itemKey].province_name = await this.model('region').getRegionName(addressItem.province_id);
            addressList[itemKey].city_name = await this.model('region').getRegionName(addressItem.city_id);
            addressList[itemKey].district_name = await this.model('region').getRegionName(addressItem.district_id);
            addressList[itemKey].full_region = addressList[itemKey].province_name + addressList[itemKey].city_name + addressList[itemKey].district_name;
            itemKey += 1;
        }
        return this.success(addressList);
    }
    async saveAddressAction() {
        let addressId = this.post('id');
		const userId = this.getLoginUserId();
        const name = validator.sanitizeText(this.post('name'), 32);
        const mobile = validator.sanitizeText(this.post('mobile'), 32);
        const provinceId = toPositiveInt(this.post('province_id'));
        const cityId = toPositiveInt(this.post('city_id'));
        const districtId = toPositiveInt(this.post('district_id'));
        const address = validator.sanitizeText(this.post('address'), 256);
        const isDefault = Number(this.post('is_default')) === 1 ? 1 : 0;
        if (!name) {
            return this.fail(400, '收货人不能为空');
        }
        if (!validator.isValidMobile(mobile)) {
            return this.fail(400, '手机号格式错误');
        }
        if (!provinceId || !cityId || !districtId) {
            return this.fail(400, '省市区参数错误');
        }
        if (!address) {
            return this.fail(400, '详细地址不能为空');
        }
        const addressData = {
            name: name,
            mobile: mobile,
            province_id: provinceId,
            city_id: cityId,
            district_id: districtId,
            address: address,
            user_id: userId,
            is_default: isDefault
        };
        if (think.isEmpty(addressId)) {
            addressId = await this.model('address').add(addressData);
        } else {
            addressId = toPositiveInt(addressId);
            if (!addressId) {
                return this.fail(400, '地址ID不合法');
            }
            await this.model('address').where({
                id: addressId,
                user_id: userId
            }).update(addressData);
        }
        // 如果设置为默认，则取消其它的默认
        if (isDefault === 1) {
            await this.model('address').where({
                id: ['<>', addressId],
                user_id: userId
            }).update({
                is_default: 0
            });
        }
        const addressInfo = await this.model('address').where({
            id: addressId
        }).find();
        return this.success(addressInfo);
    }
    async deleteAddressAction() {
        const id = toPositiveInt(this.post('id'));
		const userId = this.getLoginUserId();
        if (!id) {
            return this.fail(400, '地址ID不合法');
        }
        let d = await this.model('address').where({
            user_id: userId,
            id: id
        }).update({
            is_delete: 1
        });
        return this.success(d);
    }
    async addressDetailAction() {
        const addressId = toPositiveInt(this.get('id'));
		const userId = this.getLoginUserId();
        if (!addressId) {
            return this.fail(400, '地址ID不合法');
        }
        const addressInfo = await this.model('address').where({
            user_id: userId,
            id: addressId
        }).find();
        if (!think.isEmpty(addressInfo)) {
            addressInfo.province_name = await this.model('region').getRegionName(addressInfo.province_id);
            addressInfo.city_name = await this.model('region').getRegionName(addressInfo.city_id);
            addressInfo.district_name = await this.model('region').getRegionName(addressInfo.district_id);
            addressInfo.full_region = addressInfo.province_name + addressInfo.city_name + addressInfo.district_name;
        }
        return this.success(addressInfo);
    }
};
