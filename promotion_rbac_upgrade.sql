-- Promotion RBAC upgrade script
-- Purpose: add independent promotion menu/api permissions and bind them to ops_admin role.
-- Safe to run repeatedly.

SET NAMES utf8mb4;

START TRANSACTION;

INSERT INTO `hiolabs_admin_permission`
(`perm_key`, `perm_name`, `perm_type`, `parent_id`, `path`, `method`, `is_system`, `is_delete`)
VALUES
('menu.settings.promotion', '促销活动', 'menu', 6, '/dashboard/promotion', '', 1, 0),
('menu.api.promotion', '促销接口', 'menu', 15, '', '', 1, 0)
ON DUPLICATE KEY UPDATE
`perm_name` = VALUES(`perm_name`),
`perm_type` = VALUES(`perm_type`),
`parent_id` = VALUES(`parent_id`),
`path` = VALUES(`path`),
`method` = VALUES(`method`),
`is_delete` = VALUES(`is_delete`);

SET @promotion_api_parent_id := (
  SELECT `id`
  FROM `hiolabs_admin_permission`
  WHERE `perm_key` = 'menu.api.promotion'
  LIMIT 1
);

INSERT INTO `hiolabs_admin_permission`
(`perm_key`, `perm_name`, `perm_type`, `parent_id`, `path`, `method`, `is_system`, `is_delete`)
VALUES
('admin:promotion.list', '促销列表接口', 'api', @promotion_api_parent_id, '/admin/promotion/list', 'GET', 1, 0),
('admin:promotion.detail', '促销详情接口', 'api', @promotion_api_parent_id, '/admin/promotion/detail', 'GET', 1, 0),
('admin:promotion.create', '促销创建接口', 'api', @promotion_api_parent_id, '/admin/promotion/create', 'POST', 1, 0),
('admin:promotion.update', '促销更新接口', 'api', @promotion_api_parent_id, '/admin/promotion/update', 'POST', 1, 0),
('admin:promotion.toggle', '促销状态切换接口', 'api', @promotion_api_parent_id, '/admin/promotion/toggle', 'POST', 1, 0),
('admin:promotion.delete', '促销删除接口', 'api', @promotion_api_parent_id, '/admin/promotion/delete', 'POST', 1, 0)
ON DUPLICATE KEY UPDATE
`perm_name` = VALUES(`perm_name`),
`perm_type` = VALUES(`perm_type`),
`parent_id` = VALUES(`parent_id`),
`path` = VALUES(`path`),
`method` = VALUES(`method`),
`is_delete` = VALUES(`is_delete`);

INSERT IGNORE INTO `hiolabs_admin_role_permission` (`role_id`, `permission_id`)
SELECT ar.id, ap.id
FROM `hiolabs_admin_role` ar
INNER JOIN `hiolabs_admin_permission` ap
  ON ap.perm_key IN (
    'menu.settings.promotion',
    'menu.api.promotion',
    'admin:promotion.list',
    'admin:promotion.detail',
    'admin:promotion.create',
    'admin:promotion.update',
    'admin:promotion.toggle',
    'admin:promotion.delete'
  )
WHERE ar.role_key = 'ops_admin'
  AND ar.is_delete = 0
  AND ap.is_delete = 0;

COMMIT;
