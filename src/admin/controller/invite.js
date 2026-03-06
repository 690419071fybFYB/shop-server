const Base = require('./base.js');

const STATUS_TEXT = {
  pending: '待发放',
  issued: '已发放',
  skipped_limit: '超上限未发放',
  failed_coupon: '发券失败',
  disabled: '活动未开启',
  no_coupon: '未配置奖励券'
};

module.exports = class extends Base {
  now() {
    return parseInt(Date.now() / 1000, 10);
  }

  decodeNickname(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    try {
      return Buffer.from(text, 'base64').toString();
    } catch (err) {
      return text;
    }
  }

  async ensureInviteFeatureReady() {
    const inviteService = this.service('invite', 'api');
    const ready = await inviteService.isInviteFeatureReady();
    if (!ready) {
      return this.fail(400, '请先执行 invite_upgrade.sql 数据库升级脚本');
    }
    return null;
  }

  async configAction() {
    const guard = await this.ensureInviteFeatureReady();
    if (guard) return guard;
    if (this.isPost) {
      return this.saveConfig();
    }
    const inviteService = this.service('invite', 'api');
    const config = await inviteService.getConfig();
    let couponInfo = null;
    const couponId = Number(config.reward_coupon_id || 0);
    if (couponId > 0) {
      couponInfo = await this.model('coupon').where({
        id: couponId,
        is_delete: 0
      }).field('id,name,status,claim_start_at,claim_end_at,use_start_at,use_end_at').find();
      if (think.isEmpty(couponInfo)) {
        couponInfo = null;
      }
    }
    const couponOptions = await this.model('coupon').where({
      is_delete: 0,
      status: 'enabled'
    }).field('id,name,type,threshold_amount,reduce_amount,discount_rate').order('id DESC').limit(200).select();
    return this.success({
      enabled: Number(config.enabled || 0),
      reward_coupon_id: couponId,
      daily_limit: Number(config.daily_limit || 10),
      coupon: couponInfo,
      coupons: couponOptions || []
    });
  }

  async saveConfig() {
    const enabled = Number(this.post('enabled') || 0) === 1 ? 1 : 0;
    const rewardCouponId = Number(this.post('reward_coupon_id') || 0);
    const dailyLimit = Number(this.post('daily_limit') || 10);
    if (enabled === 1 && rewardCouponId <= 0) {
      return this.fail(400, '开启活动时必须配置奖励券');
    }
    if (rewardCouponId > 0) {
      const coupon = await this.model('coupon').where({
        id: rewardCouponId,
        is_delete: 0,
        status: 'enabled'
      }).find();
      if (think.isEmpty(coupon)) {
        return this.fail(400, '奖励券不存在或未启用');
      }
    }
    const nowTs = this.now();
    const normalizedDailyLimit = Number.isNaN(dailyLimit) || dailyLimit <= 0 ? 10 : dailyLimit;
    const existed = await this.model('invite_config').where({id: 1}).find();
    if (think.isEmpty(existed)) {
      await this.model('invite_config').add({
        id: 1,
        enabled,
        reward_coupon_id: rewardCouponId,
        daily_limit: normalizedDailyLimit,
        add_time: nowTs,
        update_time: nowTs
      });
    } else {
      await this.model('invite_config').where({id: 1}).update({
        enabled,
        reward_coupon_id: rewardCouponId,
        daily_limit: normalizedDailyLimit,
        update_time: nowTs
      });
    }
    return this.success();
  }

  async listAction() {
    const guard = await this.ensureInviteFeatureReady();
    if (guard) return guard;
    const page = Math.max(1, Number(this.get('page') || 1));
    const size = Math.min(50, Math.max(1, Number(this.get('size') || 10)));
    const keyword = String(this.get('keyword') || '').trim();
    const rewardStatus = String(this.get('reward_status') || '').trim();
    const rewardStatusWhitelist = new Set(['pending', 'issued', 'skipped_limit', 'failed_coupon', 'disabled', 'no_coupon']);

    const where = ['r.id > 0'];
    if (rewardStatus && rewardStatusWhitelist.has(rewardStatus)) {
      where.push(`r.reward_status = '${rewardStatus}'`);
    }
    if (keyword) {
      const escaped = keyword.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
      where.push(`(
        CAST(r.inviter_user_id AS CHAR) LIKE '%${escaped}%'
        OR CAST(r.invitee_user_id AS CHAR) LIKE '%${escaped}%'
        OR iu.username LIKE '%${escaped}%' ESCAPE '\\\\'
        OR eu.username LIKE '%${escaped}%' ESCAPE '\\\\'
      )`);
    }
    const whereSql = where.join(' AND ');
    const offset = (page - 1) * size;
    const countRows = await this.model('invite_relation').query(`
      SELECT COUNT(1) AS total
      FROM hiolabs_invite_relation r
      LEFT JOIN hiolabs_user iu ON r.inviter_user_id = iu.id
      LEFT JOIN hiolabs_user eu ON r.invitee_user_id = eu.id
      WHERE ${whereSql}
    `);
    const total = Number((countRows[0] && countRows[0].total) || 0);
    const rows = await this.model('invite_relation').query(`
      SELECT
        r.id,
        r.inviter_user_id,
        r.invitee_user_id,
        r.invite_code,
        r.bind_at,
        r.reward_status,
        r.reward_coupon_id,
        r.reward_coupon_user_id,
        r.fail_reason,
        iu.username AS inviter_username,
        iu.nickname AS inviter_nickname,
        eu.username AS invitee_username,
        eu.nickname AS invitee_nickname
      FROM hiolabs_invite_relation r
      LEFT JOIN hiolabs_user iu ON r.inviter_user_id = iu.id
      LEFT JOIN hiolabs_user eu ON r.invitee_user_id = eu.id
      WHERE ${whereSql}
      ORDER BY r.id DESC
      LIMIT ${offset}, ${size}
    `);
    const list = (rows || []).map((item) => ({
      id: Number(item.id || 0),
      inviter_user_id: Number(item.inviter_user_id || 0),
      invitee_user_id: Number(item.invitee_user_id || 0),
      invite_code: item.invite_code || '',
      bind_at: Number(item.bind_at || 0),
      reward_status: item.reward_status || 'pending',
      reward_status_text: STATUS_TEXT[item.reward_status] || '未知',
      reward_coupon_id: Number(item.reward_coupon_id || 0),
      reward_coupon_user_id: Number(item.reward_coupon_user_id || 0),
      fail_reason: item.fail_reason || '',
      inviter_name: this.decodeNickname(item.inviter_nickname) || item.inviter_username || '',
      invitee_name: this.decodeNickname(item.invitee_nickname) || item.invitee_username || ''
    }));
    return this.success({
      count: total,
      currentPage: page,
      totalPages: Math.ceil(total / size),
      data: list
    });
  }
};
