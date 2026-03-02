const Base = require('./base.js');

module.exports = class extends Base {
  async listAction() {
    const rbacService = this.service('rbac', 'admin');
    if (!(await rbacService.hasRbacTables())) {
      return this.fail(500, 'RBAC表不存在，请先导入SQL');
    }
    const roles = await this.model('admin_role').where({
      is_delete: 0
    }).order('id ASC').select();
    const countRows = await this.model('admin').query(`
      SELECT role_id, COUNT(1) AS admin_count
      FROM hiolabs_admin_user_role
      GROUP BY role_id
    `);
    const permRows = await this.model('admin').query(`
      SELECT role_id, GROUP_CONCAT(permission_id) AS permission_ids
      FROM hiolabs_admin_role_permission
      GROUP BY role_id
    `);
    const countMap = {};
    countRows.forEach(row => {
      countMap[Number(row.role_id)] = Number(row.admin_count || 0);
    });
    const permMap = {};
    permRows.forEach(row => {
      const roleId = Number(row.role_id);
      const ids = String(row.permission_ids || '')
        .split(',')
        .map(id => Number(id))
        .filter(id => id > 0);
      permMap[roleId] = ids;
    });
    roles.forEach(role => {
      role.admin_count = countMap[Number(role.id)] || 0;
      role.permission_ids = permMap[Number(role.id)] || [];
    });
    return this.success(roles);
  }

  async createAction() {
    const roleKey = String(this.post('roleKey') || '').trim();
    const roleName = String(this.post('roleName') || '').trim();
    if (!roleKey || !roleName) {
      return this.fail(400, '角色标识和名称不能为空');
    }
    const exists = await this.model('admin_role').where({
      role_key: roleKey,
      is_delete: 0
    }).find();
    if (!think.isEmpty(exists)) {
      return this.fail(400, '角色标识已存在');
    }
    const now = parseInt(Date.now() / 1000, 10);
    const id = await this.model('admin_role').add({
      role_key: roleKey,
      role_name: roleName,
      is_system: 0,
      is_delete: 0,
      created_at: now,
      updated_at: now
    });
    return this.success({ id });
  }

  async updateAction() {
    const roleId = Number(this.post('roleId'));
    const roleName = String(this.post('roleName') || '').trim();
    if (!roleId || !roleName) {
      return this.fail(400, '角色ID和名称不能为空');
    }
    const role = await this.model('admin_role').where({
      id: roleId,
      is_delete: 0
    }).find();
    if (think.isEmpty(role)) {
      return this.fail(404, '角色不存在');
    }
    if (Number(role.is_system) === 1 && role.role_key === 'super_admin') {
      return this.fail(400, '系统保留超级管理员角色不可修改');
    }
    await this.model('admin_role').where({ id: roleId }).update({
      role_name: roleName,
      updated_at: parseInt(Date.now() / 1000, 10)
    });
    return this.success();
  }

  async deleteAction() {
    const roleId = Number(this.post('roleId'));
    if (!roleId) {
      return this.fail(400, '角色ID不能为空');
    }
    const role = await this.model('admin_role').where({
      id: roleId,
      is_delete: 0
    }).find();
    if (think.isEmpty(role)) {
      return this.fail(404, '角色不存在');
    }
    if (Number(role.is_system) === 1 || role.role_key === 'super_admin') {
      return this.fail(400, '系统角色不可删除');
    }
    const bindCount = await this.model('admin_user_role').where({ role_id: roleId }).count();
    if (bindCount > 0) {
      return this.fail(400, '角色已被管理员使用，无法删除');
    }
    await this.model('admin_role').where({ id: roleId }).update({
      is_delete: 1,
      updated_at: parseInt(Date.now() / 1000, 10)
    });
    await this.model('admin_role_permission').where({ role_id: roleId }).delete();
    return this.success();
  }

  async grantAction() {
    const roleId = Number(this.post('roleId'));
    const permissionIds = this.post('permissionIds') || [];
    if (!roleId) {
      return this.fail(400, '角色ID不能为空');
    }
    const role = await this.model('admin_role').where({
      id: roleId,
      is_delete: 0
    }).find();
    if (think.isEmpty(role)) {
      return this.fail(404, '角色不存在');
    }
    if (role.role_key === 'super_admin') {
      return this.fail(400, '超级管理员角色默认拥有全部权限，无需单独授权');
    }
    const ids = (Array.isArray(permissionIds) ? permissionIds : String(permissionIds).split(','))
      .map(id => Number(id))
      .filter(id => id > 0);
    await this.model('admin_role_permission').where({ role_id: roleId }).delete();
    for (const permissionId of ids) {
      await this.model('admin_role_permission').add({
        role_id: roleId,
        permission_id: permissionId
      });
    }
    await this.model('admin_role').where({ id: roleId }).update({
      updated_at: parseInt(Date.now() / 1000, 10)
    });
    return this.success();
  }
};
