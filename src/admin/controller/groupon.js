const Base = require('./base.js');

module.exports = class extends Base {
  now() {
    return parseInt(Date.now() / 1000, 10);
  }

  normalizeId(value) {
    const id = parseInt(value || 0, 10);
    return Number.isFinite(id) && id > 0 ? id : 0;
  }

  normalizePage(value, fallback = 1) {
    const page = parseInt(value || fallback, 10);
    if (!Number.isFinite(page) || page <= 0) {
      return fallback;
    }
    return page;
  }

  normalizeSize(value, fallback = 10) {
    const size = parseInt(value || fallback, 10);
    if (!Number.isFinite(size) || size <= 0) {
      return fallback;
    }
    return Math.min(50, size);
  }

  normalizeStatus(status) {
    const current = String(status || 'draft').trim();
    if (['draft', 'enabled', 'disabled'].includes(current)) {
      return current;
    }
    return 'draft';
  }

  parsePayload(isCreate = true) {
    const id = this.normalizeId(this.post('id'));
    const name = String(this.post('name') || '').trim();
    const promoTag = String(this.post('promo_tag') || '').trim();
    const goodsId = this.normalizeId(this.post('goods_id'));
    const productId = this.normalizeId(this.post('product_id'));
    const groupPrice = Number(this.post('group_price') || 0);
    const retailPrice = Number(this.post('retail_price') || 0);
    const groupSize = parseInt(this.post('group_size') || 2, 10);
    const durationHours = parseInt(this.post('duration_hours') || this.post('expire_hours') || 24, 10);
    const startAt = parseInt(this.post('start_at') || 0, 10);
    const endAt = parseInt(this.post('end_at') || 0, 10);
    const status = this.normalizeStatus(this.post('status'));

    if (!name) {
      return {error: '活动名称不能为空'};
    }
    if (!goodsId || !productId) {
      return {error: '请选择活动商品和规格'};
    }
    if (!Number.isFinite(groupPrice) || groupPrice <= 0) {
      return {error: '拼团价必须大于0'};
    }
    if (!Number.isFinite(groupSize) || groupSize < 2) {
      return {error: '成团人数最少为2人'};
    }
    if (!Number.isFinite(durationHours) || durationHours < 1) {
      return {error: '成团时效至少1小时'};
    }
    if (!startAt || !endAt || endAt <= startAt) {
      return {error: '活动时间范围不正确'};
    }
    if (!isCreate && !id) {
      return {error: '活动ID不能为空'};
    }

    return {
      id,
      payload: {
        name,
        promo_tag: promoTag,
        goods_id: goodsId,
        product_id: productId,
        group_price: Number(groupPrice).toFixed(2),
        origin_price: Number.isFinite(retailPrice) && retailPrice > 0 ? Number(retailPrice).toFixed(2) : '0.00',
        retail_price: Number.isFinite(retailPrice) && retailPrice > 0 ? Number(retailPrice).toFixed(2) : '0.00',
        group_size: Math.max(2, parseInt(groupSize, 10)),
        expire_hours: Math.max(1, parseInt(durationHours, 10)),
        duration_hours: Math.max(1, parseInt(durationHours, 10)),
        start_at: startAt,
        end_at: endAt,
        status
      }
    };
  }

  async resolveGoodsSnapshot({goodsId, productId, fallbackRetailPrice = '0.00'} = {}) {
    const goodsInfo = await this.model('goods').where({
      id: this.normalizeId(goodsId),
      is_delete: 0
    }).field('id,name,goods_aka,list_pic_url').find();
    if (think.isEmpty(goodsInfo)) {
      throw new Error('商品不存在');
    }

    const productInfo = await this.model('product').where({
      id: this.normalizeId(productId),
      goods_id: this.normalizeId(goodsId)
    }).field('id,retail_price').find();
    if (think.isEmpty(productInfo)) {
      throw new Error('商品规格不存在');
    }

    const resolvedRetailPrice = Number(productInfo.retail_price || fallbackRetailPrice || 0);
    return {
      goodsInfo,
      productInfo,
      retailPrice: Number.isFinite(resolvedRetailPrice) ? resolvedRetailPrice.toFixed(2) : '0.00'
    };
  }

  async activityListAction() {
    const page = this.normalizePage(this.get('page'), 1);
    const size = this.normalizeSize(this.get('size'), 10);
    const keyword = String(this.get('keyword') || '').trim();
    const status = String(this.get('status') || '').trim();

    const where = {
      is_delete: 0
    };
    if (keyword) {
      where.name = ['like', `%${keyword}%`];
    }
    if (status) {
      where.status = status;
    }

    const data = await this.model('groupon_activity').where(where).order('id DESC').page(page, size).countSelect();
    const nowTs = this.now();
    data.data = (data.data || []).map((item) => {
      const startAt = Number(item.start_at || 0);
      const endAt = Number(item.end_at || 0);
      let activityState = 'upcoming';
      if (nowTs > endAt) {
        activityState = 'ended';
      } else if (nowTs >= startAt) {
        activityState = 'ongoing';
      }
      return {
        ...item,
        activity_state: activityState,
        countdown_seconds: Math.max(0, endAt - nowTs)
      };
    });
    return this.success(data);
  }

  async activityDetailAction() {
    const id = this.normalizeId(this.get('id'));
    if (!id) {
      return this.fail(400, '活动ID不能为空');
    }
    const info = await this.model('groupon_activity').where({
      id,
      is_delete: 0
    }).find();
    if (think.isEmpty(info)) {
      return this.fail(404, '活动不存在');
    }
    return this.success(info);
  }

  async activityCreateAction() {
    const parsed = this.parsePayload(true);
    if (parsed.error) {
      return this.fail(400, parsed.error);
    }
    try {
      const snapshot = await this.resolveGoodsSnapshot({
        goodsId: parsed.payload.goods_id,
        productId: parsed.payload.product_id,
        fallbackRetailPrice: parsed.payload.retail_price
      });
      const nowTs = this.now();
      const id = await this.model('groupon_activity').add({
        ...parsed.payload,
        origin_price: snapshot.retailPrice,
        retail_price: snapshot.retailPrice,
        is_delete: 0,
        add_time: nowTs,
        update_time: nowTs
      });
      return this.success({id});
    } catch (error) {
      return this.fail(400, error.message || '创建失败');
    }
  }

  async activityUpdateAction() {
    const parsed = this.parsePayload(false);
    if (parsed.error) {
      return this.fail(400, parsed.error);
    }
    const existed = await this.model('groupon_activity').where({
      id: parsed.id,
      is_delete: 0
    }).find();
    if (think.isEmpty(existed)) {
      return this.fail(404, '活动不存在');
    }
    try {
      const snapshot = await this.resolveGoodsSnapshot({
        goodsId: parsed.payload.goods_id,
        productId: parsed.payload.product_id,
        fallbackRetailPrice: parsed.payload.retail_price
      });
      await this.model('groupon_activity').where({id: parsed.id}).update({
        ...parsed.payload,
        origin_price: snapshot.retailPrice,
        retail_price: snapshot.retailPrice,
        update_time: this.now()
      });
      return this.success();
    } catch (error) {
      return this.fail(400, error.message || '更新失败');
    }
  }

  async activityToggleAction() {
    const id = this.normalizeId(this.post('id'));
    const status = this.normalizeStatus(this.post('status'));
    if (!id) {
      return this.fail(400, '活动ID不能为空');
    }
    if (!['enabled', 'disabled'].includes(status)) {
      return this.fail(400, '状态不正确');
    }
    const affected = await this.model('groupon_activity').where({
      id,
      is_delete: 0
    }).update({
      status,
      update_time: this.now()
    });
    if (Number(affected) !== 1) {
      return this.fail(404, '活动不存在');
    }
    return this.success();
  }

  async activityDeleteAction() {
    const id = this.normalizeId(this.post('id'));
    if (!id) {
      return this.fail(400, '活动ID不能为空');
    }
    const affected = await this.model('groupon_activity').where({
      id,
      is_delete: 0
    }).update({
      is_delete: 1,
      update_time: this.now()
    });
    if (Number(affected) !== 1) {
      return this.fail(404, '活动不存在');
    }
    return this.success();
  }

  async refundTaskListAction() {
    const page = this.normalizePage(this.get('page'), 1);
    const size = this.normalizeSize(this.get('size'), 20);
    const statusRaw = this.get('status');
    const status = statusRaw === undefined || statusRaw === null || statusRaw === ''
      ? ''
      : parseInt(statusRaw, 10);

    const grouponService = this.service('groupon', 'api');
    const data = await grouponService.listRefundTasks({
      page,
      size,
      status
    });
    return this.success(data);
  }

  async refundTaskCompleteAction() {
    const taskId = this.normalizeId(this.post('id') || this.post('taskId'));
    if (!taskId) {
      return this.fail(400, '工单ID不能为空');
    }
    const adminId = this.normalizeId(this.ctx && this.ctx.state && this.ctx.state.userId);
    const refundSn = String(this.post('refund_sn') || this.post('refundSn') || '').trim();
    const remark = String(this.post('remark') || '').trim();
    try {
      const grouponService = this.service('groupon', 'api');
      await grouponService.completeRefundTask({
        taskId,
        adminId,
        refundNo: refundSn,
        remark
      });
      return this.success();
    } catch (error) {
      return this.fail(400, error.message || '标记退款完成失败');
    }
  }
};
