const TABLE_PREFIX = 'hiolabs_';

module.exports = class extends think.Service {
  table(name) {
    return `${TABLE_PREFIX}${name}`;
  }

  parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value).toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  isEnabled() {
    const envEnabled = process.env.ADMIN_RBAC_ENABLED;
    if (envEnabled !== undefined) {
      return this.parseBoolean(envEnabled, false);
    }
    const cfg = think.config('admin_rbac') || {};
    return this.parseBoolean(cfg.enabled, false);
  }

  getSuperAdminIds() {
    const envValue = process.env.ADMIN_SUPER_ADMIN_IDS;
    const cfg = think.config('admin_rbac') || {};
    const source = envValue || cfg.super_admin_ids || '14';
    return String(source)
      .split(',')
      .map(item => parseInt(item, 10))
      .filter(item => item > 0);
  }

  isReservedSuperAdmin(adminId) {
    return this.getSuperAdminIds().includes(Number(adminId));
  }

  emptyAuthContext() {
    return {
      role_ids: [],
      roles: [],
      role_keys: [],
      permissions: [],
      is_super_admin: false
    };
  }

  async hasRbacTables() {
    try {
      await this.model('admin_role').limit(1).select();
      await this.model('admin_permission').limit(1).select();
      await this.model('admin_user_role').limit(1).select();
      await this.model('admin_role_permission').limit(1).select();
      return true;
    } catch (err) {
      return false;
    }
  }

  async getRoleRowsByAdminId(adminId) {
    const uid = Number(adminId);
    if (uid <= 0) {
      return [];
    }
    const exists = await this.hasRbacTables();
    if (!exists) {
      if (this.isReservedSuperAdmin(uid)) {
        return [{ id: 0, role_key: 'super_admin', role_name: '超级管理员', is_system: 1 }];
      }
      return [{ id: 0, role_key: 'ops_admin', role_name: '运营管理员', is_system: 0 }];
    }
    const sql = `
      SELECT ar.id, ar.role_key, ar.role_name, ar.is_system
      FROM ${this.table('admin_user_role')} aur
      INNER JOIN ${this.table('admin_role')} ar ON aur.role_id = ar.id
      WHERE aur.admin_id = ${uid} AND ar.is_delete = 0
      ORDER BY ar.id ASC
    `;
    const rows = await this.model('admin').query(sql);
    if (rows && rows.length > 0) {
      return rows;
    }
    if (this.isReservedSuperAdmin(uid)) {
      return [{ id: 0, role_key: 'super_admin', role_name: '超级管理员', is_system: 1 }];
    }
    return [];
  }

  async getPermissionKeysByRoleIds(roleIds) {
    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      return [];
    }
    const exists = await this.hasRbacTables();
    if (!exists) {
      return [];
    }
    const ids = roleIds.map(id => Number(id)).filter(id => id > 0);
    if (!ids.length) {
      return [];
    }
    const sql = `
      SELECT DISTINCT ap.perm_key
      FROM ${this.table('admin_role_permission')} arp
      INNER JOIN ${this.table('admin_permission')} ap ON arp.permission_id = ap.id
      WHERE arp.role_id IN (${ids.join(',')}) AND ap.is_delete = 0
      ORDER BY ap.perm_key ASC
    `;
    const rows = await this.model('admin').query(sql);
    return rows.map(item => item.perm_key).filter(Boolean);
  }

  async getKnownApiPermissionKeys() {
    const exists = await this.hasRbacTables();
    if (!exists) {
      return [];
    }
    const sql = `
      SELECT perm_key
      FROM ${this.table('admin_permission')}
      WHERE perm_type = 'api' AND is_delete = 0
    `;
    const rows = await this.model('admin').query(sql);
    return rows.map(item => item.perm_key).filter(Boolean);
  }

  routePermissionKey(controller, action) {
    return `admin:${String(controller || '').toLowerCase()}.${String(action || '').toLowerCase()}`;
  }

  async shouldCheckApiPermission(permissionKey) {
    const known = await this.getKnownApiPermissionKeys();
    return known.includes(permissionKey);
  }

  hasPermission(authContext, permissionKey) {
    if (!authContext) {
      return false;
    }
    if (authContext.is_super_admin) {
      return true;
    }
    const permissions = Array.isArray(authContext.permissions) ? authContext.permissions : [];
    if (permissions.includes('*')) {
      return true;
    }
    return permissions.includes(permissionKey);
  }

  async getAuthContext(adminId) {
    const context = this.emptyAuthContext();
    const uid = Number(adminId);
    if (uid <= 0) {
      return context;
    }
    const roles = await this.getRoleRowsByAdminId(uid);
    const roleIds = roles.map(item => Number(item.id)).filter(id => id > 0);
    const roleKeys = roles.map(item => item.role_key).filter(Boolean);
    const isSuper = this.isReservedSuperAdmin(uid) || roleKeys.includes('super_admin');
    let permissions = [];
    if (isSuper) {
      permissions = ['*'];
    } else {
      permissions = await this.getPermissionKeysByRoleIds(roleIds);
    }
    return {
      role_ids: roleIds,
      roles,
      role_keys: roleKeys,
      permissions,
      is_super_admin: isSuper
    };
  }

  buildPermissionTree(rows) {
    const nodeMap = {};
    const roots = [];
    rows.forEach(item => {
      nodeMap[item.id] = {
        id: item.id,
        parent_id: item.parent_id,
        perm_key: item.perm_key,
        perm_name: item.perm_name,
        perm_type: item.perm_type,
        path: item.path || '',
        method: item.method || '',
        children: []
      };
    });
    Object.keys(nodeMap).forEach(key => {
      const node = nodeMap[key];
      if (node.parent_id && nodeMap[node.parent_id]) {
        nodeMap[node.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }
};
