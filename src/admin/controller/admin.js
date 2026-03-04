const Base = require('./base.js');
const moment = require('moment');

module.exports = class extends Base {
  normalizeRoleIds(roleIds) {
    if (Array.isArray(roleIds)) {
      return roleIds.map(id => Number(id)).filter(id => id > 0);
    }
    if (roleIds === undefined || roleIds === null || roleIds === '') {
      return [];
    }
    return String(roleIds)
      .split(',')
      .map(item => Number(item))
      .filter(item => item > 0);
  }

  async getRoleMapByAdminIds(adminIds) {
    const ids = (adminIds || []).map(id => Number(id)).filter(id => id > 0);
    if (!ids.length) {
      return {};
    }
    const rbacService = this.service('rbac', 'admin');
    if (!(await rbacService.hasRbacTables())) {
      return {};
    }
    const sql = `
      SELECT aur.admin_id, ar.id AS role_id, ar.role_key, ar.role_name
      FROM hiolabs_admin_user_role aur
      INNER JOIN hiolabs_admin_role ar ON aur.role_id = ar.id
      WHERE aur.admin_id IN (${ids.join(',')}) AND ar.is_delete = 0
      ORDER BY ar.id ASC
    `;
    const rows = await this.model('admin').query(sql);
    const map = {};
    rows.forEach(item => {
      const key = Number(item.admin_id);
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push({
        id: Number(item.role_id),
        role_key: item.role_key,
        role_name: item.role_name
      });
    });
    return map;
  }

  async getRoleIdsByAdminId(adminId) {
    const map = await this.getRoleMapByAdminIds([adminId]);
    const rows = map[Number(adminId)] || [];
    return rows.map(item => item.id);
  }

  async ensureDefaultRole(adminId) {
    const rbacService = this.service('rbac', 'admin');
    if (!(await rbacService.hasRbacTables())) {
      return;
    }
    const adminIdNum = Number(adminId);
    if (adminIdNum <= 0) {
      return;
    }
    const table = this.model('admin_user_role');
    const count = await table.where({ admin_id: adminIdNum }).count();
    if (count > 0) {
      return;
    }
    const defaultRole = await this.model('admin_role').where({
      role_key: 'ops_admin',
      is_delete: 0
    }).find();
    if (!think.isEmpty(defaultRole)) {
      await table.add({
        admin_id: adminIdNum,
        role_id: defaultRole.id
      });
    }
  }

  async assignRoles(adminId, roleIds) {
    const adminIdNum = Number(adminId);
    const ids = this.normalizeRoleIds(roleIds);
    const rbacService = this.service('rbac', 'admin');
    if (!(await rbacService.hasRbacTables())) {
      return;
    }
    if (ids.length > 0) {
      const validRoles = await this.model('admin_role').where({
        id: ['IN', ids],
        is_delete: 0
      }).select();
      if (validRoles.length !== ids.length) {
        return this.fail(400, '角色不存在或已删除');
      }
    }
    const superRole = await this.model('admin_role').where({
      role_key: 'super_admin',
      is_delete: 0
    }).find();
    if (rbacService.isReservedSuperAdmin(adminIdNum) && !think.isEmpty(superRole)) {
      if (!ids.includes(Number(superRole.id))) {
        return this.fail(400, '系统保留超管不可移除超级管理员角色');
      }
    }
    await this.model('admin_user_role').where({ admin_id: adminIdNum }).delete();
    if (ids.length === 0) {
      await this.ensureDefaultRole(adminIdNum);
      return;
    }
    for (const rid of ids) {
      await this.model('admin_user_role').add({
        admin_id: adminIdNum,
        role_id: rid
      });
    }
  }

  async indexAction() {
    const data = await this.model('admin').where({
      is_delete: 0
    }).select();
    const roleMap = await this.getRoleMapByAdminIds(data.map(item => item.id));
    const rbacService = this.service('rbac', 'admin');
    for (const item of data) {
      if (item.last_login_time !== 0) {
        item.last_login_time = moment.unix(item.last_login_time).format('YYYY-MM-DD HH:mm:ss');
      } else {
        item.last_login_time = '还没登录过';
      }
      item.password = '';
      const roles = roleMap[Number(item.id)] || [];
      if (roles.length === 0 && rbacService.isReservedSuperAdmin(item.id)) {
        item.role_keys = ['super_admin'];
        item.role_names = ['超级管理员'];
      } else {
        item.role_keys = roles.map(role => role.role_key);
        item.role_names = roles.map(role => role.role_name);
      }
    }
    return this.success(data);
  }

  async adminDetailAction() {
    const id = Number(this.post('id'));
    const info = await this.model('admin').where({
      id: id,
      is_delete: 0
    }).find();
    if (think.isEmpty(info)) {
      return this.fail(404, '管理员不存在');
    }
    info.password = '';
    const roles = (await this.getRoleMapByAdminIds([id]))[id] || [];
    info.roles = roles;
    info.roleIds = roles.map(item => item.id);
    return this.success(info);
  }

  async adminAddAction() {
    const user = this.post('user') || {};
    const username = String(user.username || '').trim();
    let password = String(user.password || '').trim();
    const passwordService = this.service('password', 'admin');
    const roleIds = this.normalizeRoleIds(this.post('roleIds') || user.roleIds);
    if (!username) {
      return this.fail(400, '管理员用户名不能为空');
    }
    if (password.length < 6) {
      return this.fail(400, '密码请大于6个字符');
    }
    const ex = await this.model('admin').where({
      username: username,
      is_delete: 0
    }).find();
    if (!think.isEmpty(ex)) {
      return this.fail(400, '管理员用户名已存在');
    }
    const upData = {
      username: username,
      password_salt: '',
      last_login_ip: '',
      last_login_time: 0,
      is_delete: 0
    };
    upData.password = await passwordService.hashPassword(password);
    const adminId = await this.model('admin').add(upData);
    const assignResult = await this.assignRoles(adminId, roleIds);
    if (assignResult) {
      return assignResult;
    }
    return this.success();
  }

  async adminSaveAction() {
    const user = this.post('user') || {};
    const change = this.post('change');
    const passwordService = this.service('password', 'admin');
    const userId = Number(user.id);
    const username = String(user.username || '').trim();
    const roleIds = this.normalizeRoleIds(this.post('roleIds') || user.roleIds);
    if (!userId) {
      return this.fail(400, '管理员ID不能为空');
    }
    if (!username) {
      return this.fail(400, '管理员用户名不能为空');
    }
    const upData = {
      username: username
    };
    if (change === true || change === 'true' || change === 1) {
      const newPasswordRaw = String(user.newpassword || '').trim();
      if (newPasswordRaw.length > 0) {
        if (newPasswordRaw.length < 6) {
          return this.fail(400, '密码请大于6个字符');
        }
        upData.password = await passwordService.hashPassword(newPasswordRaw);
        upData.password_salt = '';
      }
    }
    const ex = await this.model('admin').where({
      username: username,
      id: ['<>', userId],
      is_delete: 0
    }).find();
    if (!think.isEmpty(ex)) {
      return this.fail(400, '重名了');
    }
    await this.model('admin').where({
      id: userId
    }).update(upData);
    const assignResult = await this.assignRoles(userId, roleIds);
    if (assignResult) {
      return assignResult;
    }
    return this.success();
  }

  async deleAdminAction() {
    const id = Number(this.post('id'));
    if (!id) {
      return this.fail(400, '管理员ID不能为空');
    }
    const rbacService = this.service('rbac', 'admin');
    if (rbacService.isReservedSuperAdmin(id)) {
      return this.fail(400, '系统保留超管不可删除');
    }
    await this.model('admin').where({
      id: id
    }).update({
      is_delete: 1
    });
    await this.model('admin_user_role').where({ admin_id: id }).delete();
    return this.success();
  }

  async infoAction() {
    const id = this.get('id');
    const model = this.model('user');
    const data = await model.where({
      id: id
    }).find();
    return this.success(data);
  }

  async storeAction() {
    if (!this.isPost) {
      return false;
    }
    const values = this.post();
    const id = this.post('id');
    const model = this.model('user');
    values.is_show = values.is_show ? 1 : 0;
    values.is_new = values.is_new ? 1 : 0;
    if (id > 0) {
      await model.where({
        id: id
      }).update(values);
    } else {
      delete values.id;
      await model.add(values);
    }
    return this.success(values);
  }

  async showsetAction() {
    const model = this.model('show_settings');
    const data = await model.find();
    return this.success(data);
  }

  async showsetStoreAction() {
    const id = 1;
    const values = this.post();
    const model = this.model('show_settings');
    await model.where({
      id: id
    }).update(values);
    return this.success(values);
  }

  async changeAutoStatusAction() {
    const status = this.post('status');
    await this.model('settings').where({
      id: 1
    }).update({
      autoDelivery: status
    });
    return this.success();
  }

  async storeShipperSettingsAction() {
    const values = this.post();
    await this.model('settings').where({
      id: values.id
    }).update(values);
    return this.success();
  }

  async senderInfoAction() {
    const info = await this.model('settings').where({
      id: 1
    }).find();
    return this.success(info);
  }
};
