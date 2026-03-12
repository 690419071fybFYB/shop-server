const orderSnUtil = require('../../common/utils/order_sn');

const TEAM_STATUS_ONGOING = 0;
const TEAM_STATUS_SUCCESS = 1;
const TEAM_STATUS_FAILED = 2;

const MEMBER_PAY_PENDING = 0;
const MEMBER_PAY_PAID = 1;
const MEMBER_PAY_REFUNDING = 2;
const MEMBER_PAY_REFUNDED = 3;
const MEMBER_PAY_CANCELED = 9;

module.exports = class extends think.Service {
    nowTs() {
        return Math.floor(Date.now() / 1000);
    }

    toNumber(value, fallback = 0) {
        const normalized = Number(value);
        return Number.isFinite(normalized) ? normalized : fallback;
    }

    normalizeId(value) {
        const normalized = Number(value);
        if (!Number.isFinite(normalized)) {
            return 0;
        }
        return Math.max(0, Math.floor(normalized));
    }

    normalizePage(page, fallback = 1) {
        const normalized = this.normalizeId(page);
        return normalized > 0 ? normalized : fallback;
    }

    normalizeSize(size, fallback = 10, max = 50) {
        const normalized = this.normalizeId(size);
        if (normalized <= 0) {
            return fallback;
        }
        return Math.min(max, normalized);
    }

    normalizeText(value) {
        return String(value || '').trim();
    }

    generateTeamSn(nowTs = this.nowTs()) {
        const random = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
        return `GT${String(nowTs)}${random}`;
    }

    maskMobile(value) {
        const raw = String(value || '');
        if (raw.length < 7) {
            return raw;
        }
        return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
    }

    mapActivityState(activity = {}, nowTs = this.nowTs()) {
        const startAt = Number(activity.start_at || 0);
        const endAt = Number(activity.end_at || 0);
        if (startAt > nowTs) {
            return 'upcoming';
        }
        if (endAt > 0 && endAt < nowTs) {
            return 'ended';
        }
        return 'ongoing';
    }

    normalizeActivity(activity = {}, nowTs = this.nowTs()) {
        const row = Object.assign({}, activity);
        const startAt = Number(row.start_at || 0);
        const endAt = Number(row.end_at || 0);
        const activityState = this.mapActivityState(row, nowTs);
        const remainingSeconds = endAt > 0 ? Math.max(0, endAt - nowTs) : 0;
        return Object.assign({}, row, {
            id: this.normalizeId(row.id),
            goods_id: this.normalizeId(row.goods_id),
            product_id: this.normalizeId(row.product_id),
            group_size: Math.max(2, this.normalizeId(row.group_size || 2)),
            expire_hours: Math.max(1, this.normalizeId(row.expire_hours || 24)),
            start_at: startAt,
            end_at: endAt,
            group_price: Number(this.toNumber(row.group_price, 0).toFixed(2)),
            origin_price: Number(this.toNumber(row.origin_price, 0).toFixed(2)),
            activity_state: activityState,
            remaining_seconds: remainingSeconds
        });
    }

    normalizeTeam(team = {}, nowTs = this.nowTs()) {
        const row = Object.assign({}, team);
        const expireAt = Number(row.expire_at || 0);
        const remainSeconds = expireAt > 0 ? Math.max(0, expireAt - nowTs) : 0;
        return Object.assign({}, row, {
            id: this.normalizeId(row.id),
            activity_id: this.normalizeId(row.activity_id),
            goods_id: this.normalizeId(row.goods_id),
            product_id: this.normalizeId(row.product_id),
            initiator_user_id: this.normalizeId(row.initiator_user_id),
            target_size: Math.max(2, this.normalizeId(row.target_size || 2)),
            joined_count: this.normalizeId(row.joined_count || 0),
            status: this.normalizeId(row.status),
            expire_at: expireAt,
            remain_seconds: remainSeconds
        });
    }

    async listActivities({goodsId = 0, page = 1, size = 10, includeDisabled = false} = {}) {
        const nowTs = this.nowTs();
        const normalizedGoodsId = this.normalizeId(goodsId);
        const normalizedPage = this.normalizePage(page, 1);
        const normalizedSize = this.normalizeSize(size, 10, 100);
        const where = {
            is_delete: 0
        };
        if (!includeDisabled) {
            where.status = 'enabled';
            where.end_at = ['>', nowTs];
        }
        if (normalizedGoodsId > 0) {
            where.goods_id = normalizedGoodsId;
        }
        const data = await this.model('groupon_activity')
            .where(where)
            .order('sort_order ASC,id DESC')
            .page(normalizedPage, normalizedSize)
            .countSelect();

        data.data = (data.data || []).map((item) => this.normalizeActivity(item, nowTs));
        return data;
    }

    async getActivityDetail(activityId) {
        const activityInfo = await this.model('groupon_activity').where({
            id: this.normalizeId(activityId),
            is_delete: 0
        }).find();
        if (think.isEmpty(activityInfo)) {
            throw new Error('拼团活动不存在');
        }
        const nowTs = this.nowTs();
        const activity = this.normalizeActivity(activityInfo, nowTs);
        const goods = await this.model('goods').where({
            id: activity.goods_id,
            is_delete: 0
        }).field('id,name,goods_brief,list_pic_url,goods_number,goods_unit,is_on_sale,retail_price,sell_volume').find();

        const teamRows = await this.model('groupon_team').where({
            activity_id: activity.id,
            is_delete: 0,
            status: TEAM_STATUS_ONGOING,
            expire_at: ['>', nowTs]
        }).order('id DESC').limit(20).select();

        const teamIds = teamRows.map((item) => this.normalizeId(item.id)).filter((id) => id > 0);
        let memberMap = new Map();
        if (teamIds.length > 0) {
            const members = await this.model('groupon_team_member').where({
                team_id: ['IN', teamIds],
                is_delete: 0
            }).field('id,team_id,user_id,pay_status,join_type,add_time,pay_time').order('id ASC').select();
            const userIds = Array.from(new Set(members.map((item) => this.normalizeId(item.user_id)).filter((id) => id > 0)));
            const userMap = new Map();
            if (userIds.length > 0) {
                const users = await this.model('user').where({
                    id: ['IN', userIds]
                }).field('id,nickname,mobile,avatar').select();
                users.forEach((item) => {
                    userMap.set(this.normalizeId(item.id), item);
                });
            }
            memberMap = members.reduce((acc, item) => {
                const teamId = this.normalizeId(item.team_id);
                if (!acc.has(teamId)) {
                    acc.set(teamId, []);
                }
                const userInfo = userMap.get(this.normalizeId(item.user_id)) || {};
                const nickname = this.normalizeText(userInfo.nickname) || `用户${this.normalizeId(item.user_id)}`;
                acc.get(teamId).push({
                    id: this.normalizeId(item.id),
                    user_id: this.normalizeId(item.user_id),
                    nickname,
                    mobile_masked: this.maskMobile(userInfo.mobile || ''),
                    avatar: userInfo.avatar || '',
                    join_type: this.normalizeId(item.join_type),
                    pay_status: this.normalizeId(item.pay_status),
                    add_time: this.normalizeId(item.add_time),
                    pay_time: this.normalizeId(item.pay_time)
                });
                return acc;
            }, new Map());
        }

        const teams = teamRows.map((item) => {
            const normalizedTeam = this.normalizeTeam(item, nowTs);
            const members = memberMap.get(normalizedTeam.id) || [];
            const paidCount = members.filter((member) => this.normalizeId(member.pay_status) === MEMBER_PAY_PAID).length;
            return Object.assign({}, normalizedTeam, {
                paid_count: paidCount,
                members
            });
        });

        return {
            activity,
            goods,
            teams
        };
    }

    async getTeamDetail(teamId) {
        const normalizedTeamId = this.normalizeId(teamId);
        if (normalizedTeamId <= 0) {
            throw new Error('teamId 不合法');
        }
        const teamInfo = await this.model('groupon_team').where({
            id: normalizedTeamId,
            is_delete: 0
        }).find();
        if (think.isEmpty(teamInfo)) {
            throw new Error('拼团不存在');
        }
        const nowTs = this.nowTs();
        const team = this.normalizeTeam(teamInfo, nowTs);
        const activityInfo = await this.model('groupon_activity').where({
            id: team.activity_id,
            is_delete: 0
        }).find();
        if (think.isEmpty(activityInfo)) {
            throw new Error('拼团活动不存在');
        }
        const activity = this.normalizeActivity(activityInfo, nowTs);

        const members = await this.model('groupon_team_member').where({
            team_id: team.id,
            is_delete: 0
        }).field('id,user_id,order_id,order_sn,pay_status,join_type,add_time,pay_time').order('id ASC').select();
        const userIds = Array.from(new Set(members.map((item) => this.normalizeId(item.user_id)).filter((id) => id > 0)));
        const users = userIds.length > 0
            ? await this.model('user').where({
                id: ['IN', userIds]
            }).field('id,nickname,mobile,avatar').select()
            : [];
        const userMap = new Map(users.map((item) => [this.normalizeId(item.id), item]));

        const memberList = members.map((item) => {
            const userInfo = userMap.get(this.normalizeId(item.user_id)) || {};
            return {
                id: this.normalizeId(item.id),
                user_id: this.normalizeId(item.user_id),
                order_id: this.normalizeId(item.order_id),
                pay_status: this.normalizeId(item.pay_status),
                join_type: this.normalizeId(item.join_type),
                add_time: this.normalizeId(item.add_time),
                pay_time: this.normalizeId(item.pay_time),
                nickname: this.normalizeText(userInfo.nickname) || `用户${this.normalizeId(item.user_id)}`,
                mobile_masked: this.maskMobile(userInfo.mobile || ''),
                avatar: userInfo.avatar || ''
            };
        });

        const paidCount = memberList.filter((item) => this.normalizeId(item.pay_status) === MEMBER_PAY_PAID).length;
        return {
            team: Object.assign({}, team, {
                paid_count: paidCount
            }),
            activity,
            memberList
        };
    }

    async ensureActivityForOrder(activityId) {
        const normalizedActivityId = this.normalizeId(activityId);
        if (normalizedActivityId <= 0) {
            throw new Error('活动参数错误');
        }
        const activityInfo = await this.model('groupon_activity').where({
            id: normalizedActivityId,
            is_delete: 0
        }).find();
        if (think.isEmpty(activityInfo)) {
            throw new Error('拼团活动不存在');
        }
        const activity = this.normalizeActivity(activityInfo, this.nowTs());
        if (this.normalizeText(activity.status) !== 'enabled') {
            throw new Error('拼团活动未启用');
        }
        if (activity.activity_state !== 'ongoing') {
            if (activity.activity_state === 'upcoming') {
                throw new Error('拼团活动尚未开始');
            }
            throw new Error('拼团活动已结束');
        }
        return activity;
    }

    async getGoodsAndProductByActivity(activity) {
        const goodsInfo = await this.model('goods').where({
            id: this.normalizeId(activity.goods_id),
            is_delete: 0
        }).find();
        if (think.isEmpty(goodsInfo) || Number(goodsInfo.is_on_sale || 0) !== 1) {
            throw new Error('商品不可参与拼团');
        }

        let productInfo = {};
        const productId = this.normalizeId(activity.product_id);
        if (productId > 0) {
            productInfo = await this.model('product').where({
                id: productId,
                goods_id: this.normalizeId(activity.goods_id),
                is_delete: 0
            }).find();
        }
        if (think.isEmpty(productInfo)) {
            productInfo = await this.model('product').where({
                goods_id: this.normalizeId(activity.goods_id),
                is_delete: 0,
                is_on_sale: 1
            }).order('id ASC').find();
        }
        if (think.isEmpty(productInfo) || Number(productInfo.is_on_sale || 0) !== 1) {
            throw new Error('商品规格不可参与拼团');
        }
        if (Number(productInfo.goods_number || 0) <= 0 || Number(goodsInfo.goods_number || 0) <= 0) {
            throw new Error('库存不足，请稍后再试');
        }
        return {
            goodsInfo,
            productInfo
        };
    }

    async resolveCheckoutAddress(userId, addressId) {
        const normalizedUserId = this.normalizeId(userId);
        const normalizedAddressId = this.normalizeId(addressId);
        if (normalizedUserId <= 0) {
            throw new Error('用户未登录');
        }
        let address = {};
        if (normalizedAddressId > 0) {
            address = await this.model('address').where({
                id: normalizedAddressId,
                user_id: normalizedUserId,
                is_delete: 0
            }).find();
        } else {
            address = await this.model('address').where({
                user_id: normalizedUserId,
                is_default: 1,
                is_delete: 0
            }).find();
        }
        if (think.isEmpty(address)) {
            return 0;
        }
        const regionModel = this.model('region');
        const provinceName = await regionModel.getRegionName(address.province_id);
        const cityName = await regionModel.getRegionName(address.city_id);
        const districtName = await regionModel.getRegionName(address.district_id);
        return Object.assign({}, address, {
            province_name: provinceName,
            city_name: cityName,
            district_name: districtName,
            full_region: `${provinceName}${cityName}${districtName}`
        });
    }

    buildCheckoutGoodsItem({activity, goodsInfo, productInfo} = {}) {
        const groupPrice = Number(this.toNumber(activity.group_price, 0).toFixed(2));
        const originPrice = Number(this.toNumber(activity.origin_price, productInfo.retail_price || goodsInfo.retail_price || groupPrice).toFixed(2));
        return {
            goods_id: this.normalizeId(goodsInfo.id),
            product_id: this.normalizeId(productInfo.id),
            goods_name: goodsInfo.name,
            goods_aka: goodsInfo.name,
            list_pic_url: goodsInfo.list_pic_url,
            retail_price: groupPrice,
            display_price: groupPrice,
            promotion_price: groupPrice,
            promotion_original_price: originPrice,
            has_promotion: 0,
            number: 1,
            goods_specifition_name_value: productInfo.goods_name || '',
            goods_specifition_ids: productInfo.goods_specification_ids || '',
            goods_number: Number(productInfo.goods_number || 0),
            is_on_sale: Number(goodsInfo.is_on_sale || 0),
            freight_template_id: Number(goodsInfo.freight_template_id || 0),
            goods_weight: Number(productInfo.goods_weight || 0),
            goods_unit: goodsInfo.goods_unit || '',
            groupon_price: groupPrice,
            groupon_origin_price: originPrice
        };
    }

    async calculateCheckoutFreight({checkedAddress, checkoutItem}) {
        if (!checkedAddress || checkedAddress === 0) {
            return 0;
        }
        const freightService = this.service('freight', 'api');
        const freightPrice = await freightService.calculateFreightPrice({
            provinceId: Number(checkedAddress.province_id || 0),
            items: [{
                freight_template_id: Number(checkoutItem.freight_template_id || 0),
                number: Number(checkoutItem.number || 0),
                retail_price: Number(checkoutItem.display_price || checkoutItem.retail_price || 0),
                goods_weight: Number(checkoutItem.goods_weight || 0)
            }]
        });
        return Number(this.toNumber(freightPrice, 0).toFixed(2));
    }

    async checkout({userId, activityId, teamId = 0, addressId = 0} = {}) {
        const activity = await this.ensureActivityForOrder(activityId);
        const {goodsInfo, productInfo} = await this.getGoodsAndProductByActivity(activity);
        const checkedAddress = await this.resolveCheckoutAddress(userId, addressId);
        const checkoutItem = this.buildCheckoutGoodsItem({
            activity,
            goodsInfo,
            productInfo
        });
        const freightPrice = await this.calculateCheckoutFreight({
            checkedAddress,
            checkoutItem
        });

        const goodsTotalPrice = Number(this.toNumber(checkoutItem.display_price, 0).toFixed(2));
        const originPrice = Number(this.toNumber(checkoutItem.groupon_origin_price, checkoutItem.display_price).toFixed(2));
        const promotionPrice = Number(Math.max(0, originPrice - goodsTotalPrice).toFixed(2));
        const orderTotalPrice = Number((goodsTotalPrice + freightPrice).toFixed(2));

        let team = null;
        const normalizedTeamId = this.normalizeId(teamId);
        if (normalizedTeamId > 0) {
            team = await this.model('groupon_team').where({
                id: normalizedTeamId,
                is_delete: 0
            }).find();
            if (!think.isEmpty(team)) {
                team = this.normalizeTeam(team, this.nowTs());
            }
        }

        return {
            checkedAddress,
            checkedGoodsList: [checkoutItem],
            goodsOriginalPrice: originPrice,
            promotionPrice,
            goodsTotalPrice,
            orderTotalPrice: orderTotalPrice.toFixed(2),
            actualPrice: Number(orderTotalPrice.toFixed(2)),
            couponPrice: 0,
            couponCandidates: [],
            selectedCoupons: [],
            invalidSelectedIds: [],
            goodsCount: 1,
            outStock: 0,
            numberChange: 0,
            groupon: {
                activity_id: activity.id,
                team_id: normalizedTeamId,
                group_size: activity.group_size,
                expire_hours: activity.expire_hours,
                mode: normalizedTeamId > 0 ? 'join' : 'create',
                team
            }
        };
    }

    bindTxModel(rootModel, name) {
        const model = rootModel.model(name);
        model.db(rootModel.db());
        return model;
    }

    async ensureTeamJoinable({teamModel, memberModel, teamId, activityId, userId, currentTime}) {
        const teamInfo = await teamModel.where({
            id: this.normalizeId(teamId),
            is_delete: 0
        }).find();
        if (think.isEmpty(teamInfo)) {
            throw new Error('拼团不存在');
        }
        const team = this.normalizeTeam(teamInfo, currentTime);
        if (team.activity_id !== this.normalizeId(activityId)) {
            throw new Error('拼团活动不匹配');
        }
        if (team.status !== TEAM_STATUS_ONGOING || team.expire_at <= currentTime) {
            throw new Error('该拼团已失效');
        }
        if (team.joined_count >= team.target_size) {
            throw new Error('该拼团已满员');
        }

        const existed = await memberModel.where({
            team_id: team.id,
            user_id: this.normalizeId(userId),
            is_delete: 0,
            pay_status: ['<>', MEMBER_PAY_CANCELED]
        }).find();
        if (!think.isEmpty(existed)) {
            throw new Error('您已参与该拼团');
        }
        return team;
    }

    async createOrderWithTeamMember({
        userId,
        activity,
        teamId,
        address,
        postscript,
        offlinePay,
        requestId
    } = {}) {
        const normalizedUserId = this.normalizeId(userId);
        const normalizedTeamId = this.normalizeId(teamId);
        if (normalizedUserId <= 0) {
            throw new Error('用户未登录');
        }
        if (think.isEmpty(address) || address === 0) {
            throw new Error('请选择收货地址');
        }

        const rootModel = this.model('order');
        const createOrderSn = () => {
            if (rootModel && typeof rootModel.generateOrderNumber === 'function') {
                return rootModel.generateOrderNumber();
            }
            return orderSnUtil.generateOrderSn();
        };

        const currentTime = this.nowTs();
        let persistedOrder = null;
        let persistedTeam = null;

        await orderSnUtil.withOrderSnRetry({
            maxRetries: 3,
            context: 'api.service.groupon.createOrderWithTeamMember',
            logger: think.logger,
            requestId: String(requestId || ''),
            createOrderSn,
            execute: async(orderSn) => {
                await rootModel.transaction(async() => {
                    const orderModel = this.bindTxModel(rootModel, 'order');
                    const orderGoodsModel = this.bindTxModel(rootModel, 'order_goods');
                    const teamModel = this.bindTxModel(rootModel, 'groupon_team');
                    const memberModel = this.bindTxModel(rootModel, 'groupon_team_member');
                    const activityModel = this.bindTxModel(rootModel, 'groupon_activity');
                    const goodsModel = this.bindTxModel(rootModel, 'goods');
                    const productModel = this.bindTxModel(rootModel, 'product');

                    const latestActivityRaw = await activityModel.where({
                        id: this.normalizeId(activity.id),
                        is_delete: 0
                    }).find();
                    if (think.isEmpty(latestActivityRaw)) {
                        throw new Error('拼团活动不存在');
                    }
                    const latestActivity = this.normalizeActivity(latestActivityRaw, currentTime);
                    if (this.normalizeText(latestActivity.status) !== 'enabled') {
                        throw new Error('拼团活动未启用');
                    }
                    if (latestActivity.activity_state !== 'ongoing') {
                        throw new Error('拼团活动不可下单');
                    }

                    const goodsInfo = await goodsModel.where({
                        id: this.normalizeId(latestActivity.goods_id),
                        is_delete: 0
                    }).find();
                    if (think.isEmpty(goodsInfo) || Number(goodsInfo.is_on_sale || 0) !== 1) {
                        throw new Error('商品不可参与拼团');
                    }

                    let productInfo = {};
                    if (this.normalizeId(latestActivity.product_id) > 0) {
                        productInfo = await productModel.where({
                            id: this.normalizeId(latestActivity.product_id),
                            goods_id: this.normalizeId(latestActivity.goods_id),
                            is_delete: 0
                        }).find();
                    }
                    if (think.isEmpty(productInfo)) {
                        productInfo = await productModel.where({
                            goods_id: this.normalizeId(latestActivity.goods_id),
                            is_delete: 0,
                            is_on_sale: 1
                        }).order('id ASC').find();
                    }
                    if (think.isEmpty(productInfo) || Number(productInfo.is_on_sale || 0) !== 1) {
                        throw new Error('商品规格不可参与拼团');
                    }
                    if (Number(productInfo.goods_number || 0) <= 0 || Number(goodsInfo.goods_number || 0) <= 0) {
                        throw new Error('库存不足，请稍后再试');
                    }

                    const checkoutItem = this.buildCheckoutGoodsItem({
                        activity: latestActivity,
                        goodsInfo,
                        productInfo
                    });

                    const freightPrice = await this.calculateCheckoutFreight({
                        checkedAddress: address,
                        checkoutItem
                    });

                    let currentTeam = null;
                    let joinType = 0;
                    if (normalizedTeamId > 0) {
                        currentTeam = await this.ensureTeamJoinable({
                            teamModel,
                            memberModel,
                            teamId: normalizedTeamId,
                            activityId: latestActivity.id,
                            userId: normalizedUserId,
                            currentTime
                        });
                        joinType = 1;
                    } else {
                        const newTeamId = await teamModel.add({
                            team_sn: this.generateTeamSn(currentTime),
                            activity_id: latestActivity.id,
                            goods_id: this.normalizeId(latestActivity.goods_id),
                            product_id: this.normalizeId(productInfo.id),
                            initiator_user_id: normalizedUserId,
                            target_size: latestActivity.group_size,
                            joined_count: 0,
                            status: TEAM_STATUS_ONGOING,
                            expire_at: currentTime + latestActivity.expire_hours * 60 * 60,
                            success_at: 0,
                            failed_at: 0,
                            is_delete: 0,
                            add_time: currentTime,
                            update_time: currentTime
                        });
                        currentTeam = this.normalizeTeam({
                            id: newTeamId,
                            activity_id: latestActivity.id,
                            goods_id: this.normalizeId(latestActivity.goods_id),
                            product_id: this.normalizeId(productInfo.id),
                            initiator_user_id: normalizedUserId,
                            target_size: latestActivity.group_size,
                            joined_count: 0,
                            status: TEAM_STATUS_ONGOING,
                            expire_at: currentTime + latestActivity.expire_hours * 60 * 60
                        }, currentTime);
                        joinType = 0;
                    }

                    const goodsTotalPrice = Number(this.toNumber(checkoutItem.display_price, 0).toFixed(2));
                    const originPrice = Number(this.toNumber(checkoutItem.groupon_origin_price, checkoutItem.display_price).toFixed(2));
                    const promotionPrice = Number(Math.max(0, originPrice - goodsTotalPrice).toFixed(2));
                    const orderPrice = Number((goodsTotalPrice + freightPrice).toFixed(2));
                    const actualPrice = Number(orderPrice.toFixed(2));

                    const orderPayload = {
                        order_sn: orderSn,
                        user_id: normalizedUserId,
                        order_status: 801,
                        order_type: 2,
                        pay_status: 0,
                        pay_id: '0',
                        consignee: address.name,
                        mobile: address.mobile,
                        province: this.normalizeId(address.province_id),
                        city: this.normalizeId(address.city_id),
                        district: this.normalizeId(address.district_id),
                        address: this.normalizeText(address.address),
                        print_info: `1、${checkoutItem.goods_name}【1】 `,
                        postscript: Buffer.from(this.normalizeText(postscript || ''), 'utf8').toString('base64'),
                        add_time: currentTime,
                        pay_expire_at: currentTime + 24 * 60 * 60,
                        goods_price: goodsTotalPrice,
                        order_price: orderPrice,
                        actual_price: actualPrice,
                        change_price: actualPrice,
                        freight_price: Number(this.toNumber(freightPrice, 0).toFixed(2)),
                        coupon_price: 0,
                        promotions_price: promotionPrice,
                        coupon_detail_json: JSON.stringify([]),
                        offline_pay: this.normalizeId(offlinePay) === 1 ? 1 : 0,
                        groupon_activity_id: latestActivity.id,
                        groupon_team_id: currentTeam.id,
                        is_delete: 0
                    };

                    const orderId = await orderModel.add(orderPayload);
                    if (!orderId) {
                        throw new Error('拼团订单创建失败');
                    }

                    await orderGoodsModel.add({
                        user_id: normalizedUserId,
                        order_id: Number(orderId),
                        goods_id: checkoutItem.goods_id,
                        product_id: checkoutItem.product_id,
                        goods_name: checkoutItem.goods_name,
                        goods_aka: checkoutItem.goods_aka,
                        list_pic_url: checkoutItem.list_pic_url,
                        retail_price: Number(checkoutItem.display_price || checkoutItem.retail_price || 0),
                        number: 1,
                        goods_specifition_name_value: checkoutItem.goods_specifition_name_value,
                        goods_specifition_ids: checkoutItem.goods_specifition_ids
                    });

                    await memberModel.add({
                        team_id: currentTeam.id,
                        user_id: normalizedUserId,
                        order_id: Number(orderId),
                        order_sn: orderSn,
                        pay_status: MEMBER_PAY_PENDING,
                        refund_status: 0,
                        join_type: joinType,
                        pay_time: 0,
                        is_delete: 0,
                        add_time: currentTime,
                        update_time: currentTime
                    });

                    persistedOrder = Object.assign({}, orderPayload, {
                        id: Number(orderId)
                    });
                    persistedTeam = currentTeam;
                });
            }
        });

        return {
            orderInfo: persistedOrder,
            teamInfo: persistedTeam
        };
    }

    async applyStockForOrders(orderIds = [], {orderGoodsModel, goodsModel, productModel} = {}) {
        const normalizedIds = Array.from(new Set((Array.isArray(orderIds) ? orderIds : []).map((item) => this.normalizeId(item)).filter((id) => id > 0)));
        if (normalizedIds.length === 0) {
            return 0;
        }
        const orderGoodsRows = await orderGoodsModel.where({
            order_id: ['IN', normalizedIds],
            is_delete: 0
        }).select();
        for (const row of orderGoodsRows) {
            const goodsId = this.normalizeId(row.goods_id);
            const productId = this.normalizeId(row.product_id);
            const number = this.normalizeId(row.number);
            if (goodsId <= 0 || productId <= 0 || number <= 0) {
                continue;
            }
            await goodsModel.where({
                id: goodsId
            }).decrement('goods_number', number);
            await goodsModel.where({
                id: goodsId
            }).increment('sell_volume', number);
            await productModel.where({
                id: productId
            }).decrement('goods_number', number);
        }
        return orderGoodsRows.length;
    }

    async revertStockForOrders(orderIds = [], {orderGoodsModel, goodsModel, productModel} = {}) {
        const normalizedIds = Array.from(new Set((Array.isArray(orderIds) ? orderIds : []).map((item) => this.normalizeId(item)).filter((id) => id > 0)));
        if (normalizedIds.length === 0) {
            return 0;
        }
        const orderGoodsRows = await orderGoodsModel.where({
            order_id: ['IN', normalizedIds],
            is_delete: 0
        }).select();
        for (const row of orderGoodsRows) {
            const goodsId = this.normalizeId(row.goods_id);
            const productId = this.normalizeId(row.product_id);
            const number = this.normalizeId(row.number);
            if (goodsId <= 0 || productId <= 0 || number <= 0) {
                continue;
            }
            await goodsModel.where({
                id: goodsId
            }).increment('goods_number', number);
            await productModel.where({
                id: productId
            }).increment('goods_number', number);
            await goodsModel.query(`UPDATE hiolabs_goods SET sell_volume = IF(sell_volume >= ${number}, sell_volume - ${number}, 0) WHERE id = ${goodsId} LIMIT 1`);
        }
        return orderGoodsRows.length;
    }

    async handleOrderPaid(orderId, {requestId = '', payResult = null} = {}) {
        const normalizedOrderId = this.normalizeId(orderId);
        if (normalizedOrderId <= 0) {
            return {
                handled: false,
                reason: 'invalid_order_id'
            };
        }
        const rootModel = this.model('order');
        const currentTime = this.nowTs();

        return rootModel.transaction(async() => {
            const orderModel = this.bindTxModel(rootModel, 'order');
            const teamModel = this.bindTxModel(rootModel, 'groupon_team');
            const memberModel = this.bindTxModel(rootModel, 'groupon_team_member');
            const orderGoodsModel = this.bindTxModel(rootModel, 'order_goods');
            const goodsModel = this.bindTxModel(rootModel, 'goods');
            const productModel = this.bindTxModel(rootModel, 'product');

            const member = await memberModel.where({
                order_id: normalizedOrderId,
                is_delete: 0
            }).find();
            if (think.isEmpty(member)) {
                return {
                    handled: false,
                    reason: 'member_not_found'
                };
            }

            const memberId = this.normalizeId(member.id);
            const teamId = this.normalizeId(member.team_id);
            if (this.normalizeId(member.pay_status) === MEMBER_PAY_PAID) {
                return {
                    handled: false,
                    reason: 'already_paid'
                };
            }

            await memberModel.where({
                id: memberId,
                pay_status: ['<>', MEMBER_PAY_PAID]
            }).update({
                pay_status: MEMBER_PAY_PAID,
                pay_time: this.normalizeId(payResult && payResult.time_end || currentTime),
                update_time: currentTime
            });

            const teamInfo = await teamModel.where({
                id: teamId,
                is_delete: 0
            }).find();
            if (think.isEmpty(teamInfo)) {
                return {
                    handled: false,
                    reason: 'team_not_found'
                };
            }

            const team = this.normalizeTeam(teamInfo, currentTime);
            if (team.status !== TEAM_STATUS_ONGOING) {
                return {
                    handled: false,
                    reason: 'team_not_ongoing'
                };
            }

            await orderModel.where({
                id: normalizedOrderId,
                pay_status: ['<>', 2]
            }).update({
                pay_status: 2,
                pay_id: this.normalizeText(payResult && payResult.transaction_id || ''),
                pay_time: this.normalizeId(payResult && payResult.time_end || currentTime)
            });

            const transitionedToGrouping = await orderModel.where({
                id: normalizedOrderId,
                order_status: 801
            }).update({
                order_status: 802
            });

            if (transitionedToGrouping > 0) {
                await this.applyStockForOrders([normalizedOrderId], {
                    orderGoodsModel,
                    goodsModel,
                    productModel
                });
            }

            const paidMembers = await memberModel.where({
                team_id: teamId,
                is_delete: 0,
                pay_status: MEMBER_PAY_PAID
            }).field('id,order_id').select();
            const paidCount = paidMembers.length;
            const targetSize = Math.max(2, this.normalizeId(team.target_size || 2));

            await teamModel.where({
                id: teamId,
                status: TEAM_STATUS_ONGOING
            }).update({
                joined_count: paidCount,
                update_time: currentTime
            });

            if (paidCount < targetSize) {
                return {
                    handled: true,
                    team_status: TEAM_STATUS_ONGOING,
                    paid_count: paidCount,
                    target_size: targetSize
                };
            }

            const paidOrderIds = paidMembers.map((item) => this.normalizeId(item.order_id)).filter((id) => id > 0);
            if (paidOrderIds.length > 0) {
                await orderModel.where({
                    id: ['IN', paidOrderIds],
                    order_status: ['IN', [801, 802]]
                }).update({
                    order_status: 201
                });
            }

            await teamModel.where({
                id: teamId,
                status: TEAM_STATUS_ONGOING
            }).update({
                status: TEAM_STATUS_SUCCESS,
                joined_count: paidCount,
                success_at: currentTime,
                update_time: currentTime
            });

            if (think.logger && typeof think.logger.info === 'function') {
                think.logger.info(`[groupon.handleOrderPaid] requestId=${requestId} orderId=${normalizedOrderId} teamId=${teamId} paidCount=${paidCount}`);
            }

            return {
                handled: true,
                team_status: TEAM_STATUS_SUCCESS,
                paid_count: paidCount,
                target_size: targetSize
            };
        });
    }

    async handleUnpaidOrderClosed(orderId) {
        const normalizedOrderId = this.normalizeId(orderId);
        if (normalizedOrderId <= 0) {
            return 0;
        }
        return this.model('groupon_team_member').where({
            order_id: normalizedOrderId,
            is_delete: 0,
            pay_status: MEMBER_PAY_PENDING
        }).update({
            pay_status: MEMBER_PAY_CANCELED,
            is_delete: 1,
            update_time: this.nowTs()
        });
    }

    async expireSingleTeam(teamId, currentTime = this.nowTs()) {
        const normalizedTeamId = this.normalizeId(teamId);
        if (normalizedTeamId <= 0) {
            return {
                handled: false,
                reason: 'invalid_team_id'
            };
        }

        const rootModel = this.model('order');
        return rootModel.transaction(async() => {
            const teamModel = this.bindTxModel(rootModel, 'groupon_team');
            const memberModel = this.bindTxModel(rootModel, 'groupon_team_member');
            const refundTaskModel = this.bindTxModel(rootModel, 'groupon_refund_task');
            const orderModel = this.bindTxModel(rootModel, 'order');
            const orderGoodsModel = this.bindTxModel(rootModel, 'order_goods');
            const goodsModel = this.bindTxModel(rootModel, 'goods');
            const productModel = this.bindTxModel(rootModel, 'product');

            const teamInfo = await teamModel.where({
                id: normalizedTeamId,
                is_delete: 0
            }).find();
            if (think.isEmpty(teamInfo)) {
                return {
                    handled: false,
                    reason: 'team_not_found'
                };
            }
            const team = this.normalizeTeam(teamInfo, currentTime);
            if (team.status !== TEAM_STATUS_ONGOING || team.expire_at > currentTime) {
                return {
                    handled: false,
                    reason: 'team_not_expired'
                };
            }

            await teamModel.where({
                id: team.id,
                status: TEAM_STATUS_ONGOING
            }).update({
                status: TEAM_STATUS_FAILED,
                failed_at: currentTime,
                update_time: currentTime
            });

            const paidMembers = await memberModel.where({
                team_id: team.id,
                is_delete: 0,
                pay_status: MEMBER_PAY_PAID
            }).field('id,order_id,user_id').select();

            for (const member of paidMembers) {
                const orderId = this.normalizeId(member.order_id);
                if (orderId <= 0) {
                    continue;
                }
                let refundTask = await refundTaskModel.where({
                    order_id: orderId,
                    is_delete: 0
                }).find();

                if (think.isEmpty(refundTask)) {
                    const refundTaskId = await refundTaskModel.add({
                        order_id: orderId,
                        team_id: team.id,
                        user_id: this.normalizeId(member.user_id),
                        status: 0,
                        reason: '拼团超时未成团',
                        refund_no: '',
                        remark: '',
                        stock_reverted: 0,
                        processed_by: 0,
                        processed_at: 0,
                        is_delete: 0,
                        add_time: currentTime,
                        update_time: currentTime
                    });
                    refundTask = {
                        id: refundTaskId,
                        stock_reverted: 0
                    };
                }

                if (this.normalizeId(refundTask.stock_reverted) !== 1) {
                    await this.revertStockForOrders([orderId], {
                        orderGoodsModel,
                        goodsModel,
                        productModel
                    });
                    await refundTaskModel.where({
                        id: this.normalizeId(refundTask.id),
                        stock_reverted: ['<>', 1]
                    }).update({
                        stock_reverted: 1,
                        update_time: currentTime
                    });
                }

                await orderModel.where({
                    id: orderId,
                    order_status: ['IN', [801, 802, 201]]
                }).update({
                    order_status: 202
                });

                await memberModel.where({
                    id: this.normalizeId(member.id)
                }).update({
                    pay_status: MEMBER_PAY_REFUNDING,
                    refund_status: 1,
                    update_time: currentTime
                });
            }

            const pendingMembers = await memberModel.where({
                team_id: team.id,
                is_delete: 0,
                pay_status: MEMBER_PAY_PENDING
            }).field('id,order_id').select();

            const pendingOrderIds = pendingMembers
                .map((item) => this.normalizeId(item.order_id))
                .filter((id) => id > 0);

            if (pendingOrderIds.length > 0) {
                await orderModel.where({
                    id: ['IN', pendingOrderIds],
                    order_status: 801
                }).update({
                    order_status: 102
                });
            }

            const pendingMemberIds = pendingMembers
                .map((item) => this.normalizeId(item.id))
                .filter((id) => id > 0);
            if (pendingMemberIds.length > 0) {
                await memberModel.where({
                    id: ['IN', pendingMemberIds]
                }).update({
                    pay_status: MEMBER_PAY_CANCELED,
                    is_delete: 1,
                    update_time: currentTime
                });
            }

            return {
                handled: true,
                team_id: team.id,
                paid_member_count: paidMembers.length,
                pending_member_count: pendingMembers.length
            };
        });
    }

    async expireTeamsAndCreateRefundTasks(currentTime = this.nowTs()) {
        const nowTs = this.normalizeId(currentTime) || this.nowTs();
        const expiredTeams = await this.model('groupon_team').where({
            status: TEAM_STATUS_ONGOING,
            expire_at: ['<=', nowTs],
            is_delete: 0
        }).field('id').order('id ASC').limit(200).select();

        let handledCount = 0;
        for (const item of expiredTeams) {
            try {
                const result = await this.expireSingleTeam(this.normalizeId(item.id), nowTs);
                if (result && result.handled) {
                    handledCount += 1;
                }
            } catch (error) {
                if (think.logger && typeof think.logger.error === 'function') {
                    think.logger.error(`[groupon.expireTeamsAndCreateRefundTasks] teamId=${item.id} error=${error.message || error}`);
                }
            }
        }
        return {
            scanned: expiredTeams.length,
            handled: handledCount
        };
    }

    async listRefundTasks({status = '', page = 1, size = 10} = {}) {
        const normalizedPage = this.normalizePage(page, 1);
        const normalizedSize = this.normalizeSize(size, 10, 100);
        const where = {
            is_delete: 0
        };
        if (status !== '' && status !== undefined && status !== null) {
            where.status = this.normalizeId(status);
        }
        const data = await this.model('groupon_refund_task')
            .where(where)
            .order('status ASC,id DESC')
            .page(normalizedPage, normalizedSize)
            .countSelect();

        const orderIds = (data.data || []).map((item) => this.normalizeId(item.order_id)).filter((id) => id > 0);
        const teamIds = (data.data || []).map((item) => this.normalizeId(item.team_id)).filter((id) => id > 0);
        const orderMap = new Map();
        const teamMap = new Map();

        if (orderIds.length > 0) {
            const rows = await this.model('order').where({
                id: ['IN', Array.from(new Set(orderIds))]
            }).field('id,order_sn,actual_price,order_status').select();
            rows.forEach((item) => {
                orderMap.set(this.normalizeId(item.id), item);
            });
        }
        if (teamIds.length > 0) {
            const rows = await this.model('groupon_team').where({
                id: ['IN', Array.from(new Set(teamIds))]
            }).field('id,team_sn,status,target_size,joined_count,expire_at').select();
            rows.forEach((item) => {
                teamMap.set(this.normalizeId(item.id), this.normalizeTeam(item));
            });
        }

        data.data = (data.data || []).map((item) => {
            const normalized = Object.assign({}, item, {
                id: this.normalizeId(item.id),
                order_id: this.normalizeId(item.order_id),
                team_id: this.normalizeId(item.team_id),
                user_id: this.normalizeId(item.user_id),
                status: this.normalizeId(item.status),
                stock_reverted: this.normalizeId(item.stock_reverted),
                processed_by: this.normalizeId(item.processed_by),
                processed_at: this.normalizeId(item.processed_at)
            });
            return Object.assign({}, normalized, {
                order_info: orderMap.get(normalized.order_id) || {},
                team_info: teamMap.get(normalized.team_id) || {}
            });
        });

        return data;
    }

    async completeRefundTask({taskId, adminId = 0, refundNo = '', remark = ''} = {}) {
        const normalizedTaskId = this.normalizeId(taskId);
        if (normalizedTaskId <= 0) {
            throw new Error('退款任务不存在');
        }
        const currentTime = this.nowTs();
        const rootModel = this.model('order');
        return rootModel.transaction(async() => {
            const refundTaskModel = this.bindTxModel(rootModel, 'groupon_refund_task');
            const orderModel = this.bindTxModel(rootModel, 'order');
            const memberModel = this.bindTxModel(rootModel, 'groupon_team_member');

            const task = await refundTaskModel.where({
                id: normalizedTaskId,
                is_delete: 0
            }).find();
            if (think.isEmpty(task)) {
                throw new Error('退款任务不存在');
            }
            if (this.normalizeId(task.status) === 1) {
                return {
                    taskId: normalizedTaskId,
                    status: 1,
                    orderId: this.normalizeId(task.order_id),
                    alreadyDone: true
                };
            }

            await refundTaskModel.where({
                id: normalizedTaskId,
                status: 0
            }).update({
                status: 1,
                refund_no: this.normalizeText(refundNo),
                remark: this.normalizeText(remark),
                processed_by: this.normalizeId(adminId),
                processed_at: currentTime,
                update_time: currentTime
            });

            const orderId = this.normalizeId(task.order_id);
            await orderModel.where({
                id: orderId,
                order_status: 202
            }).update({
                order_status: 203
            });

            await memberModel.where({
                order_id: orderId,
                is_delete: 0
            }).update({
                pay_status: MEMBER_PAY_REFUNDED,
                refund_status: 2,
                update_time: currentTime
            });

            return {
                taskId: normalizedTaskId,
                status: 1,
                orderId,
                alreadyDone: false
            };
        });
    }

    async listMyTeams({userId, status = 'all', page = 1, size = 10} = {}) {
        const normalizedUserId = this.normalizeId(userId);
        if (normalizedUserId <= 0) {
            throw new Error('请先登录');
        }
        const normalizedPage = this.normalizePage(page, 1);
        const normalizedSize = this.normalizeSize(size, 10, 50);

        const where = {
            user_id: normalizedUserId,
            is_delete: 0
        };

        const statusText = this.normalizeText(status).toLowerCase();
        if (statusText === 'ongoing') {
            where.pay_status = ['IN', [MEMBER_PAY_PENDING, MEMBER_PAY_PAID]];
        }
        if (statusText === 'success') {
            where.pay_status = MEMBER_PAY_PAID;
        }
        if (statusText === 'failed') {
            where.pay_status = ['IN', [MEMBER_PAY_REFUNDING, MEMBER_PAY_REFUNDED, MEMBER_PAY_CANCELED]];
        }

        const data = await this.model('groupon_team_member')
            .where(where)
            .order('id DESC')
            .page(normalizedPage, normalizedSize)
            .countSelect();

        const teamIds = (data.data || []).map((item) => this.normalizeId(item.team_id)).filter((id) => id > 0);
        const orderIds = (data.data || []).map((item) => this.normalizeId(item.order_id)).filter((id) => id > 0);

        const teamMap = new Map();
        if (teamIds.length > 0) {
            const rows = await this.model('groupon_team').where({
                id: ['IN', Array.from(new Set(teamIds))],
                is_delete: 0
            }).select();
            rows.forEach((item) => {
                teamMap.set(this.normalizeId(item.id), this.normalizeTeam(item));
            });
        }

        const orderMap = new Map();
        if (orderIds.length > 0) {
            const rows = await this.model('order').where({
                id: ['IN', Array.from(new Set(orderIds))]
            }).field('id,order_sn,order_status,actual_price,add_time,pay_time,groupon_activity_id').select();
            rows.forEach((item) => {
                orderMap.set(this.normalizeId(item.id), item);
            });
        }

        const activityIds = Array.from(new Set((Array.from(orderMap.values()) || [])
            .map((item) => this.normalizeId(item.groupon_activity_id))
            .filter((id) => id > 0)));
        const activityMap = new Map();
        if (activityIds.length > 0) {
            const rows = await this.model('groupon_activity').where({
                id: ['IN', activityIds],
                is_delete: 0
            }).field('id,name,activity_tag,group_price,origin_price,goods_id,start_at,end_at,group_size').select();
            rows.forEach((item) => {
                activityMap.set(this.normalizeId(item.id), this.normalizeActivity(item));
            });
        }

        data.data = (data.data || []).map((item) => {
            const normalized = {
                id: this.normalizeId(item.id),
                team_id: this.normalizeId(item.team_id),
                order_id: this.normalizeId(item.order_id),
                order_sn: this.normalizeText(item.order_sn),
                pay_status: this.normalizeId(item.pay_status),
                join_type: this.normalizeId(item.join_type),
                add_time: this.normalizeId(item.add_time),
                pay_time: this.normalizeId(item.pay_time)
            };
            const orderInfo = orderMap.get(normalized.order_id) || {};
            const teamInfo = teamMap.get(normalized.team_id) || {};
            const activityInfo = activityMap.get(this.normalizeId(orderInfo.groupon_activity_id)) || {};
            return Object.assign({}, normalized, {
                order_info: orderInfo,
                team_info: teamInfo,
                activity_info: activityInfo
            });
        });

        return data;
    }
};
