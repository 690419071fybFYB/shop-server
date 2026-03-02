-- RBAC upgrade script for hioshop-server
-- Safe to run on existing databases (idempotent with IF NOT EXISTS / INSERT IGNORE / ON DUPLICATE KEY).

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `hiolabs_admin_role` (
  `id` int NOT NULL AUTO_INCREMENT,
  `role_key` varchar(64) NOT NULL DEFAULT '',
  `role_name` varchar(64) NOT NULL DEFAULT '',
  `is_system` tinyint(1) NOT NULL DEFAULT '0',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` int NOT NULL DEFAULT '0',
  `updated_at` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_key_unique` (`role_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_admin_permission` (
  `id` int NOT NULL AUTO_INCREMENT,
  `perm_key` varchar(128) NOT NULL DEFAULT '',
  `perm_name` varchar(128) NOT NULL DEFAULT '',
  `perm_type` varchar(16) NOT NULL DEFAULT 'menu',
  `parent_id` int NOT NULL DEFAULT '0',
  `path` varchar(255) NOT NULL DEFAULT '',
  `method` varchar(16) NOT NULL DEFAULT '',
  `is_system` tinyint(1) NOT NULL DEFAULT '0',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `perm_key_unique` (`perm_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_admin_role_permission` (
  `id` int NOT NULL AUTO_INCREMENT,
  `role_id` int NOT NULL DEFAULT '0',
  `permission_id` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_perm_unique` (`role_id`,`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_admin_user_role` (
  `id` int NOT NULL AUTO_INCREMENT,
  `admin_id` int NOT NULL DEFAULT '0',
  `role_id` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `admin_role_unique` (`admin_id`,`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `hiolabs_admin_role`
(`id`, `role_key`, `role_name`, `is_system`, `is_delete`, `created_at`, `updated_at`)
VALUES
(1, 'super_admin', '超级管理员', 1, 0, 1772300000, 1772300000),
(2, 'ops_admin', '运营管理员', 0, 0, 1772300000, 1772300000),
(3, 'order_support', '订单客服', 0, 0, 1772300000, 1772300000),
(4, 'audit_viewer', '只读审计', 0, 0, 1772300000, 1772300000)
ON DUPLICATE KEY UPDATE
`role_name` = VALUES(`role_name`),
`is_delete` = VALUES(`is_delete`),
`updated_at` = VALUES(`updated_at`);

INSERT INTO `hiolabs_admin_permission`
(`id`, `perm_key`, `perm_name`, `perm_type`, `parent_id`, `path`, `method`, `is_system`, `is_delete`)
VALUES
(1,'menu.dashboard.welcome','后台主页','menu',0,'/dashboard/welcome','',1,0),
(2,'menu.order','订单列表','menu',0,'/dashboard/order','',1,0),
(3,'menu.goods','商品管理','menu',0,'/dashboard/goods','',1,0),
(4,'menu.shopcart','购物车','menu',0,'/dashboard/shopcart','',1,0),
(5,'menu.user','用户列表','menu',0,'/dashboard/user','',1,0),
(6,'menu.settings','店铺设置','menu',0,'/dashboard/settings','',1,0),
(7,'menu.settings.showset','显示设置','menu',6,'/dashboard/settings/showset','',1,0),
(8,'menu.settings.ad','广告列表','menu',6,'/dashboard/ad','',1,0),
(9,'menu.settings.notice','公告管理','menu',6,'/dashboard/notice','',1,0),
(10,'menu.settings.freight','运费模板','menu',6,'/dashboard/freight','',1,0),
(11,'menu.settings.shipper','快递设置','menu',6,'/dashboard/shipper','',1,0),
(12,'menu.settings.admin','管理员','menu',6,'/dashboard/admin','',1,0),
(13,'menu.settings.role','角色权限','menu',6,'/dashboard/role','',1,0),
(21,'admin:admin.index','管理员列表接口','api',0,'/admin/admin','GET',1,0),
(22,'admin:admin.admindetail','管理员详情接口','api',0,'/admin/admin/adminDetail','POST',1,0),
(23,'admin:admin.adminadd','管理员新增接口','api',0,'/admin/admin/adminAdd','POST',1,0),
(24,'admin:admin.adminsave','管理员编辑接口','api',0,'/admin/admin/adminSave','POST',1,0),
(25,'admin:admin.deleadmin','管理员删除接口','api',0,'/admin/admin/deleAdmin','POST',1,0),
(26,'admin:role.list','角色列表接口','api',0,'/admin/role/list','GET',1,0),
(27,'admin:role.create','角色新增接口','api',0,'/admin/role/create','POST',1,0),
(28,'admin:role.update','角色编辑接口','api',0,'/admin/role/update','POST',1,0),
(29,'admin:role.delete','角色删除接口','api',0,'/admin/role/delete','POST',1,0),
(30,'admin:role.grant','角色授权接口','api',0,'/admin/role/grant','POST',1,0),
(31,'admin:permission.tree','权限树接口','api',0,'/admin/permission/tree','GET',1,0)
ON DUPLICATE KEY UPDATE
`perm_name` = VALUES(`perm_name`),
`perm_type` = VALUES(`perm_type`),
`parent_id` = VALUES(`parent_id`),
`path` = VALUES(`path`),
`method` = VALUES(`method`),
`is_delete` = VALUES(`is_delete`);

INSERT IGNORE INTO `hiolabs_admin_role_permission` (`role_id`,`permission_id`) VALUES
(2,1),(2,2),(2,3),(2,4),(2,5),(2,6),(2,7),(2,8),(2,9),(2,10),(2,11),
(3,1),(3,2),
(4,1),(4,2),(4,5),
(2,21),(2,22),(2,23),(2,24),(2,25),
(2,26),(2,27),(2,28),(2,29),(2,30),(2,31);

INSERT IGNORE INTO `hiolabs_admin_user_role` (`admin_id`,`role_id`)
SELECT 14, 1 FROM DUAL WHERE EXISTS (SELECT 1 FROM `hiolabs_admin` WHERE `id` = 14);

INSERT IGNORE INTO `hiolabs_admin_user_role` (`admin_id`,`role_id`)
SELECT `id`, 2
FROM `hiolabs_admin`
WHERE `is_delete` = 0
  AND `id` <> 14;

COMMIT;
