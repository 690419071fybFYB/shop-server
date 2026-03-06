const Base = require('./base.js');
const moment = require('moment');

module.exports = class extends Base {
  normalizePlacement(value) {
    const placement = Number(value || 1);
    if ([1, 2, 3].includes(placement)) {
      return placement;
    }
    return 1;
  }

  normalizeLinkType(value) {
    const linkType = Number(value || 0);
    if (linkType === 1) {
      return 1;
    }
    return 0;
  }

  normalizeEnabled(value) {
    if (value === true || value === 'true' || value === 1 || value === '1') {
      return 1;
    }
    return 0;
  }

  sanitizeTitle(value) {
    return String(value || '').trim().slice(0, 64);
  }

  parseDateToSeconds(value, fallback = 0) {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      if (num > 1000000000000) {
        return Math.floor(num / 1000);
      }
      if (num > 1000000000) {
        return Math.floor(num);
      }
    }
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NaN;
    }
    return Math.floor(parsed / 1000);
  }

  sanitizeMiniProgramPath(value) {
    return String(value || '').trim();
  }

  isValidMiniProgramPath(value) {
    if (!value) {
      return false;
    }
    return /^\/pages\/[a-zA-Z0-9_/-]+(?:\?[^#\s]*)?$/.test(value);
  }

  formatListRow(item) {
    const row = Object.assign({}, item);
    row.enabled = Number(row.enabled || 0) === 1;
    row.placement = this.normalizePlacement(row.placement);
    row.title = String(row.title || '');
    row.start_time = Number(row.start_time || 0);
    row.end_time = Number(row.end_time || 0);
    row.start_time_text = row.start_time > 0 ? moment.unix(row.start_time).format('YYYY-MM-DD HH:mm:ss') : '';
    row.end_time_text = row.end_time > 0 ? moment.unix(row.end_time).format('YYYY-MM-DD HH:mm:ss') : '';
    return row;
  }

  validatePayload(rawValues) {
    const values = Object.assign({}, rawValues || {});
    const payload = {};
    payload.title = this.sanitizeTitle(values.title);
    payload.link_type = this.normalizeLinkType(values.link_type);
    payload.placement = this.normalizePlacement(values.placement);
    payload.sort_order = Number(values.sort_order || 0);
    payload.enabled = this.normalizeEnabled(values.enabled);
    payload.image_url = String(values.image_url || '').trim();
    payload.start_time = this.parseDateToSeconds(values.start_time, 0);
    payload.end_time = this.parseDateToSeconds(values.end_time, 0);
    payload.goods_id = Number(values.goods_id || 0);
    payload.link = this.sanitizeMiniProgramPath(values.link);

    if (!payload.image_url) {
      return {error: '广告图片不能为空'};
    }
    if (!Number.isFinite(payload.start_time) || !Number.isFinite(payload.end_time) || payload.start_time <= 0 || payload.end_time <= 0) {
      return {error: '开始时间和结束时间不能为空'};
    }
    if (payload.start_time >= payload.end_time) {
      return {error: '开始时间必须早于结束时间'};
    }
    if (payload.placement === 2 || payload.placement === 3) {
      if (!payload.title) {
        return {error: '弹窗广告标题不能为空'};
      }
    }
    if (payload.link_type === 0) {
      if (payload.goods_id <= 0) {
        return {error: '请选择商品'};
      }
      payload.link = '';
    } else {
      payload.goods_id = 0;
      if (!this.isValidMiniProgramPath(payload.link)) {
        return {error: '广告链接必须是小程序页面路径，例如 /pages/coupon-center/index'};
      }
    }
    return {payload};
  }

  async indexAction() {
    const page = this.get('page') || 1;
    const size = this.get('size') || 10;
    const model = this.model('ad');
    const data = await model.where({
      is_delete: 0
    }).order(['id DESC']).page(page, size).countSelect();
    data.data = (data.data || []).map(item => this.formatListRow(item));
    return this.success(data);
  }

  async updateSortAction() {
    const id = Number(this.post('id') || 0);
    const sort = Number(this.post('sort') || 0);
    if (id <= 0) {
      return this.fail(400, '广告ID不能为空');
    }
    const model = this.model('ad');
    const data = await model.where({
      id: id
    }).update({
      sort_order: sort
    });
    return this.success(data);
  }

  async infoAction() {
    const id = Number(this.get('id') || 0);
    if (id <= 0) {
      return this.fail(400, '广告ID不能为空');
    }
    const model = this.model('ad');
    const data = await model.where({
      id: id,
      is_delete: 0
    }).find();
    if (think.isEmpty(data)) {
      return this.fail(404, '广告不存在');
    }
    data.placement = this.normalizePlacement(data.placement);
    data.title = String(data.title || '');
    data.start_time = Number(data.start_time || 0);
    data.end_time = Number(data.end_time || 0);
    return this.success(data);
  }

  async storeAction() {
    if (!this.isPost) {
      return false;
    }
    const id = Number(this.post('id') || 0);
    const checked = this.validatePayload(this.post());
    if (checked.error) {
      return this.fail(400, checked.error);
    }
    const payload = checked.payload;
    const model = this.model('ad');
    if (id > 0) {
      const existed = await model.where({
        id,
        is_delete: 0
      }).find();
      if (think.isEmpty(existed)) {
        return this.fail(404, '广告不存在');
      }
      await model.where({id}).update(payload);
      return this.success(Object.assign({id}, payload));
    }
    if (payload.link_type === 0 && payload.goods_id > 0) {
      const ex = await model.where({
        goods_id: payload.goods_id,
        link_type: 0,
        is_delete: 0
      }).find();
      if (!think.isEmpty(ex)) {
        return this.fail(100, '该商品已经有广告关联');
      }
    }
    const newId = await model.add(payload);
    return this.success(Object.assign({id: Number(newId || 0)}, payload));
  }

  async getallrelateAction() {
    let data = await this.model('goods').where({
      is_on_sale: 1,
      is_delete: 0
    }).field('id,name,list_pic_url').select();
    return this.success(data);
  }

  async destoryAction() {
    const id = Number(this.post('id') || 0);
    if (id <= 0) {
      return this.fail(400, '广告ID不能为空');
    }
    await this.model('ad').where({
      id: id
    }).limit(1).update({
      is_delete: 1
    });
    return this.success();
  }

  async saleStatusAction() {
    const id = Number(this.get('id') || 0);
    const status = this.get('status');
    if (id <= 0) {
      return this.fail(400, '广告ID不能为空');
    }
    const sale = this.normalizeEnabled(status);
    const model = this.model('ad');
    await model.where({
      id: id
    }).update({
      enabled: sale
    });
    return this.success();
  }
};
