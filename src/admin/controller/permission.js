const Base = require('./base.js');

module.exports = class extends Base {
  async treeAction() {
    const rbacService = this.service('rbac', 'admin');
    if (!(await rbacService.hasRbacTables())) {
      return this.fail(500, 'RBAC表不存在，请先导入SQL');
    }
    const rows = await this.model('admin_permission').where({
      is_delete: 0
    }).order('parent_id ASC, id ASC').select();
    const tree = rbacService.buildPermissionTree(rows);
    return this.success(tree);
  }
};
