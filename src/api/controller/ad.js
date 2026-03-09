const Base = require('./base.js');

module.exports = class extends Base {
  normalizePage(value, fallback = 1) {
    const page = Number(value || fallback);
    if (!Number.isFinite(page) || page < 1) {
      return fallback;
    }
    return Math.floor(page);
  }

  normalizeSize(value, fallback = 10, max = 50) {
    const size = Number(value || fallback);
    if (!Number.isFinite(size) || size < 1) {
      return fallback;
    }
    return Math.min(max, Math.floor(size));
  }

  normalizeCountRow(row) {
    if (!row) {
      return 0;
    }
    const value = row.total !== undefined ? row.total : row.cnt;
    return Number(value || 0);
  }

  async buildUnreadCount(userId, nowTs) {
    const uid = Number(userId || 0);
    if (uid <= 0) {
      return 0;
    }
    const sql = `
      SELECT COUNT(1) AS total
      FROM hiolabs_ad a
      LEFT JOIN hiolabs_user_ad_read r
        ON r.ad_id = a.id AND r.user_id = ${uid}
      WHERE a.is_delete = 0
        AND a.enabled = 1
        AND a.placement IN (2, 3)
        AND IFNULL(a.start_time, 0) <= ${nowTs}
        AND r.id IS NULL
    `;
    const rows = await this.model('ad').query(sql);
    return this.normalizeCountRow(rows && rows[0]);
  }

  async messagesAction() {
    const userId = this.getLoginUserId();
    if (userId <= 0) {
      return this.fail(401, '请先登录');
    }
    const page = this.normalizePage(this.get('page'), 1);
    const size = this.normalizeSize(this.get('size'), 10, 50);
    const offset = (page - 1) * size;
    const nowTs = this.getTime();
    const uid = Number(userId);

    const listSql = `
      SELECT
        a.id,
        a.title,
        a.image_url,
        IFNULL(a.popup_image_url, '') AS popup_image_url,
        a.link_type,
        a.goods_id,
        a.link,
        IFNULL(a.start_time, 0) AS start_time,
        IFNULL(a.end_time, 0) AS end_time,
        IFNULL(a.sort_order, 0) AS sort_order,
        r.id AS read_id
      FROM hiolabs_ad a
      LEFT JOIN hiolabs_user_ad_read r
        ON r.ad_id = a.id AND r.user_id = ${uid}
      WHERE a.is_delete = 0
        AND a.enabled = 1
        AND a.placement IN (2, 3)
        AND IFNULL(a.start_time, 0) <= ${nowTs}
      ORDER BY a.start_time DESC, a.id DESC
      LIMIT ${offset}, ${size}
    `;
    const listSqlFallback = `
      SELECT
        a.id,
        a.title,
        a.image_url,
        '' AS popup_image_url,
        a.link_type,
        a.goods_id,
        a.link,
        IFNULL(a.start_time, 0) AS start_time,
        IFNULL(a.end_time, 0) AS end_time,
        IFNULL(a.sort_order, 0) AS sort_order,
        r.id AS read_id
      FROM hiolabs_ad a
      LEFT JOIN hiolabs_user_ad_read r
        ON r.ad_id = a.id AND r.user_id = ${uid}
      WHERE a.is_delete = 0
        AND a.enabled = 1
        AND a.placement IN (2, 3)
        AND IFNULL(a.start_time, 0) <= ${nowTs}
      ORDER BY a.start_time DESC, a.id DESC
      LIMIT ${offset}, ${size}
    `;
    const countSql = `
      SELECT COUNT(1) AS total
      FROM hiolabs_ad a
      WHERE a.is_delete = 0
        AND a.enabled = 1
        AND a.placement IN (2, 3)
        AND IFNULL(a.start_time, 0) <= ${nowTs}
    `;
    const [listRows, countRows] = await Promise.all([
      this.model('ad').query(listSql).catch(() => this.model('ad').query(listSqlFallback)),
      this.model('ad').query(countSql)
    ]);
    const total = this.normalizeCountRow(countRows && countRows[0]);
    const list = (listRows || []).map((item) => ({
      id: Number(item.id || 0),
      title: String(item.title || ''),
      image_url: String(item.popup_image_url || item.image_url || ''),
      link_type: Number(item.link_type || 0),
      goods_id: Number(item.goods_id || 0),
      link: String(item.link || ''),
      start_time: Number(item.start_time || 0),
      end_time: Number(item.end_time || 0),
      sort_order: Number(item.sort_order || 0),
      is_read: Number(item.read_id || 0) > 0 ? 1 : 0
    }));
    return this.success({
      list,
      total,
      currentPage: page,
      pageSize: size
    });
  }

  async unreadCountAction() {
    const userId = this.getLoginUserId();
    if (userId <= 0) {
      return this.fail(401, '请先登录');
    }
    const nowTs = this.getTime();
    const count = await this.buildUnreadCount(userId, nowTs);
    return this.success({count});
  }

  async readAllAction() {
    if (!this.isPost) {
      return this.fail(405, '请求方式错误');
    }
    const userId = this.getLoginUserId();
    if (userId <= 0) {
      return this.fail(401, '请先登录');
    }
    const nowTs = this.getTime();
    const uid = Number(userId);
    const before = await this.buildUnreadCount(uid, nowTs);
    const insertSql = `
      INSERT IGNORE INTO hiolabs_user_ad_read (user_id, ad_id, read_time)
      SELECT ${uid}, a.id, ${nowTs}
      FROM hiolabs_ad a
      WHERE a.is_delete = 0
        AND a.enabled = 1
        AND a.placement IN (2, 3)
        AND IFNULL(a.start_time, 0) <= ${nowTs}
    `;
    await this.model('ad').query(insertSql);
    const after = await this.buildUnreadCount(uid, nowTs);
    return this.success({
      affected: Math.max(0, before - after)
    });
  }
};
