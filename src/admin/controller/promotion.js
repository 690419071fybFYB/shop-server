const Base = require('./base.js');

module.exports = class extends Base {
  now() {
    return parseInt(Date.now() / 1000, 10);
  }

  parseIds(value) {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map(item => Number(item)).filter(item => item > 0)));
    }
    if (value === undefined || value === null || value === '') {
      return [];
    }
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw) return [];
      if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return Array.from(new Set(parsed.map(item => Number(item)).filter(item => item > 0)));
          }
        } catch (err) {
          // ignore parse error and fallback to csv parse
        }
      }
      return Array.from(new Set(raw.split(',').map(item => Number(String(item).trim())).filter(item => item > 0)));
    }
    const one = Number(value);
    return one > 0 ? [one] : [];
  }

  parsePayload(isCreate = true) {
    const id = Number(this.post('id') || 0);
    const name = String(this.post('name') || '').trim();
    const promoTag = String(this.post('promo_tag') || '').trim();
    const promoType = String(this.post('promo_type') || 'discount').trim();
    const discountRate = Number(this.post('discount_rate') || 10);
    const reduceAmount = Number(this.post('reduce_amount') || 0);
    const scopeType = String(this.post('scope_type') || 'all').trim();
    const goodsIds = this.parseIds(this.post('goods_ids'));
    const startAt = Number(this.post('start_at') || 0);
    const endAt = Number(this.post('end_at') || 0);
    const status = String(this.post('status') || 'draft').trim();
    const priority = Number(this.post('priority') || 0);

    if (!name) {
      return {error: '活动名称不能为空'};
    }
    if (![ 'discount', 'direct_reduce' ].includes(promoType)) {
      return {error: '促销类型不正确'};
    }
    if (promoType === 'discount') {
      if (Number.isNaN(discountRate) || discountRate <= 0 || discountRate >= 10) {
        return {error: '折扣率需在0到10之间'};
      }
    }
    if (promoType === 'direct_reduce') {
      if (Number.isNaN(reduceAmount) || reduceAmount <= 0) {
        return {error: '直减金额需大于0'};
      }
    }
    if (![ 'all', 'goods' ].includes(scopeType)) {
      return {error: '适用范围不正确'};
    }
    if (scopeType === 'goods' && !goodsIds.length) {
      return {error: '指定商品活动需要配置 goods_ids'};
    }
    if (!startAt || !endAt || endAt <= startAt) {
      return {error: '活动时间范围不正确'};
    }
    if (![ 'draft', 'enabled', 'disabled' ].includes(status)) {
      return {error: '状态不正确'};
    }
    if (Number.isNaN(priority)) {
      return {error: '优先级不正确'};
    }
    if (!isCreate && id <= 0) {
      return {error: 'id 不能为空'};
    }

    return {
      id,
      payload: {
        name,
        promo_tag: promoTag,
        promo_type: promoType,
        discount_rate: Number.isNaN(discountRate) ? '10.00' : discountRate.toFixed(2),
        reduce_amount: Number.isNaN(reduceAmount) ? '0.00' : reduceAmount.toFixed(2),
        scope_type: scopeType,
        goodsIds,
        start_at: parseInt(startAt, 10),
        end_at: parseInt(endAt, 10),
        status,
        priority: parseInt(priority, 10)
      }
    };
  }

  async syncPromotionGoods(promotionId, goodsIds, txModel) {
    const model = txModel.model('promotion_goods');
    model.db(txModel.db());
    await model.where({promotion_id: Number(promotionId)}).delete();
    if (!goodsIds.length) return;
    const nowTs = this.now();
    const rows = goodsIds.map(goodsId => ({
      promotion_id: Number(promotionId),
      goods_id: Number(goodsId),
      add_time: nowTs,
      update_time: nowTs
    }));
    await model.addMany(rows);
  }

  buildActivityState(row, nowTs) {
    const startAt = Number(row.start_at || 0);
    const endAt = Number(row.end_at || 0);
    if (nowTs < startAt) return 'upcoming';
    if (nowTs > endAt) return 'ended';
    return 'ongoing';
  }

  async listAction() {
    const page = Number(this.get('page') || 1);
    const size = Number(this.get('size') || 10);
    const keyword = String(this.get('keyword') || '').trim();
    const status = String(this.get('status') || '').trim();
    const promoType = String(this.get('promoType') || '').trim();

    const where = {
      is_delete: 0
    };
    if (keyword) {
      where.name = ['like', `%${keyword}%`];
    }
    if (status) {
      where.status = status;
    }
    if (promoType) {
      where.promo_type = promoType;
    }

    const data = await this.model('promotion').where(where).order('id DESC').page(page, size).countSelect();
    const ids = (data.data || []).map(item => Number(item.id || 0)).filter(id => id > 0);
    const goodsCountMap = {};
    if (ids.length) {
      const rows = await this.model('promotion_goods').query(`
        SELECT promotion_id, COUNT(1) AS cnt
        FROM hiolabs_promotion_goods
        WHERE promotion_id IN (${ids.join(',')})
        GROUP BY promotion_id
      `);
      rows.forEach((row) => {
        goodsCountMap[Number(row.promotion_id)] = Number(row.cnt || 0);
      });
    }
    const nowTs = this.now();
    data.data = (data.data || []).map((item) => ({
      ...item,
      goods_count: goodsCountMap[Number(item.id)] || 0,
      activity_state: this.buildActivityState(item, nowTs)
    }));
    return this.success(data);
  }

  async detailAction() {
    const id = Number(this.get('id') || 0);
    if (id <= 0) {
      return this.fail(400, 'id 不能为空');
    }
    const info = await this.model('promotion').where({
      id,
      is_delete: 0
    }).find();
    if (think.isEmpty(info)) {
      return this.fail(404, '促销活动不存在');
    }
    const goodsRows = await this.model('promotion_goods').where({
      promotion_id: id
    }).select();
    info.goods_ids = goodsRows.map(item => Number(item.goods_id));
    return this.success(info);
  }

  async createAction() {
    const parsed = this.parsePayload(true);
    if (parsed.error) {
      return this.fail(400, parsed.error);
    }
    const nowTs = this.now();
    const txModel = this.model('promotion');
    let promotionId = 0;
    try {
      await txModel.transaction(async () => {
        const promotionModel = txModel.model('promotion');
        promotionModel.db(txModel.db());
        const {goodsIds, ...promotionData} = parsed.payload;
        promotionId = await promotionModel.add({
          ...promotionData,
          is_delete: 0,
          add_time: nowTs,
          update_time: nowTs
        });
        await this.syncPromotionGoods(promotionId, goodsIds, txModel);
      });
      return this.success({id: Number(promotionId)});
    } catch (err) {
      return this.fail(400, err.message || '创建失败');
    }
  }

  async updateAction() {
    const parsed = this.parsePayload(false);
    if (parsed.error) {
      return this.fail(400, parsed.error);
    }
    const nowTs = this.now();
    const txModel = this.model('promotion');
    try {
      await txModel.transaction(async () => {
        const promotionModel = txModel.model('promotion');
        promotionModel.db(txModel.db());
        const existed = await promotionModel.where({
          id: parsed.id,
          is_delete: 0
        }).find();
        if (think.isEmpty(existed)) {
          throw new Error('促销活动不存在');
        }
        const {goodsIds, ...promotionData} = parsed.payload;
        await promotionModel.where({id: parsed.id}).update({
          ...promotionData,
          update_time: nowTs
        });
        await this.syncPromotionGoods(parsed.id, goodsIds, txModel);
      });
      return this.success();
    } catch (err) {
      return this.fail(400, err.message || '保存失败');
    }
  }

  async toggleAction() {
    const id = Number(this.post('id') || 0);
    const status = String(this.post('status') || '').trim();
    if (id <= 0) {
      return this.fail(400, 'id 不能为空');
    }
    if (![ 'enabled', 'disabled' ].includes(status)) {
      return this.fail(400, 'status 参数不正确');
    }
    const affected = await this.model('promotion').where({
      id,
      is_delete: 0
    }).update({
      status,
      update_time: this.now()
    });
    if (Number(affected) !== 1) {
      return this.fail(404, '促销活动不存在');
    }
    return this.success();
  }

  async deleteAction() {
    const id = Number(this.post('id') || 0);
    if (id <= 0) {
      return this.fail(400, 'id 不能为空');
    }
    const affected = await this.model('promotion').where({
      id,
      is_delete: 0
    }).update({
      is_delete: 1,
      update_time: this.now()
    });
    if (Number(affected) !== 1) {
      return this.fail(404, '促销活动不存在');
    }
    return this.success();
  }
};
