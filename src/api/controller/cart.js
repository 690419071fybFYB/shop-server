const Base = require('./base.js');
const moment = require('moment');
module.exports = class extends Base {
    parseSelectedCouponIds(value) {
        const couponService = this.service('coupon', 'api');
        return couponService.normalizeIdList(value);
    }
    async decorateCartForResponse(cartList, {userId = 0, numberChange = 0} = {}) {
        const cartService = this.service('cart', 'api');
        return cartService.decorateCartForResponse(cartList, {
            userId,
            numberChange
        });
    }
    async getCart(type) {
		const userId = this.getLoginUserId();
        let cartList = [];
        if(type == 0){
            cartList = await this.model('cart').where({
                user_id: userId,
                is_delete: 0,
                is_fast: 0,
            }).select();
        }
        else{
            cartList = await this.model('cart').where({
                user_id: userId,
                is_delete: 0,
                is_fast: 1
            }).select();
        }
        let numberChange = 0;
        let normalizedCartList = [];
        for (const cartItem of cartList) {
            let product = await this.model('product').where({
                id: cartItem.product_id,
                is_delete: 0
            }).find();
            if (think.isEmpty(product)) {
                await this.model('cart').where({
                    product_id: cartItem.product_id,
                    user_id: userId,
                    is_delete: 0,
                }).update({
                    is_delete: 1
                });
            } else {
                let retail_price = product.retail_price;
                let productNum = product.goods_number;
				// 4.14 更新
                if (productNum <= 0 || product.is_on_sale == 0) {
                    await this.model('cart').where({
                        product_id: cartItem.product_id,
                        user_id: userId,
                        checked: 1,
                        is_delete: 0,
                    }).update({
                        checked: 0
                    });
                    cartItem.number = 0;
                } else if (productNum > 0 && productNum < cartItem.number) {
                    cartItem.number = productNum;
                    numberChange = 1;
                } else if (productNum > 0 && cartItem.number <= 0) {
                    await this.model('cart').where({
                        product_id: cartItem.product_id,
                        user_id: userId,
                        is_delete: 0,
                    }).update({
                        is_delete: 1
                    });
                    continue;
                }
                cartItem.retail_price = retail_price;
                // 查找商品的图片
                let info = await this.model('goods').where({
                    id: cartItem.goods_id
                }).field('list_pic_url').find();
                cartItem.list_pic_url = info.list_pic_url;
                cartItem.weight_count = cartItem.number * Number(cartItem.goods_weight);
                await this.model('cart').where({
                    product_id: cartItem.product_id,
                    user_id: userId,
                    is_delete: 0,
                }).update({
                    number: cartItem.number,
                    add_price:retail_price
                });
                normalizedCartList.push(cartItem);
            }
        }
        return this.decorateCartForResponse(normalizedCartList, {
            userId: userId,
            numberChange: numberChange
        });
    }
    /**
     * 获取购物车信息，所有对购物车的增删改操作，都要重新返回购物车的信息
     * @return {Promise} []
     */
    async indexAction() {
        return this.success(await this.getCart(0));
    }
    async addAgain(goodsId, productId, number) {
		const userId = this.getLoginUserId();;
        const currentTime = parseInt(new Date().getTime() / 1000);
        const goodsInfo = await this.model('goods').where({
            id: goodsId
        }).find();
        if (think.isEmpty(goodsInfo) || goodsInfo.is_on_sale == 0) {
            return this.fail(400, '商品已下架');
        }
        // 取得规格的信息,判断规格库存
        // const productInfo = await this.model('product').where({goods_id: goodsId, id: productId}).find();
        const productInfo = await this.model('product').where({
            id: productId
        }).find();
        // let productId = productInfo.id;
        if (think.isEmpty(productInfo) || productInfo.goods_number < number) {
            return this.fail(400, '库存不足');
        }
        // 判断购物车中是否存在此规格商品
        const cartInfo = await this.model('cart').where({
            user_id: userId,
            product_id: productId,
            is_delete: 0
        }).find();
        let retail_price = productInfo.retail_price;
        if (think.isEmpty(cartInfo)) {
            // 添加操作
            // 添加规格名和值
            let goodsSepcifitionValue = [];
            if (!think.isEmpty(productInfo.goods_specification_ids)) {
                goodsSepcifitionValue = await this.model('goods_specification').where({
                    goods_id: productInfo.goods_id,
                    is_delete: 0,
                    id: {
                        'in': productInfo.goods_specification_ids.split('_')
                    }
                }).getField('value');
            }
            // 添加到购物车
            const cartData = {
                goods_id: productInfo.goods_id,
                product_id: productId,
                goods_sn: productInfo.goods_sn,
                goods_name: goodsInfo.name,
                goods_aka: productInfo.goods_name,
                goods_weight: productInfo.goods_weight,
                freight_template_id: goodsInfo.freight_template_id,
                list_pic_url: goodsInfo.list_pic_url,
                number: number,
                user_id: userId,
                retail_price: retail_price,
                add_price: retail_price,
                goods_specifition_name_value: goodsSepcifitionValue.join(';'),
                goods_specifition_ids: productInfo.goods_specification_ids,
                checked: 1,
                add_time: currentTime
            };
            await this.model('cart').add(cartData);
        } else {
            // 如果已经存在购物车中，则数量增加
            if (productInfo.goods_number < (number + cartInfo.number)) {
                return this.fail(400, '库存都不够啦');
            }
            await this.model('cart').where({
                user_id: userId,
                product_id: productId,
                is_delete: 0,
                id: cartInfo.id
            }).update({
                retail_price: retail_price,
                checked: 1,
                number: number
            });
        }
    }
    /**
     * 添加商品到购物车
     * @returns {Promise.<*>}
     */
    async addAction() {
        const goodsId = this.post('goodsId');
		const userId = this.getLoginUserId();;
        const productId = this.post('productId');
        const number = this.post('number');
        const addType = this.post('addType');
        const currentTime = parseInt(new Date().getTime() / 1000);
        // 判断商品是否可以购买
        const goodsInfo = await this.model('goods').where({
            id: goodsId
        }).find();
        if (think.isEmpty(goodsInfo) || goodsInfo.is_on_sale == 0) {
            return this.fail(400, '商品已下架');
        }
        // 取得规格的信息,判断规格库存
        // const productInfo = await this.model('product').where({goods_id: goodsId, id: productId}).find();
        const productInfo = await this.model('product').where({
            id: productId
        }).find();
        // let productId = productInfo.id;
        if (think.isEmpty(productInfo) || productInfo.goods_number < number) {
            return this.fail(400, '库存不足');
        }
        // 判断购物车中是否存在此规格商品
        const cartInfo = await this.model('cart').where({
            user_id: userId,
            product_id: productId,
            is_delete: 0
        }).find();
        let retail_price = productInfo.retail_price;
        if (addType == 1) {
            await this.model('cart').where({
                is_delete: 0,
                user_id: userId
            }).update({
                checked: 0
            });
            let goodsSepcifitionValue = [];
            if (!think.isEmpty(productInfo.goods_specification_ids)) {
                goodsSepcifitionValue = await this.model('goods_specification').where({
                    goods_id: productInfo.goods_id,
                    is_delete: 0,
                    id: {
                        'in': productInfo.goods_specification_ids.split('_')
                    }
                }).getField('value');
            }
            // 添加到购物车
            const cartData = {
                goods_id: productInfo.goods_id,
                product_id: productId,
                goods_sn: productInfo.goods_sn,
                goods_name: goodsInfo.name,
                goods_aka: productInfo.goods_name,
                goods_weight: productInfo.goods_weight,
                freight_template_id: goodsInfo.freight_template_id,
                list_pic_url: goodsInfo.list_pic_url,
                number: number,
                user_id: userId,
                retail_price: retail_price,
                add_price: retail_price,
                goods_specifition_name_value: goodsSepcifitionValue.join(';'),
                goods_specifition_ids: productInfo.goods_specification_ids,
                checked: 1,
                add_time: currentTime,
                is_fast: 1
            };
            await this.model('cart').add(cartData);
            return this.success(await this.getCart(1));
        } else {
            if (think.isEmpty(cartInfo)) {
                // 添加操作
                // 添加规格名和值
                let goodsSepcifitionValue = [];
                if (!think.isEmpty(productInfo.goods_specification_ids)) {
                    goodsSepcifitionValue = await this.model('goods_specification').where({
                        goods_id: productInfo.goods_id,
                        is_delete: 0,
                        id: {
                            'in': productInfo.goods_specification_ids.split('_')
                        }
                    }).getField('value');
                }
                // 添加到购物车
                const cartData = {
                    goods_id: productInfo.goods_id,
                    product_id: productId,
                    goods_sn: productInfo.goods_sn,
                    goods_name: goodsInfo.name,
                    goods_aka: productInfo.goods_name,
                    goods_weight: productInfo.goods_weight,
                    freight_template_id: goodsInfo.freight_template_id,
                    list_pic_url: goodsInfo.list_pic_url,
                    number: number,
                    user_id: userId,
                    retail_price: retail_price,
                    add_price: retail_price,
                    goods_specifition_name_value: goodsSepcifitionValue.join(';'),
                    goods_specifition_ids: productInfo.goods_specification_ids,
                    checked: 1,
                    add_time: currentTime
                };
                await this.model('cart').add(cartData);
            } else {
                // 如果已经存在购物车中，则数量增加
                if (productInfo.goods_number < (number + cartInfo.number)) {
                    return this.fail(400, '库存都不够啦');
                }
                await this.model('cart').where({
                    user_id: userId,
                    product_id: productId,
                    is_delete: 0,
                    id: cartInfo.id
                }).update({
                    retail_price: retail_price
                });
                await this.model('cart').where({
                    user_id: userId,
                    product_id: productId,
                    is_delete: 0,
                    id: cartInfo.id
                }).increment('number', number);
            }
            return this.success(await this.getCart(0));
        }
    }
    // 更新指定的购物车信息
    async updateAction() {
        const productId = this.post('productId'); // 新的product_id
        const id = this.post('id'); // cart.id
        const userId = this.getLoginUserId();
        const number = parseInt(this.post('number')); // 不是
        const cartInfo = await this.model('cart').where({
            id: id,
            user_id: userId,
            is_delete: 0
        }).find();
        if (think.isEmpty(cartInfo)) {
            return this.fail(404, '购物车商品不存在');
        }
        if (think.isEmpty(number) || Number.isNaN(number)) {
            return this.fail(400, '数量参数错误');
        }
        if (number <= 0) {
            await this.model('cart').where({
                id: id,
                user_id: userId,
                is_delete: 0
            }).update({
                is_delete: 1
            });
            return this.success(await this.getCart(0));
        }
        // 取得规格的信息,判断规格库存
        const productInfo = await this.model('product').where({
            id: productId,
            is_delete: 0,
        }).find();
        if (think.isEmpty(productInfo) || productInfo.goods_number < number) {
            return this.fail(400, '库存不足');
        }
        // 只是更新number
        if (cartInfo.product_id === productId) {
            await this.model('cart').where({
                id: id,
                user_id: userId,
                is_delete: 0
            }).update({
                number: number
            });
            return this.success(await this.getCart(0));
        }
    }
    // 是否选择商品，如果已经选择，则取消选择，批量操作
    async checkedAction() {
		const userId = this.getLoginUserId();;
        let productId = this.post('productIds').toString();
        const isChecked = this.post('isChecked');
        if (think.isEmpty(productId)) {
            return this.fail('删除出错');
        }
        productId = productId.split(',');
        await this.model('cart').where({
            product_id: {
                'in': productId
            },
            user_id: userId,
            is_delete: 0
        }).update({
            checked: parseInt(isChecked)
        });
        return this.success(await this.getCart(0));
    }
    // 删除选中的购物车商品，批量删除
    async deleteAction() {
        let productId = this.post('productIds');
		const userId = this.getLoginUserId();;
        if (think.isEmpty(productId)) {
            return this.fail('删除出错');
        }
        await this.model('cart').where({
            product_id: productId,
            user_id: userId,
            is_delete: 0
        }).update({
            is_delete: 1
        });
        return this.success(await this.getCart(0));
        // return this.success(productId);
    }
    // 获取购物车商品的总件件数
    async goodsCountAction() {
        const cartData = await this.getCart(0);
		const userId = this.getLoginUserId();;
        await this.model('cart').where({
            user_id: userId,
            is_delete: 0,
            is_fast: 1
        }).update({
            is_delete: 1
        });
        return this.success({
            cartTotal: {
                goodsCount: cartData.cartTotal.goodsCount
            }
        });
    }
    /**
     * 订单提交前的检验和填写相关订单信息
     * @returns {Promise.<void>}
     */
    async checkoutAction() {
		const userId = this.getLoginUserId();;
        let orderFrom = this.get('orderFrom');
        const type = Number(this.get('type') || 0); // 是否团购
        const addressId = this.get('addressId'); // 收货地址id
        const addType = Number(this.get('addType') || 0);
        const selectedUserCouponIds = this.parseSelectedCouponIds(this.get('selectedUserCouponIds') || []);
        let goodsCount = 0; // 购物车的数量
        let freightPrice = 0;
        let outStock = 0;
        let cartData = null;
        // 获取要购买的商品
        if (type == 0) {
            if (addType == 0) {
                cartData = await this.getCart(0);
            } else if (addType == 1) {
                cartData = await this.getCart(1);
            } else if (addType == 2) {
                cartData = await this.getAgainCart(orderFrom);
            }
        }
        if (!cartData || !Array.isArray(cartData.cartList)) {
            cartData = {
                cartList: [],
                cartTotal: {
                    numberChange: 0
                }
            };
        }
        const checkedGoodsList = cartData.cartList.filter(function(v) {
            return v.checked === 1;
        });
        const promotionService = this.service('promotion', 'api');
        const beforeVipSummary = promotionService.summarizeCartItems(checkedGoodsList);
        const vipService = this.service('vip', 'api');
        let vipPricingResult = {
            cartItems: checkedGoodsList,
            vipDiscountPrice: 0,
            vipAppliedItems: []
        };
        if (Number(type || 0) !== 2) {
            try {
                vipPricingResult = await vipService.applyVipPriceToCartItems({
                    userId: userId,
                    cartItems: checkedGoodsList
                });
            } catch (err) {
                think.logger && think.logger.warn && think.logger.warn(`[cart.checkout.vipPricing] ${err.message || err}`);
            }
        }
        const pricedCheckedGoodsList = Array.isArray(vipPricingResult.cartItems) ? vipPricingResult.cartItems : checkedGoodsList;
        const afterVipSummary = promotionService.summarizeCartItems(pricedCheckedGoodsList);
        for (const item of checkedGoodsList) {
            goodsCount = goodsCount + Number(item.number || 0);
            if (item.goods_number <= 0 || item.is_on_sale == 0) {
                outStock = Number(outStock) + 1;
            }
        }
        if (addType == 2) {
            let againGoods = await this.model('order_goods').where({
                order_id: orderFrom
            }).select();
            let againGoodsCount = 0;
            for (const item of againGoods) {
                againGoodsCount = againGoodsCount + Number(item.number || 0);
            }
            if (goodsCount != againGoodsCount) {
                outStock = 1;
            }
        }
        // 选择的收货地址
        let checkedAddress = null;
        if (addressId == '' || addressId == 0) {
            checkedAddress = await this.model('address').where({
                is_default: 1,
                user_id: userId,
				is_delete:0
            }).find();
        } else {
            checkedAddress = await this.model('address').where({
                id: addressId,
                user_id: userId,
				is_delete:0
            }).find();
        }
        if (!think.isEmpty(checkedAddress)) {
            // 运费开始
            // 先将促销规则中符合满件包邮或者满金额包邮的规则找到；
            // 先看看是不是属于偏远地区。
            let province_id = checkedAddress.province_id;
            // 得到数组了，然后去判断这两个商品符不符合要求
            // 先用这个goods数组去遍历
            let cartGoods = pricedCheckedGoodsList;
            let freightTempArray = await this.model('freight_template').where({
                is_delete: 0
            }).select();
            let freightData = [];
            for (const item in freightTempArray) {
                freightData[item] = {
                    id: freightTempArray[item].id,
                    number: 0,
                    money: 0,
                    goods_weight: 0,
                    freight_type: freightTempArray[item].freight_type
                }
            }
            // 按件计算和按重量计算的区别是：按件，只要算goods_number就可以了，按重量要goods_number*goods_weight
            // checkedGoodsList = [{goods_id:1,number5},{goods_id:2,number:3},{goods_id:3,number:2}]
            for (const item of freightData) {
                for (const cartItem of cartGoods) {
                    if (item.id == cartItem.freight_template_id) {
                        // 这个在判断，购物车中的商品是否属于这个运费模版，如果是，则加一，但是，这里要先判断下，这个商品是否符合满件包邮或满金额包邮，如果是包邮的，那么要去掉
                        const currentNumber = Number(cartItem.number || 0);
                        const currentWeight = Number(cartItem.goods_weight || 0);
                        item.number = item.number + currentNumber;
                        item.money = item.money + currentNumber * Number(cartItem.display_price || cartItem.promotion_price || cartItem.retail_price || 0);
                        item.goods_weight = item.goods_weight + currentNumber * currentWeight;
                    }
                }
            }
            checkedAddress.province_name = await this.model('region').getRegionName(checkedAddress.province_id);
            checkedAddress.city_name = await this.model('region').getRegionName(checkedAddress.city_id);
            checkedAddress.district_name = await this.model('region').getRegionName(checkedAddress.district_id);
            checkedAddress.full_region = checkedAddress.province_name + checkedAddress.city_name + checkedAddress.district_name;
            const freightService = this.service('freight', 'api');
            for (const item of freightData) {
                if (item.number == 0) {
                    continue;
                }
                const templateInfo = await this.model('freight_template').where({
                    id: item.id,
                    is_delete: 0,
                }).find();
                const freightType = Number(templateInfo.freight_type || 0);
                let ex = await this.model('freight_template_detail').where({
                    template_id: item.id,
                    area: province_id,
                    is_delete: 0,
                }).find();
                let freight_price = 0;
                let groupData = {};
                if (!think.isEmpty(ex)) {
                    // console.log('第一层：非默认邮费算法');
                    groupData = await this.model('freight_template_group').where({
                        id: ex.group_id,
                        is_delete:0
                    }).find();
                } else {
                    // console.log('第二层：使用默认的邮费算法');
                    groupData = await this.model('freight_template_group').where({
                        template_id: item.id,
                        area: 0,
                        is_delete:0,
                    }).find();
                }
                freight_price = freightService.calculateTemplateFreight({
                    summary: item,
                    group: groupData,
                    freightType: freightType
                });
				freightPrice = freightPrice > freight_price?freightPrice:freight_price
                // freightPrice = freightPrice + freight_price;
                // 会得到 几个数组，然后用省id去遍历在哪个数组
            }
        } else {
            checkedAddress = 0;
        }
        const goodsOriginalPrice = beforeVipSummary.goodsOriginalPrice;
        const promotionPrice = beforeVipSummary.promotionPrice;
        const vipDiscountPrice = Number(vipPricingResult.vipDiscountPrice || 0);
        const goodsTotalPrice = beforeVipSummary.goodsTotalPrice;
        const orderTotalPrice = Number(afterVipSummary.goodsTotalNumber || 0) + Number(freightPrice || 0);
        const couponService = this.service('coupon', 'api');
        const couponCartItems = pricedCheckedGoodsList.map(item => Object.assign({}, item, {
            retail_price: item.display_price || item.promotion_price || item.retail_price
        }));
        const couponPreview = await couponService.previewCartCoupons({
            userId: userId,
            cartItems: couponCartItems,
            selectedUserCouponIds: selectedUserCouponIds,
            freightPrice: Number(freightPrice || 0)
        });
        let numberChange = cartData.cartTotal.numberChange;
        return this.success({
            checkedAddress: checkedAddress,
            freightPrice: freightPrice,
            checkedGoodsList: pricedCheckedGoodsList,
            goodsOriginalPrice: goodsOriginalPrice,
            promotionPrice: promotionPrice,
            goodsTotalPrice: goodsTotalPrice,
            orderTotalPrice: orderTotalPrice.toFixed(2),
            actualPrice: couponPreview.actualPrice,
            couponPrice: couponPreview.couponPrice,
            vipDiscountPrice: Number(vipDiscountPrice.toFixed(2)),
            vipAppliedItems: vipPricingResult.vipAppliedItems || [],
            couponCandidates: couponPreview.couponCandidates,
            selectedCoupons: couponPreview.selectedCoupons,
            invalidSelectedIds: couponPreview.invalidSelectedIds,
            goodsCount: goodsCount,
            outStock: outStock,
            numberChange: numberChange,
        });
    }
    async getAgainCart(orderFrom) {
		const userId = this.getLoginUserId();;
        const againGoods = await this.model('order_goods').where({
            order_id: orderFrom
        }).select();
        await this.model('cart').where({
            is_delete: 0,
            user_id: userId
        }).update({
            checked: 0
        });
        for (const item of againGoods) {
            await this.addAgain(item.goods_id, item.product_id, item.number);
        }
        const cartList = await this.model('cart').where({
            user_id: userId,
            is_fast: 0,
            is_delete: 0
        }).select();
        for (const cartItem of cartList) {
            // 查找商品的图片
            let info = await this.model('goods').where({
                id: cartItem.goods_id
            }).field('list_pic_url,goods_number,goods_unit').find();
            // cartItem.list_pic_url = await this.model('goods').where({id: cartItem.goods_id}).getField('list_pic_url', true);
            let num = info.goods_number;
            if (num <= 0) {
                await this.model('cart').where({
                    product_id: cartItem.product_id,
                    user_id: userId,
                    checked: 1,
                    is_delete: 0,
                }).update({
                    checked: 0
                });
            }
            cartItem.list_pic_url = info.list_pic_url;
            cartItem.goods_number = info.goods_number;
            cartItem.weight_count = cartItem.number * Number(cartItem.goods_weight);
            if (num <= 0) {
                cartItem.checked = 0;
            }
        }
        return this.decorateCartForResponse(cartList, {
            userId: userId,
            numberChange: 0
        });
    }
};
