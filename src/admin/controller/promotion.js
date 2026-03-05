const Base = require('./base.js');

const PROMOTION_TYPES = ['seckill', 'timed_discount', 'timed_full_reduction'];
const PROMOTION_STATUS = ['draft', 'enabled', 'disabled'];
const REQUIRED_PROMOTION_TABLES = [
  'hiolabs_promotion',
  'hiolabs_promotion_sku',
  'hiolabs_promotion_tier',
  'hiolabs_promotion_goods',
  'hiolabs_order_promotion',
  'hiolabs_promotion_order_lock'
];
const PROMOTION_SCHEMA_CACHE_MS = 30000;
const promotionSchemaState = {
  checkedAt: 0,
  ready: false
};

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
      const text = value.trim();
      if (!text) return [];
      if (text.startsWith('[') && text.endsWith(']')) {
        try {
          return this.parseIds(JSON.parse(text));
        } catch (err) {
          // ignore parse error and fallback to csv parser
        }
      }
      return Array.from(new Set(text.split(',').map(item => Number(String(item).trim())).filter(item => item > 0)));
    }
    const one = Number(value);
    return one > 0 ? [one] : [];
  }

  parseJsonList(value, fallback = []) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
      } catch (err) {
        return fallback;
      }
    }
    return fallback;
  }

  parseSkuItems(type) {
    const rows = this.parseJsonList(this.post('sku_items'), []);
    if (!rows.length) {
      return { error: '请至少配置一个活动 SKU' };
    }
    const normalized = [];
    const duplicateSet = new Set();
    for (const item of rows) {
      const goodsId = Number(item.goods_id || 0);
      const productId = Number(item.product_id || 0);
      if (goodsId <= 0 || productId <= 0) {
        return { error: 'SKU 配置中的 goods_id/product_id 不正确' };
      }
      const key = `${goodsId}_${productId}`;
      if (duplicateSet.has(key)) {
        return { error: '同一活动内 SKU 不可重复' };
      }
      duplicateSet.add(key);
      const seckillPrice = Number(item.seckill_price || 0);
      const discountRate = Number(item.discount_rate || 0);
      const seckillStock = Number(item.seckill_stock || 0);
      const perUserLimit = Number(item.per_user_limit || 0);
      const sortOrder = Number(item.sort_order || 100);
      if (type === 'seckill') {
        if (seckillPrice <= 0) {
          return { error: '秒杀价必须大于0' };
        }
        if (!Number.isInteger(seckillStock) || seckillStock <= 0) {
          return { error: '秒杀库存必须为正整数' };
        }
      }
      if (type === 'timed_discount') {
        if (discountRate <= 0 || discountRate > 10) {
          return { error: '折扣率需在0~10之间' };
        }
      }
      normalized.push({
        goods_id: goodsId,
        product_id: productId,
        seckill_price: seckillPrice > 0 ? seckillPrice.toFixed(2) : '0.00',
        discount_rate: discountRate > 0 ? discountRate.toFixed(2) : '0.00',
        seckill_stock: Number.isInteger(seckillStock) && seckillStock > 0 ? seckillStock : 0,
        per_user_limit: Number.isInteger(perUserLimit) && perUserLimit > 0 ? perUserLimit : 0,
        sort_order: Number.isInteger(sortOrder) ? sortOrder : 100
      });
    }
    return { data: normalized };
  }

  parseFullReductionPayload() {
    const goodsIds = this.parseIds(this.post('goods_ids'));
    const tiers = this.parseJsonList(this.post('tiers'), []);
    if (!goodsIds.length) {
      return { error: '满减活动至少选择一个商品' };
    }
    if (!tiers.length) {
      return { error: '请至少配置一档满减阶梯' };
    }
    const normalizedTiers = [];
    for (const item of tiers) {
      const threshold = Number(item.threshold_amount || 0);
      const reduce = Number(item.reduce_amount || 0);
      const sortOrder = Number(item.sort_order || 100);
      if (threshold <= 0 || reduce <= 0) {
        return { error: '满减门槛和减免金额必须大于0' };
      }
      if (reduce > threshold) {
        return { error: '减免金额不能大于门槛金额' };
      }
      normalizedTiers.push({
        threshold_amount: threshold.toFixed(2),
        reduce_amount: reduce.toFixed(2),
        sort_order: Number.isInteger(sortOrder) ? sortOrder : 100
      });
    }
    normalizedTiers.sort((a, b) => Number(a.threshold_amount) - Number(b.threshold_amount));
    return {
      data: {
        goodsIds,
        tiers: normalizedTiers
      }
    };
  }

  parsePromotionPayload(isCreate = true) {
    const id = Number(this.post('id') || 0);
    const name = String(this.post('name') || '').trim();
    const type = String(this.post('type') || '').trim();
    const status = String(this.post('status') || 'draft').trim();
    const startAt = Number(this.post('start_at') || 0);
    const endAt = Number(this.post('end_at') || 0);

    if (!name) {
      return { error: '活动名称不能为空' };
    }
    if (!PROMOTION_TYPES.includes(type)) {
      return { error: '活动类型不正确' };
    }
    if (!PROMOTION_STATUS.includes(status)) {
      return { error: '活动状态不正确' };
    }
    if (startAt <= 0 || endAt <= 0 || endAt <= startAt) {
      return { error: '活动时间范围不正确' };
    }
    if (!isCreate && id <= 0) {
      return { error: 'id 不能为空' };
    }

    const payload = {
      name,
      type,
      status,
      start_at: startAt,
      end_at: endAt
    };

    if (type === 'seckill' || type === 'timed_discount') {
      const skuParsed = this.parseSkuItems(type);
      if (skuParsed.error) return { error: skuParsed.error };
      return {
        id,
        payload,
        skuItems: skuParsed.data,
        goodsIds: [],
        tiers: []
      };
    }

    const fullReduction = this.parseFullReductionPayload();
    if (fullReduction.error) return { error: fullReduction.error };
    return {
      id,
      payload,
      skuItems: [],
      goodsIds: fullReduction.data.goodsIds,
      tiers: fullReduction.data.tiers
    };
  }

  async ensurePromotionSchemaReady(force = false) {
    const nowMs = Date.now();
    if (!force && promotionSchemaState.ready && (nowMs - promotionSchemaState.checkedAt) < PROMOTION_SCHEMA_CACHE_MS) {
      return null;
    }
    try {
      const model = this.model('promotion');
      const checks = await Promise.all(
        REQUIRED_PROMOTION_TABLES.map(table => model.query(`SHOW TABLES LIKE '${table}'`))
      );
      const missing = [];
      checks.forEach((rows, idx) => {
        if (!Array.isArray(rows) || rows.length === 0) {
          missing.push(REQUIRED_PROMOTION_TABLES[idx]);
        }
      });
      promotionSchemaState.checkedAt = nowMs;
      promotionSchemaState.ready = missing.length === 0;
      if (missing.length) {
        return this.fail(
          500,
          `促销模块数据库未初始化（缺少表：${missing.join(', ')}），请先执行迁移脚本 hioshop-server/sql/20260304_promotion_v1.sql`
        );
      }
      return null;
    } catch (err) {
      promotionSchemaState.checkedAt = nowMs;
      promotionSchemaState.ready = false;
      return this.fail(500, `促销模块数据库检查失败：${err.message || 'unknown error'}`);
    }
  }

  async syncPromotionSku(promotionId, skuItems, txModel) {
    const model = txModel.model('promotion_sku');
    model.db(txModel.db());
    await model.where({ promotion_id: Number(promotionId) }).delete();
    if (!skuItems.length) return;
    const nowTs = this.now();
    const rows = skuItems.map(item => ({
      promotion_id: Number(promotionId),
      goods_id: Number(item.goods_id),
      product_id: Number(item.product_id),
      seckill_price: String(item.seckill_price || '0.00'),
      discount_rate: String(item.discount_rate || '0.00'),
      seckill_stock: Number(item.seckill_stock || 0),
      locked_stock: 0,
      sold_stock: 0,
      per_user_limit: Number(item.per_user_limit || 0),
      sort_order: Number(item.sort_order || 100),
      add_time: nowTs,
      update_time: nowTs
    }));
    await model.addMany(rows);
  }

  async syncPromotionFullReduction(promotionId, goodsIds, tiers, txModel) {
    const goodsModel = txModel.model('promotion_goods');
    goodsModel.db(txModel.db());
    const tierModel = txModel.model('promotion_tier');
    tierModel.db(txModel.db());
    await goodsModel.where({ promotion_id: Number(promotionId) }).delete();
    await tierModel.where({ promotion_id: Number(promotionId) }).delete();

    if (goodsIds.length) {
      await goodsModel.addMany(goodsIds.map(goodsId => ({
        promotion_id: Number(promotionId),
        goods_id: Number(goodsId)
      })));
    }
    if (tiers.length) {
      await tierModel.addMany(tiers.map(item => ({
        promotion_id: Number(promotionId),
        threshold_amount: item.threshold_amount,
        reduce_amount: item.reduce_amount,
        sort_order: Number(item.sort_order || 100)
      })));
    }
  }

  async listAction() {
    const schemaError = await this.ensurePromotionSchemaReady();
    if (schemaError) return schemaError;
    const page = Number(this.get('page') || 1);
    const size = Number(this.get('size') || 10);
    const keyword = String(this.get('keyword') || '').trim();
    const status = String(this.get('status') || '').trim();
    const type = String(this.get('type') || '').trim();
    const where = { is_delete: 0 };
    if (keyword) {
      where.name = ['like', `%${keyword}%`];
    }
    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }
    const data = await this.model('promotion').where(where).order('id DESC').page(page, size).countSelect();
    const ids = (data.data || []).map(item => Number(item.id || 0)).filter(id => id > 0);
    const stats = {};
    ids.forEach((id) => {
      stats[id] = { sku_count: 0, goods_count: 0, tier_count: 0 };
    });
    if (ids.length) {
      const [skuRows, goodsRows, tierRows] = await Promise.all([
        this.model('promotion_sku').query(`SELECT promotion_id, COUNT(1) AS cnt FROM hiolabs_promotion_sku WHERE promotion_id IN (${ids.join(',')}) GROUP BY promotion_id`),
        this.model('promotion_goods').query(`SELECT promotion_id, COUNT(1) AS cnt FROM hiolabs_promotion_goods WHERE promotion_id IN (${ids.join(',')}) GROUP BY promotion_id`),
        this.model('promotion_tier').query(`SELECT promotion_id, COUNT(1) AS cnt FROM hiolabs_promotion_tier WHERE promotion_id IN (${ids.join(',')}) GROUP BY promotion_id`)
      ]);
      skuRows.forEach((item) => {
        const id = Number(item.promotion_id || 0);
        if (stats[id]) stats[id].sku_count = Number(item.cnt || 0);
      });
      goodsRows.forEach((item) => {
        const id = Number(item.promotion_id || 0);
        if (stats[id]) stats[id].goods_count = Number(item.cnt || 0);
      });
      tierRows.forEach((item) => {
        const id = Number(item.promotion_id || 0);
        if (stats[id]) stats[id].tier_count = Number(item.cnt || 0);
      });
    }
    data.data = (data.data || []).map(item => Object.assign({}, item, stats[Number(item.id || 0)] || {}));
    return this.success(data);
  }

  async detailAction() {
    const schemaError = await this.ensurePromotionSchemaReady();
    if (schemaError) return schemaError;
    const id = Number(this.get('id') || 0);
    if (id <= 0) {
      return this.fail(400, 'id 不能为空');
    }
    const info = await this.model('promotion').where({ id, is_delete: 0 }).find();
    if (think.isEmpty(info)) {
      return this.fail(404, '活动不存在');
    }
    if (String(info.type) === 'timed_full_reduction') {
      const [goodsRows, tierRows] = await Promise.all([
        this.model('promotion_goods').where({ promotion_id: id }).select(),
        this.model('promotion_tier').where({ promotion_id: id }).order('threshold_amount ASC, sort_order ASC, id ASC').select()
      ]);
      info.goods_ids = goodsRows.map(item => Number(item.goods_id || 0));
      info.tiers = tierRows;
      info.sku_items = [];
    } else {
      info.sku_items = await this.model('promotion_sku').query(`
        SELECT
          ps.*,
          COALESCE(g.name, p.goods_name, '') AS goods_name,
          COALESCE(gs.value, '') AS spec_value,
          p.goods_sn
        FROM hiolabs_promotion_sku ps
        LEFT JOIN hiolabs_product p ON ps.product_id = p.id AND p.is_delete = 0
        LEFT JOIN hiolabs_goods g ON ps.goods_id = g.id
        LEFT JOIN hiolabs_goods_specification gs ON p.goods_specification_ids = gs.id AND gs.is_delete = 0
        WHERE ps.promotion_id = ${Number(id)}
        ORDER BY ps.sort_order ASC, ps.id ASC
      `);
      info.goods_ids = [];
      info.tiers = [];
    }
    return this.success(info);
  }

  async createAction() {
    const schemaError = await this.ensurePromotionSchemaReady();
    if (schemaError) return schemaError;
    const parsed = this.parsePromotionPayload(true);
    if (parsed.error) {
      return this.fail(400, parsed.error);
    }
    const nowTs = this.now();
    const txModel = this.model('promotion');
    let id = 0;
    try {
      await txModel.transaction(async () => {
        const promotionModel = txModel.model('promotion');
        promotionModel.db(txModel.db());
        id = await promotionModel.add(Object.assign({
          promotion_key: `PR${nowTs}${Math.floor(Math.random() * 9000 + 1000)}`,
          is_delete: 0,
          add_time: nowTs,
          update_time: nowTs
        }, parsed.payload));
        if (!id) {
          throw new Error('创建活动失败');
        }
        if (parsed.skuItems.length) {
          await this.syncPromotionSku(id, parsed.skuItems, txModel);
        }
        if (parsed.goodsIds.length || parsed.tiers.length) {
          await this.syncPromotionFullReduction(id, parsed.goodsIds, parsed.tiers, txModel);
        }
      });
      return this.success({ id: Number(id) });
    } catch (err) {
      if (String(err.message || '') === 'add data is empty') {
        return this.fail(500, '促销表结构异常或未初始化，请执行迁移脚本 hioshop-server/sql/20260304_promotion_v1.sql 后重试');
      }
      return this.fail(400, err.message || '创建失败');
    }
  }

  async updateAction() {
    const schemaError = await this.ensurePromotionSchemaReady();
    if (schemaError) return schemaError;
    const parsed = this.parsePromotionPayload(false);
    if (parsed.error) {
      return this.fail(400, parsed.error);
    }
    const nowTs = this.now();
    const txModel = this.model('promotion');
    try {
      await txModel.transaction(async () => {
        const promotionModel = txModel.model('promotion');
        promotionModel.db(txModel.db());
        const existed = await promotionModel.where({ id: parsed.id, is_delete: 0 }).find();
        if (think.isEmpty(existed)) {
          throw new Error('活动不存在');
        }
        await promotionModel.where({ id: parsed.id }).update(Object.assign({}, parsed.payload, {
          update_time: nowTs
        }));
        await this.syncPromotionSku(parsed.id, parsed.skuItems, txModel);
        await this.syncPromotionFullReduction(parsed.id, parsed.goodsIds, parsed.tiers, txModel);
      });
      return this.success();
    } catch (err) {
      if (String(err.message || '') === 'add data is empty') {
        return this.fail(500, '促销表结构异常或未初始化，请执行迁移脚本 hioshop-server/sql/20260304_promotion_v1.sql 后重试');
      }
      return this.fail(400, err.message || '保存失败');
    }
  }

  async toggleAction() {
    const schemaError = await this.ensurePromotionSchemaReady();
    if (schemaError) return schemaError;
    const id = Number(this.post('id') || 0);
    const status = String(this.post('status') || '').trim();
    if (id <= 0) {
      return this.fail(400, 'id 不能为空');
    }
    if (!['enabled', 'disabled'].includes(status)) {
      return this.fail(400, 'status 参数不正确');
    }
    const affected = await this.model('promotion').where({ id, is_delete: 0 }).update({
      status,
      update_time: this.now()
    });
    if (Number(affected) !== 1) {
      return this.fail(404, '活动不存在');
    }
    return this.success();
  }

  async deleteAction() {
    const schemaError = await this.ensurePromotionSchemaReady();
    if (schemaError) return schemaError;
    const id = Number(this.post('id') || 0);
    if (id <= 0) {
      return this.fail(400, 'id 不能为空');
    }
    const affected = await this.model('promotion').where({ id, is_delete: 0 }).update({
      is_delete: 1,
      status: 'disabled',
      update_time: this.now()
    });
    if (Number(affected) !== 1) {
      return this.fail(404, '活动不存在');
    }
    return this.success();
  }

  async reportAction() {
    const schemaError = await this.ensurePromotionSchemaReady();
    if (schemaError) return schemaError;
    const page = Number(this.get('page') || 1);
    const size = Number(this.get('size') || 10);
    const startAt = Number(this.get('start_at') || 0);
    const endAt = Number(this.get('end_at') || 0);
    const promotionId = Number(this.get('promotion_id') || this.get('promotionId') || 0);
    const offset = (page - 1) * size;
    const where = ['op.id > 0'];
    if (startAt > 0) {
      where.push(`o.add_time >= ${startAt}`);
    }
    if (endAt > 0) {
      where.push(`o.add_time <= ${endAt}`);
    }
    if (promotionId > 0) {
      where.push(`op.promotion_id = ${promotionId}`);
    }
    const whereSql = where.join(' AND ');
    const listSql = `
      SELECT
        op.promotion_id,
        op.promotion_type,
        op.promotion_name_snapshot AS promotion_name,
        COUNT(DISTINCT op.order_id) AS order_count,
        SUM(op.discount_amount) AS total_discount_amount,
        SUM(o.actual_price) AS total_actual_amount
      FROM hiolabs_order_promotion op
      INNER JOIN hiolabs_order o ON op.order_id = o.id
      WHERE ${whereSql}
      GROUP BY op.promotion_id, op.promotion_type, op.promotion_name_snapshot
      ORDER BY order_count DESC, total_discount_amount DESC
      LIMIT ${offset}, ${size}
    `;
    const countSql = `SELECT COUNT(1) AS total FROM (SELECT op.promotion_id FROM hiolabs_order_promotion op INNER JOIN hiolabs_order o ON op.order_id = o.id WHERE ${whereSql} GROUP BY op.promotion_id) t`;
    const [rows, countRows] = await Promise.all([
      this.model('order_promotion').query(listSql),
      this.model('order_promotion').query(countSql)
    ]);
    const total = Number(countRows[0] && countRows[0].total || 0);
    return this.success({
      count: total,
      currentPage: page,
      totalPages: Math.ceil(total / size),
      data: rows
    });
  }
};
