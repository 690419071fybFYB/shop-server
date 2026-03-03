-- Goods import feature upgrade script (idempotent)

SET NAMES utf8mb4;

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `hiolabs_goods_import_task` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_no` varchar(32) NOT NULL DEFAULT '',
  `mode` varchar(32) NOT NULL DEFAULT 'import',
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `file_path` varchar(255) NOT NULL DEFAULT '',
  `error_file_path` varchar(255) NOT NULL DEFAULT '',
  `operator_id` int NOT NULL DEFAULT '0',
  `total_spu` int NOT NULL DEFAULT '0',
  `total_sku` int NOT NULL DEFAULT '0',
  `success_sku` int NOT NULL DEFAULT '0',
  `skipped_sku` int NOT NULL DEFAULT '0',
  `failed_sku` int NOT NULL DEFAULT '0',
  `summary_json` text,
  `started_at` int NOT NULL DEFAULT '0',
  `finished_at` int NOT NULL DEFAULT '0',
  `add_time` int NOT NULL DEFAULT '0',
  `update_time` int NOT NULL DEFAULT '0',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `task_no_unique` (`task_no`),
  KEY `idx_status_add_time` (`status`,`add_time`),
  KEY `idx_operator_add_time` (`operator_id`,`add_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_goods_import_error` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL DEFAULT '0',
  `sheet_name` varchar(32) NOT NULL DEFAULT '',
  `row_no` int NOT NULL DEFAULT '0',
  `spu_code` varchar(64) NOT NULL DEFAULT '',
  `goods_sn` varchar(64) NOT NULL DEFAULT '',
  `field_name` varchar(64) NOT NULL DEFAULT '',
  `error_code` varchar(64) NOT NULL DEFAULT '',
  `error_msg` varchar(255) NOT NULL DEFAULT '',
  `raw_row_json` text,
  `add_time` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_task_row` (`task_id`,`row_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `hiolabs_admin_permission`
(`id`, `perm_key`, `perm_name`, `perm_type`, `parent_id`, `path`, `method`, `is_system`, `is_delete`)
VALUES
(14,'menu.goods.import','商品批量导入','menu',3,'/dashboard/goods/import/tasks','',1,0),
(15,'menu.api','接口权限','menu',0,'','',1,0),
(16,'menu.api.admin','管理员接口','menu',15,'','',1,0),
(17,'menu.api.role','角色接口','menu',15,'','',1,0),
(18,'menu.api.permission','权限接口','menu',15,'','',1,0),
(19,'menu.api.goods_import','商品导入接口','menu',15,'','',1,0),
(32,'admin:goods.importtemplate','商品导入模板下载接口','api',19,'/admin/goods/importTemplate','GET',1,0),
(33,'admin:goods.importtaskcreate','商品导入任务创建接口','api',19,'/admin/goods/importTaskCreate','POST',1,0),
(34,'admin:goods.importtasklist','商品导入任务列表接口','api',19,'/admin/goods/importTaskList','GET',1,0),
(35,'admin:goods.importtaskdetail','商品导入任务详情接口','api',19,'/admin/goods/importTaskDetail','GET',1,0),
(36,'admin:goods.importtaskerrorfile','商品导入错误文件下载接口','api',19,'/admin/goods/importTaskErrorFile','GET',1,0)
ON DUPLICATE KEY UPDATE
`perm_name` = VALUES(`perm_name`),
`perm_type` = VALUES(`perm_type`),
`parent_id` = VALUES(`parent_id`),
`path` = VALUES(`path`),
`method` = VALUES(`method`),
`is_delete` = VALUES(`is_delete`);

UPDATE `hiolabs_admin_permission`
SET `parent_id` = 16
WHERE `perm_key` IN (
  'admin:admin.index',
  'admin:admin.admindetail',
  'admin:admin.adminadd',
  'admin:admin.adminsave',
  'admin:admin.deleadmin'
);

UPDATE `hiolabs_admin_permission`
SET `parent_id` = 17
WHERE `perm_key` IN (
  'admin:role.list',
  'admin:role.create',
  'admin:role.update',
  'admin:role.delete',
  'admin:role.grant'
);

UPDATE `hiolabs_admin_permission`
SET `parent_id` = 18
WHERE `perm_key` = 'admin:permission.tree';

COMMIT;
