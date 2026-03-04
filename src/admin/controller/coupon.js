const Base = require('./base.js');
const ExcelJS = require('exceljs');

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

  parseSegmentRules(raw) {
    let rules = raw;
    if (typeof raw === 'string') {
      try {
        rules = JSON.parse(raw);
      } catch (err) {
        rules = null;
      }
    }
    if (!rules || typeof rules !== 'object') {
      return {
        groups: ['new_customer', 'old_customer'],
        match: 'OR'
      };
    }
    const groups = Array.isArray(rules.groups) ? rules.groups.filter(Boolean) : ['new_customer', 'old_customer'];
    const match = String(rules.match || 'OR').toUpperCase() === 'AND' ? 'AND' : 'OR';
    return {groups, match};
  }

  parseCouponPayload(isCreate = true) {
    const id = Number(this.post('id') || 0);
    const name = String(this.post('name') || '').trim();
    const type = String(this.post('type') || 'full_reduction').trim();
    const thresholdAmount = Number(this.post('threshold_amount') || 0);
    const reduceAmount = Number(this.post('reduce_amount') || 0);
    const discountRate = Number(this.post('discount_rate') || 10);
    const discountMaxReduce = Number(this.post('discount_max_reduce') || 0);
    const scopeType = String(this.post('scope_type') || 'all').trim();
    const claimStartAt = Number(this.post('claim_start_at') || 0);
    const claimEndAt = Number(this.post('claim_end_at') || 0);
    const useStartAt = Number(this.post('use_start_at') || 0);
    const useEndAt = Number(this.post('use_end_at') || 0);
    const totalLimit = Number(this.post('total_limit') || 0);
    const perUserLimit = Number(this.post('per_user_limit') || 1);
    const status = String(this.post('status') || 'draft').trim();
    const goodsIds = this.parseIds(this.post('goods_ids'));
    const segmentRules = this.parseSegmentRules(this.post('segment_rules'));

    if (!name) {
      return {error: '优惠券名称不能为空'};
    }
    if (![ 'full_reduction', 'discount' ].includes(type)) {
      return {error: '优惠券类型不支持'};
    }
    if (Number.isNaN(thresholdAmount) || thresholdAmount < 0) {
      return {error: '门槛金额不正确'};
    }
    if (type === 'full_reduction') {
      if (Number.isNaN(reduceAmount) || reduceAmount <= 0) {
        return {error: '满减金额必须大于0'};
      }
    } else {
      if (Number.isNaN(discountRate) || discountRate <= 0 || discountRate > 10) {
        return {error: '折扣率需在0~10之间'};
      }
      if (Number.isNaN(discountMaxReduce) || discountMaxReduce < 0) {
        return {error: '折扣封顶金额不正确'};
      }
    }
    if (![ 'all', 'goods' ].includes(scopeType)) {
      return {error: '适用范围不正确'};
    }
    if (scopeType === 'goods' && !goodsIds.length) {
      return {error: '指定商品范围时 goods_ids 不能为空'};
    }
    if (!claimStartAt || !claimEndAt || claimEndAt < claimStartAt) {
      return {error: '领取时间范围不正确'};
    }
    if (!useStartAt || !useEndAt || useEndAt < useStartAt) {
      return {error: '使用时间范围不正确'};
    }
    if (claimEndAt > useEndAt) {
      return {error: '领取结束时间不能晚于使用结束时间'};
    }
    if (Number.isNaN(totalLimit) || totalLimit < 0) {
      return {error: '发放总量不正确'};
    }
    if (Number.isNaN(perUserLimit) || perUserLimit <= 0) {
      return {error: '每人限领数量不正确'};
    }
    if (![ 'draft', 'enabled', 'disabled' ].includes(status)) {
      return {error: '状态不正确'};
    }
    if (!isCreate && id <= 0) {
      return {error: 'id 不能为空'};
    }

    return {
      id,
      payload: {
        name,
        type,
        threshold_amount: thresholdAmount.toFixed(2),
        reduce_amount: reduceAmount.toFixed(2),
        discount_rate: discountRate.toFixed(2),
        discount_max_reduce: discountMaxReduce.toFixed(2),
        scope_type: scopeType,
        segment_rules_json: JSON.stringify(segmentRules),
        claim_start_at: claimStartAt,
        claim_end_at: claimEndAt,
        use_start_at: useStartAt,
        use_end_at: useEndAt,
        total_limit: parseInt(totalLimit, 10),
        per_user_limit: parseInt(perUserLimit, 10),
        status,
        goodsIds
      }
    };
  }

  buildCouponKey() {
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `CP${datePart}${Math.floor(Math.random() * 9000 + 1000)}`;
  }

  async syncCouponGoods(couponId, goodsIds, txModel) {
    const model = txModel.model('coupon_goods');
    model.db(txModel.db());
    await model.where({coupon_id: Number(couponId)}).delete();
    if (!goodsIds.length) return;
    const nowTs = this.now();
    const rows = goodsIds.map(goodsId => ({
      coupon_id: Number(couponId),
      goods_id: Number(goodsId),
      add_time: nowTs
    }));
    await model.addMany(rows);
  }

  async listAction() {
    const page = Number(this.get('page') || 1);
    const size = Number(this.get('size') || 10);
    const keyword = String(this.get('keyword') || '').trim();
    const status = String(this.get('status') || '').trim();
    const type = String(this.get('type') || '').trim();

    const where = {
      is_delete: 0
    };
    if (keyword) {
      where.name = ['like', `%${keyword}%`];
    }
    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }

    const data = await this.model('coupon').where(where).order('id DESC').page(page, size).countSelect();
    const couponIds = (data.data || []).map(item => Number(item.id));
    let goodsCountMap = {};
    if (couponIds.length) {
      const rows = await this.model('coupon_goods').query(`
        SELECT coupon_id, COUNT(1) AS cnt
        FROM hiolabs_coupon_goods
        WHERE coupon_id IN (${couponIds.join(',')})
        GROUP BY coupon_id
      `);
      rows.forEach((row) => {
        goodsCountMap[Number(row.coupon_id)] = Number(row.cnt || 0);
      });
    }
    data.data = (data.data || []).map((item) => ({
      ...item,
      goods_count: goodsCountMap[Number(item.id)] || 0
    }));
    return this.success(data);
  }

  async detailAction() {
    const id = Number(this.get('id') || 0);
    if (id <= 0) {
      return this.fail(400, 'id 不能为空');
    }
    const info = await this.model('coupon').where({
      id,
      is_delete: 0
    }).find();
    if (think.isEmpty(info)) {
      return this.fail(404, '优惠券不存在');
    }
    const goodsRows = await this.model('coupon_goods').where({
      coupon_id: id
    }).select();
    info.goods_ids = goodsRows.map(item => Number(item.goods_id));
    try {
      info.segment_rules = JSON.parse(info.segment_rules_json || '{}');
    } catch (err) {
      info.segment_rules = {groups: ['new_customer', 'old_customer'], match: 'OR'};
    }
    return this.success(info);
  }

  async createAction() {
    const parsed = this.parseCouponPayload(true);
    if (parsed.error) {
      return this.fail(400, parsed.error);
    }
    const nowTs = this.now();
    const txModel = this.model('coupon');
    let couponId = 0;
    try {
      await txModel.transaction(async () => {
        const couponModel = txModel.model('coupon');
        couponModel.db(txModel.db());
        const {goodsIds, ...couponData} = parsed.payload;
        couponId = await couponModel.add({
          coupon_key: this.buildCouponKey(),
          ...couponData,
          received_count: 0,
          used_count: 0,
          is_delete: 0,
          add_time: nowTs,
          update_time: nowTs
        });
        await this.syncCouponGoods(couponId, goodsIds, txModel);
      });
      return this.success({id: Number(couponId)});
    } catch (err) {
      return this.fail(400, err.message || '创建失败');
    }
  }

  async updateAction() {
    const parsed = this.parseCouponPayload(false);
    if (parsed.error) {
      return this.fail(400, parsed.error);
    }
    const nowTs = this.now();
    const txModel = this.model('coupon');
    try {
      await txModel.transaction(async () => {
        const couponModel = txModel.model('coupon');
        couponModel.db(txModel.db());
        const existed = await couponModel.where({
          id: parsed.id,
          is_delete: 0
        }).find();
        if (think.isEmpty(existed)) {
          throw new Error('优惠券不存在');
        }
        const {goodsIds, ...couponData} = parsed.payload;
        await couponModel.where({id: parsed.id}).update({
          ...couponData,
          update_time: nowTs
        });
        await this.syncCouponGoods(parsed.id, goodsIds, txModel);
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
    const affected = await this.model('coupon').where({
      id,
      is_delete: 0
    }).update({
      status,
      update_time: this.now()
    });
    if (Number(affected) !== 1) {
      return this.fail(404, '优惠券不存在');
    }
    return this.success();
  }

  async deleteAction() {
    const id = Number(this.post('id') || 0);
    if (id <= 0) {
      return this.fail(400, 'id 不能为空');
    }
    const affected = await this.model('coupon').where({
      id,
      is_delete: 0
    }).update({
      is_delete: 1,
      update_time: this.now()
    });
    if (Number(affected) !== 1) {
      return this.fail(404, '优惠券不存在');
    }
    return this.success();
  }

  async claimRecordAction() {
    const page = Number(this.get('page') || 1);
    const size = Number(this.get('size') || 10);
    const couponId = Number(this.get('couponId') || 0);
    const status = String(this.get('status') || '').trim();
    const offset = (page - 1) * size;
    const where = ['uc.is_delete = 0'];
    if (couponId > 0) where.push(`uc.coupon_id = ${couponId}`);
    if (status) where.push(`uc.status = '${status.replace(/'/g, '')}'`);
    const whereSql = where.join(' AND ');

    const listSql = `
      SELECT
        uc.id,
        uc.user_id,
        uc.coupon_id,
        uc.status,
        uc.claim_time,
        uc.lock_time,
        uc.used_time,
        uc.expire_time,
        uc.discount_amount,
        c.name AS coupon_name,
        c.type AS coupon_type,
        u.nickname,
        u.mobile
      FROM hiolabs_user_coupon uc
      INNER JOIN hiolabs_coupon c ON uc.coupon_id = c.id
      LEFT JOIN hiolabs_user u ON uc.user_id = u.id
      WHERE ${whereSql}
      ORDER BY uc.id DESC
      LIMIT ${offset}, ${size}
    `;
    const countSql = `SELECT COUNT(1) AS total FROM hiolabs_user_coupon uc WHERE ${whereSql}`;
    const [rows, countRows] = await Promise.all([
      this.model('user_coupon').query(listSql),
      this.model('user_coupon').query(countSql)
    ]);
    const total = Number((countRows[0] && countRows[0].total) || 0);
    rows.forEach((row) => {
      try {
        row.nickname = row.nickname ? Buffer.from(row.nickname, 'base64').toString() : '';
      } catch (err) {
        // ignore invalid base64
      }
    });
    return this.success({
      count: total,
      currentPage: page,
      totalPages: Math.ceil(total / size),
      data: rows
    });
  }

  async useRecordAction() {
    const page = Number(this.get('page') || 1);
    const size = Number(this.get('size') || 10);
    const couponId = Number(this.get('couponId') || 0);
    const orderStatus = Number(this.get('orderStatus') || 0);
    const offset = (page - 1) * size;
    const where = ['1=1'];
    if (couponId > 0) where.push(`oc.coupon_id = ${couponId}`);
    if (orderStatus > 0) where.push(`o.order_status = ${orderStatus}`);
    const whereSql = where.join(' AND ');

    const listSql = `
      SELECT
        oc.id,
        oc.order_id,
        oc.user_coupon_id,
        oc.coupon_id,
        oc.coupon_type,
        oc.coupon_name_snapshot,
        oc.discount_amount,
        oc.add_time,
        o.order_sn,
        o.order_status,
        o.actual_price,
        uc.user_id,
        u.nickname,
        u.mobile
      FROM hiolabs_order_coupon oc
      LEFT JOIN hiolabs_order o ON oc.order_id = o.id
      LEFT JOIN hiolabs_user_coupon uc ON oc.user_coupon_id = uc.id
      LEFT JOIN hiolabs_user u ON uc.user_id = u.id
      WHERE ${whereSql}
      ORDER BY oc.id DESC
      LIMIT ${offset}, ${size}
    `;
    const countSql = `SELECT COUNT(1) AS total FROM hiolabs_order_coupon oc LEFT JOIN hiolabs_order o ON oc.order_id = o.id WHERE ${whereSql}`;
    const [rows, countRows] = await Promise.all([
      this.model('order_coupon').query(listSql),
      this.model('order_coupon').query(countSql)
    ]);
    const total = Number((countRows[0] && countRows[0].total) || 0);
    rows.forEach((row) => {
      try {
        row.nickname = row.nickname ? Buffer.from(row.nickname, 'base64').toString() : '';
      } catch (err) {
        // ignore invalid base64
      }
    });
    return this.success({
      count: total,
      currentPage: page,
      totalPages: Math.ceil(total / size),
      data: rows
    });
  }

  async buildClaimRecordRowsForExport() {
    const couponId = Number(this.get('couponId') || 0);
    const status = String(this.get('status') || '').trim();
    const where = ['uc.is_delete = 0'];
    if (couponId > 0) where.push(`uc.coupon_id = ${couponId}`);
    if (status) where.push(`uc.status = '${status.replace(/'/g, '')}'`);
    const whereSql = where.join(' AND ');
    const sql = `
      SELECT
        uc.id,
        uc.user_id,
        uc.coupon_id,
        uc.status,
        uc.claim_time,
        uc.lock_time,
        uc.used_time,
        uc.expire_time,
        uc.discount_amount,
        c.name AS coupon_name,
        c.type AS coupon_type,
        u.nickname,
        u.mobile
      FROM hiolabs_user_coupon uc
      INNER JOIN hiolabs_coupon c ON uc.coupon_id = c.id
      LEFT JOIN hiolabs_user u ON uc.user_id = u.id
      WHERE ${whereSql}
      ORDER BY uc.id DESC
    `;
    const rows = await this.model('user_coupon').query(sql);
    return rows.map((row) => {
      let nickname = '';
      try {
        nickname = row.nickname ? Buffer.from(row.nickname, 'base64').toString() : '';
      } catch (err) {
        nickname = row.nickname || '';
      }
      return {
        id: row.id,
        user_id: row.user_id,
        mobile: row.mobile || '',
        nickname,
        coupon_id: row.coupon_id,
        coupon_name: row.coupon_name,
        coupon_type: row.coupon_type,
        status: row.status,
        claim_time: row.claim_time,
        lock_time: row.lock_time,
        used_time: row.used_time,
        expire_time: row.expire_time,
        discount_amount: row.discount_amount
      };
    });
  }

  async buildUseRecordRowsForExport() {
    const couponId = Number(this.get('couponId') || 0);
    const orderStatus = Number(this.get('orderStatus') || 0);
    const where = ['1=1'];
    if (couponId > 0) where.push(`oc.coupon_id = ${couponId}`);
    if (orderStatus > 0) where.push(`o.order_status = ${orderStatus}`);
    const whereSql = where.join(' AND ');
    const sql = `
      SELECT
        oc.id,
        oc.order_id,
        oc.user_coupon_id,
        oc.coupon_id,
        oc.coupon_type,
        oc.coupon_name_snapshot,
        oc.discount_amount,
        oc.add_time,
        o.order_sn,
        o.order_status,
        o.actual_price,
        uc.user_id,
        u.nickname,
        u.mobile
      FROM hiolabs_order_coupon oc
      LEFT JOIN hiolabs_order o ON oc.order_id = o.id
      LEFT JOIN hiolabs_user_coupon uc ON oc.user_coupon_id = uc.id
      LEFT JOIN hiolabs_user u ON uc.user_id = u.id
      WHERE ${whereSql}
      ORDER BY oc.id DESC
    `;
    const rows = await this.model('order_coupon').query(sql);
    return rows.map((row) => {
      let nickname = '';
      try {
        nickname = row.nickname ? Buffer.from(row.nickname, 'base64').toString() : '';
      } catch (err) {
        nickname = row.nickname || '';
      }
      return {
        id: row.id,
        order_id: row.order_id,
        order_sn: row.order_sn || '',
        order_status: row.order_status || 0,
        user_id: row.user_id || 0,
        mobile: row.mobile || '',
        nickname,
        coupon_id: row.coupon_id,
        coupon_name: row.coupon_name_snapshot,
        coupon_type: row.coupon_type,
        discount_amount: row.discount_amount,
        order_actual_price: row.actual_price || '0.00',
        add_time: row.add_time
      };
    });
  }

  async sendExcel(filename, rows) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('records');
    const headers = Array.isArray(rows) && rows.length ? Object.keys(rows[0]) : [];
    if (headers.length) {
      ws.columns = headers.map(key => ({header: key, key}));
      rows.forEach((item) => {
        ws.addRow(item || {});
      });
    }
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    this.ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    this.ctx.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    this.ctx.body = buffer;
    return this.ctx.body;
  }

  async claimRecordExportAction() {
    const rows = await this.buildClaimRecordRowsForExport();
    const filename = `coupon_claim_record_${this.now()}.xlsx`;
    return await this.sendExcel(filename, rows);
  }

  async useRecordExportAction() {
    const rows = await this.buildUseRecordRowsForExport();
    const filename = `coupon_use_record_${this.now()}.xlsx`;
    return await this.sendExcel(filename, rows);
  }
};
