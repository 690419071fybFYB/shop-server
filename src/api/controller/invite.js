const Base = require('./base.js');

module.exports = class extends Base {
  async mySummaryAction() {
    const userId = this.getLoginUserId();
    if (userId <= 0) {
      return this.fail(401, '请先登录');
    }
    const inviteService = this.service('invite', 'api');
    const summary = await inviteService.getSummary(userId);
    return this.success(summary || {});
  }

  async myRecordsAction() {
    const userId = this.getLoginUserId();
    if (userId <= 0) {
      return this.fail(401, '请先登录');
    }
    const page = Number(this.get('page') || 1);
    const size = Number(this.get('size') || 10);
    const inviteService = this.service('invite', 'api');
    const records = await inviteService.listMyRecords(userId, page, size);
    return this.success(records);
  }
};
