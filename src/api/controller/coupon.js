const Base = require('./base.js');

module.exports = class extends Base {
  parseIds(value) {
    const couponService = this.service('coupon', 'api');
    return couponService.normalizeIdList(value);
  }

  async getPreviewGoodsList(userId, addType, orderFrom) {
    const mode = Number(addType || 0);
    if (mode === 2 && Number(orderFrom || 0) > 0) {
      const rows = await this.model('order_goods').where({
        user_id: Number(userId),
        order_id: Number(orderFrom),
        is_delete: 0
      }).select();
      return rows.map(item => ({
        goods_id: Number(item.goods_id),
        number: Number(item.number || 0),
        retail_price: Number(item.retail_price || 0)
      }));
    }

    const where = {
      user_id: Number(userId),
      checked: 1,
      is_delete: 0
    };
    where.is_fast = mode === 1 ? 1 : 0;
    const rows = await this.model('cart').where(where).select();
    return rows.map(item => ({
      goods_id: Number(item.goods_id),
      number: Number(item.number || 0),
      retail_price: Number(item.retail_price || 0)
    }));
  }

  async centerAction() {
    const userId = this.getLoginUserId();
    if (Number(userId) <= 0) {
      return this.fail(401, '请先登录');
    }
    const couponService = this.service('coupon', 'api');
    try {
      const list = await couponService.listCenterCoupons(userId);
      return this.success(list);
    } catch (err) {
      think.logger && think.logger.error && think.logger.error(`[coupon.center] ${err.message || err}`);
      return this.fail(500, err.message || '领券中心加载失败');
    }
  }

  async receiveAction() {
    const userId = this.getLoginUserId();
    if (Number(userId) <= 0) {
      return this.fail(401, '请先登录');
    }
    const couponId = Number(this.post('couponId') || 0);
    if (couponId <= 0) {
      return this.fail(400, 'couponId 不能为空');
    }
    try {
      const couponService = this.service('coupon', 'api');
      const result = await couponService.receiveCoupon(userId, couponId);
      return this.success(result);
    } catch (err) {
      return this.fail(400, err.message || '领取失败');
    }
  }

  async myAction() {
    const userId = this.getLoginUserId();
    if (Number(userId) <= 0) {
      return this.fail(401, '请先登录');
    }
    const status = String(this.get('status') || '').trim();
    const couponService = this.service('coupon', 'api');
    try {
      const list = await couponService.listMyCoupons(userId, status);
      return this.success(list);
    } catch (err) {
      think.logger && think.logger.error && think.logger.error(`[coupon.my] ${err.message || err}`);
      return this.fail(500, err.message || '我的优惠券加载失败');
    }
  }

  async previewAction() {
    const userId = this.getLoginUserId();
    if (Number(userId) <= 0) {
      return this.fail(401, '请先登录');
    }

    const selectedUserCouponIds = this.post('selectedUserCouponIds') || this.get('selectedUserCouponIds') || [];
    const addType = this.post('addType') || this.get('addType') || 0;
    const orderFrom = this.post('orderFrom') || this.get('orderFrom') || 0;
    const freightPrice = this.post('freightPrice') || this.get('freightPrice') || 0;

    const couponService = this.service('coupon', 'api');
    try {
      const goodsList = await this.getPreviewGoodsList(userId, addType, orderFrom);
      const preview = await couponService.previewCartCoupons({
        userId,
        cartItems: goodsList,
        selectedUserCouponIds,
        freightPrice
      });
      return this.success(preview);
    } catch (err) {
      think.logger && think.logger.error && think.logger.error(`[coupon.preview] ${err.message || err}`);
      return this.fail(500, err.message || '优惠券试算失败');
    }
  }
};
