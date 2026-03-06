const CACHE_TTL_MS = 60 * 1000;
const INVITE_CODE_LENGTH = 8;
const DEFAULT_DAILY_LIMIT = 10;

const REWARD_STATUS = {
  PENDING: 'pending',
  ISSUED: 'issued',
  SKIPPED_LIMIT: 'skipped_limit',
  FAILED_COUPON: 'failed_coupon',
  DISABLED: 'disabled',
  NO_COUPON: 'no_coupon',
  INVALID_INVITER: 'invalid_inviter',
  SELF_INVITE: 'self_invite'
};

module.exports = class extends think.Service {
  constructor(...args) {
    super(...args);
    this.schemaCache = {
      checkedAt: 0,
      hasInviteCodeColumn: false,
      hasInviteConfigTable: false,
      hasInviteRelationTable: false
    };
  }

  now() {
    return parseInt(Date.now() / 1000, 10);
  }

  normalizeInviteCode(raw) {
    return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  }

  async refreshSchemaCache(force = false) {
    const nowMs = Date.now();
    if (!force && (nowMs - this.schemaCache.checkedAt) < CACHE_TTL_MS) {
      return this.schemaCache;
    }
    try {
      const rows = await this.model('user').query(`
        SELECT TABLE_NAME, COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (
            (TABLE_NAME = 'hiolabs_user' AND COLUMN_NAME = 'invite_code')
            OR (TABLE_NAME = 'hiolabs_invite_config' AND COLUMN_NAME = 'id')
            OR (TABLE_NAME = 'hiolabs_invite_relation' AND COLUMN_NAME = 'id')
          )
      `);
      let hasInviteCodeColumn = false;
      let hasInviteConfigTable = false;
      let hasInviteRelationTable = false;
      (rows || []).forEach((row) => {
        if (row.TABLE_NAME === 'hiolabs_user' && row.COLUMN_NAME === 'invite_code') {
          hasInviteCodeColumn = true;
        }
        if (row.TABLE_NAME === 'hiolabs_invite_config') {
          hasInviteConfigTable = true;
        }
        if (row.TABLE_NAME === 'hiolabs_invite_relation') {
          hasInviteRelationTable = true;
        }
      });
      this.schemaCache = {
        checkedAt: nowMs,
        hasInviteCodeColumn,
        hasInviteConfigTable,
        hasInviteRelationTable
      };
    } catch (err) {
      this.schemaCache.checkedAt = nowMs;
      this.schemaCache.hasInviteCodeColumn = false;
      this.schemaCache.hasInviteConfigTable = false;
      this.schemaCache.hasInviteRelationTable = false;
    }
    return this.schemaCache;
  }

  async isInviteFeatureReady() {
    const schema = await this.refreshSchemaCache();
    return !!(schema.hasInviteCodeColumn && schema.hasInviteConfigTable && schema.hasInviteRelationTable);
  }

  generateCode() {
    const seed = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
      result += seed.charAt(Math.floor(Math.random() * seed.length));
    }
    return result;
  }

  async ensureUserInviteCode(userId) {
    const uid = Number(userId);
    if (uid <= 0) return '';
    const schema = await this.refreshSchemaCache();
    if (!schema.hasInviteCodeColumn) {
      return '';
    }
    const current = await this.model('user').where({id: uid}).field('invite_code').find();
    const currentCode = this.normalizeInviteCode(current && current.invite_code);
    if (currentCode) {
      return currentCode;
    }
    for (let i = 0; i < 10; i += 1) {
      const nextCode = this.generateCode();
      const existed = await this.model('user').where({invite_code: nextCode}).field('id').find();
      if (!think.isEmpty(existed)) {
        continue;
      }
      const affected = await this.model('user')
        .where(`id = ${uid} AND (invite_code = '' OR invite_code IS NULL)`)
        .update({invite_code: nextCode});
      if (Number(affected) === 1) {
        return nextCode;
      }
      const retry = await this.model('user').where({id: uid}).field('invite_code').find();
      const retryCode = this.normalizeInviteCode(retry && retry.invite_code);
      if (retryCode) {
        return retryCode;
      }
    }
    return '';
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

  maskMobile(raw) {
    const mobile = String(raw || '').trim();
    if (!/^1[3-9]\d{9}$/.test(mobile)) {
      return '';
    }
    return `${mobile.slice(0, 3)}****${mobile.slice(-4)}`;
  }

  async getConfig() {
    const schema = await this.refreshSchemaCache();
    if (!schema.hasInviteConfigTable) {
      return {
        enabled: 0,
        reward_coupon_id: 0,
        daily_limit: DEFAULT_DAILY_LIMIT
      };
    }
    const row = await this.model('invite_config').where({id: 1}).find();
    if (think.isEmpty(row)) {
      await this.model('invite_config').add({
        id: 1,
        enabled: 0,
        reward_coupon_id: 0,
        daily_limit: DEFAULT_DAILY_LIMIT,
        add_time: this.now(),
        update_time: this.now()
      });
      return {
        enabled: 0,
        reward_coupon_id: 0,
        daily_limit: DEFAULT_DAILY_LIMIT
      };
    }
    return {
      enabled: Number(row.enabled || 0),
      reward_coupon_id: Number(row.reward_coupon_id || 0),
      daily_limit: Number(row.daily_limit || DEFAULT_DAILY_LIMIT)
    };
  }

  async getSummary(userId) {
    const uid = Number(userId);
    if (uid <= 0) {
      return null;
    }
    const inviteCode = await this.ensureUserInviteCode(uid);
    const config = await this.getConfig();
    const schema = await this.refreshSchemaCache();
    const nowTs = this.now();
    const dayStart = parseInt(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000, 10);
    const dayEnd = dayStart + 86400;
    let totalInviteCount = 0;
    let totalRewardCount = 0;
    let todayInviteCount = 0;
    let todayRewardCount = 0;
    if (schema.hasInviteRelationTable) {
      totalInviteCount = Number(await this.model('invite_relation').where({
        inviter_user_id: uid
      }).count('id') || 0);
      totalRewardCount = Number(await this.model('invite_relation').where({
        inviter_user_id: uid,
        reward_status: REWARD_STATUS.ISSUED
      }).count('id') || 0);
      todayInviteCount = Number(await this.model('invite_relation').where({
        inviter_user_id: uid,
        bind_at: ['BETWEEN', dayStart, dayEnd]
      }).count('id') || 0);
      todayRewardCount = Number(await this.model('invite_relation').where({
        inviter_user_id: uid,
        reward_status: REWARD_STATUS.ISSUED,
        bind_at: ['BETWEEN', dayStart, dayEnd]
      }).count('id') || 0);
    }
    return {
      now: nowTs,
      my_invite_code: inviteCode || '',
      enabled: config.enabled,
      reward_coupon_id: config.reward_coupon_id,
      daily_limit: config.daily_limit,
      total_invite_count: totalInviteCount,
      total_reward_count: totalRewardCount,
      today_invite_count: todayInviteCount,
      today_reward_count: todayRewardCount
    };
  }

  async listMyRecords(userId, page = 1, size = 10) {
    const uid = Number(userId);
    if (uid <= 0) {
      return {
        count: 0,
        currentPage: Number(page) || 1,
        totalPages: 0,
        data: []
      };
    }
    const schema = await this.refreshSchemaCache();
    if (!schema.hasInviteRelationTable) {
      return {
        count: 0,
        currentPage: Number(page) || 1,
        totalPages: 0,
        data: []
      };
    }
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(50, Math.max(1, Number(size) || 10));
    const data = await this.model('invite_relation')
      .where({inviter_user_id: uid})
      .order('id DESC')
      .page(safePage, safeSize)
      .countSelect();

    const inviteeIds = Array.from(new Set((data.data || []).map(item => Number(item.invitee_user_id || 0)).filter(id => id > 0)));
    let inviteeMap = {};
    if (inviteeIds.length) {
      const invitees = await this.model('user').where({
        id: ['IN', inviteeIds]
      }).field('id,nickname,mobile,avatar').select();
      inviteeMap = (invitees || []).reduce((acc, item) => {
        const id = Number(item.id || 0);
        acc[id] = {
          nickname: this.decodeNickname(item.nickname),
          mobile_masked: this.maskMobile(item.mobile),
          avatar: item.avatar || ''
        };
        return acc;
      }, {});
    }

    data.data = (data.data || []).map((item) => {
      const invitee = inviteeMap[Number(item.invitee_user_id)] || {};
      return {
        id: Number(item.id),
        inviter_user_id: Number(item.inviter_user_id),
        invitee_user_id: Number(item.invitee_user_id),
        bind_at: Number(item.bind_at || 0),
        reward_status: item.reward_status || REWARD_STATUS.PENDING,
        reward_coupon_id: Number(item.reward_coupon_id || 0),
        reward_coupon_user_id: Number(item.reward_coupon_user_id || 0),
        fail_reason: item.fail_reason || '',
        invitee_nickname: invitee.nickname || '',
        invitee_mobile_masked: invitee.mobile_masked || '',
        invitee_avatar: invitee.avatar || ''
      };
    });
    return data;
  }

  async processNewUserInvite(params = {}) {
    const inviteeUserId = Number(params.inviteeUserId || 0);
    const inviteCode = this.normalizeInviteCode(params.inviteCode);
    if (inviteeUserId <= 0 || !inviteCode) {
      return {accepted: false};
    }
    const schema = await this.refreshSchemaCache();
    if (!schema.hasInviteRelationTable || !schema.hasInviteConfigTable || !schema.hasInviteCodeColumn) {
      return {accepted: false};
    }
    const existedRelation = await this.model('invite_relation').where({
      invitee_user_id: inviteeUserId
    }).find();
    if (!think.isEmpty(existedRelation)) {
      return {accepted: false, reason: 'already_bound'};
    }

    const inviter = await this.model('user').where({
      invite_code: inviteCode,
      is_delete: 0
    }).field('id').find();
    if (think.isEmpty(inviter)) {
      return {accepted: false, reason: REWARD_STATUS.INVALID_INVITER};
    }
    const inviterUserId = Number(inviter.id || 0);
    if (inviterUserId <= 0 || inviterUserId === inviteeUserId) {
      return {accepted: false, reason: REWARD_STATUS.SELF_INVITE};
    }

    const nowTs = this.now();
    const config = await this.getConfig();
    const relationId = await this.model('invite_relation').add({
      inviter_user_id: inviterUserId,
      invitee_user_id: inviteeUserId,
      invite_code: inviteCode,
      bind_at: nowTs,
      reward_status: REWARD_STATUS.PENDING,
      reward_coupon_id: config.reward_coupon_id,
      reward_coupon_user_id: 0,
      fail_reason: '',
      add_time: nowTs,
      update_time: nowTs
    });
    const relationWhere = {id: Number(relationId)};

    if (Number(config.enabled) !== 1) {
      await this.model('invite_relation').where(relationWhere).update({
        reward_status: REWARD_STATUS.DISABLED,
        fail_reason: '拉新活动未开启',
        update_time: this.now()
      });
      return {accepted: true, status: REWARD_STATUS.DISABLED};
    }
    if (Number(config.reward_coupon_id || 0) <= 0) {
      await this.model('invite_relation').where(relationWhere).update({
        reward_status: REWARD_STATUS.NO_COUPON,
        fail_reason: '未配置奖励优惠券',
        update_time: this.now()
      });
      return {accepted: true, status: REWARD_STATUS.NO_COUPON};
    }
    const dayStart = parseInt(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000, 10);
    const dayEnd = dayStart + 86400;
    const todayIssuedCount = Number(await this.model('invite_relation').where({
      inviter_user_id: inviterUserId,
      reward_status: REWARD_STATUS.ISSUED,
      bind_at: ['BETWEEN', dayStart, dayEnd]
    }).count('id') || 0);
    if (todayIssuedCount >= Number(config.daily_limit || DEFAULT_DAILY_LIMIT)) {
      await this.model('invite_relation').where(relationWhere).update({
        reward_status: REWARD_STATUS.SKIPPED_LIMIT,
        fail_reason: '邀请奖励已达今日上限',
        update_time: this.now()
      });
      return {accepted: true, status: REWARD_STATUS.SKIPPED_LIMIT};
    }

    const couponService = this.service('coupon', 'api');
    try {
      const rewardResult = await couponService.receiveCoupon(inviterUserId, Number(config.reward_coupon_id), {
        allowMultiple: true,
        ignorePerUserLimit: true,
        skipSegmentCheck: true
      });
      await this.model('invite_relation').where(relationWhere).update({
        reward_status: REWARD_STATUS.ISSUED,
        reward_coupon_user_id: Number((rewardResult && rewardResult.userCouponId) || 0),
        update_time: this.now()
      });
      return {
        accepted: true,
        status: REWARD_STATUS.ISSUED,
        inviterUserId
      };
    } catch (err) {
      const reason = String((err && err.message) || '发券失败').slice(0, 255);
      await this.model('invite_relation').where(relationWhere).update({
        reward_status: REWARD_STATUS.FAILED_COUPON,
        fail_reason: reason,
        update_time: this.now()
      });
      return {
        accepted: true,
        status: REWARD_STATUS.FAILED_COUPON,
        reason
      };
    }
  }
};
