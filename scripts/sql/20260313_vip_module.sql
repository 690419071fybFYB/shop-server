-- VIP module migration (phase 1 + phase 2 baseline)
-- Safe to run multiple times where possible.
SET NAMES utf8mb4;

SET @db_name = DATABASE();

SET @has_grant_batch_key = (
  SELECT COUNT(1)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'hiolabs_user_coupon'
    AND COLUMN_NAME = 'grant_batch_key'
);
SET @sql_add_grant_batch_key = IF(
  @has_grant_batch_key = 0,
  'ALTER TABLE `hiolabs_user_coupon` ADD COLUMN `grant_batch_key` varchar(64) NOT NULL DEFAULT '''' AFTER `user_id`',
  'SELECT ''skip add grant_batch_key'''
);
PREPARE stmt_add_grant_batch_key FROM @sql_add_grant_batch_key;
EXECUTE stmt_add_grant_batch_key;
DEALLOCATE PREPARE stmt_add_grant_batch_key;

SET @has_old_user_coupon_idx = (
  SELECT COUNT(1)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'hiolabs_user_coupon'
    AND INDEX_NAME = 'uniq_user_coupon_once'
);
SET @sql_drop_old_user_coupon_idx = IF(
  @has_old_user_coupon_idx > 0,
  'ALTER TABLE `hiolabs_user_coupon` DROP INDEX `uniq_user_coupon_once`',
  'SELECT ''skip drop uniq_user_coupon_once'''
);
PREPARE stmt_drop_old_user_coupon_idx FROM @sql_drop_old_user_coupon_idx;
EXECUTE stmt_drop_old_user_coupon_idx;
DEALLOCATE PREPARE stmt_drop_old_user_coupon_idx;

SET @has_new_user_coupon_idx = (
  SELECT COUNT(1)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'hiolabs_user_coupon'
    AND INDEX_NAME = 'uniq_user_coupon_once'
);
SET @sql_add_new_user_coupon_idx = IF(
  @has_new_user_coupon_idx = 0,
  'ALTER TABLE `hiolabs_user_coupon` ADD UNIQUE INDEX `uniq_user_coupon_once` (`user_id`, `coupon_id`, `grant_batch_key`)',
  'SELECT ''skip add uniq_user_coupon_once'''
);
PREPARE stmt_add_new_user_coupon_idx FROM @sql_add_new_user_coupon_idx;
EXECUTE stmt_add_new_user_coupon_idx;
DEALLOCATE PREPARE stmt_add_new_user_coupon_idx;

SET @has_vip_discount_price = (
  SELECT COUNT(1)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'hiolabs_order'
    AND COLUMN_NAME = 'vip_discount_price'
);
SET @sql_add_vip_discount_price = IF(
  @has_vip_discount_price = 0,
  'ALTER TABLE `hiolabs_order` ADD COLUMN `vip_discount_price` decimal(10,2) NOT NULL DEFAULT ''0.00'' COMMENT ''会员优惠金额'' AFTER `promotions_price`',
  'SELECT ''skip add vip_discount_price'''
);
PREPARE stmt_add_vip_discount_price FROM @sql_add_vip_discount_price;
EXECUTE stmt_add_vip_discount_price;
DEALLOCATE PREPARE stmt_add_vip_discount_price;

CREATE TABLE IF NOT EXISTS `hiolabs_vip_plan` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `plan_name` varchar(120) NOT NULL DEFAULT '',
  `plan_code` varchar(32) NOT NULL DEFAULT '',
  `duration_days` int unsigned NOT NULL DEFAULT '30',
  `price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `original_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `sort_order` int unsigned NOT NULL DEFAULT '100',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `monthly_coupon_id` int unsigned NOT NULL DEFAULT '0',
  `monthly_coupon_count` int unsigned NOT NULL DEFAULT '6',
  `monthly_coupon_valid_days` int unsigned NOT NULL DEFAULT '30',
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  `add_time` int unsigned NOT NULL DEFAULT '0',
  `update_time` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_enabled_sort` (`enabled`,`sort_order`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_vip_user` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `plan_id` int unsigned NOT NULL DEFAULT '0',
  `plan_name` varchar(120) NOT NULL DEFAULT '',
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `start_time` int unsigned NOT NULL DEFAULT '0',
  `expire_time` int unsigned NOT NULL DEFAULT '0',
  `last_order_id` int unsigned NOT NULL DEFAULT '0',
  `autorenew_status` varchar(16) NOT NULL DEFAULT 'off',
  `contract_id` varchar(64) NOT NULL DEFAULT '',
  `next_renew_at` int unsigned NOT NULL DEFAULT '0',
  `grace_expire_at` int unsigned NOT NULL DEFAULT '0',
  `retry_count` tinyint unsigned NOT NULL DEFAULT '0',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  `add_time` int unsigned NOT NULL DEFAULT '0',
  `update_time` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user` (`user_id`),
  KEY `idx_status_expire` (`status`,`expire_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_vip_order` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int unsigned NOT NULL DEFAULT '0',
  `order_sn` varchar(20) NOT NULL DEFAULT '',
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `plan_id` int unsigned NOT NULL DEFAULT '0',
  `plan_name` varchar(120) NOT NULL DEFAULT '',
  `duration_days` int unsigned NOT NULL DEFAULT '0',
  `order_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `pay_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `pay_status` varchar(16) NOT NULL DEFAULT 'unpaid',
  `status` varchar(16) NOT NULL DEFAULT 'pending_pay',
  `pay_time` int unsigned NOT NULL DEFAULT '0',
  `start_time` int unsigned NOT NULL DEFAULT '0',
  `expire_time` int unsigned NOT NULL DEFAULT '0',
  `refund_status` varchar(16) NOT NULL DEFAULT 'none',
  `refund_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `refund_reason` varchar(255) NOT NULL DEFAULT '',
  `refund_sn` varchar(64) NOT NULL DEFAULT '',
  `refund_apply_at` int unsigned NOT NULL DEFAULT '0',
  `refund_audit_at` int unsigned NOT NULL DEFAULT '0',
  `refund_completed_at` int unsigned NOT NULL DEFAULT '0',
  `refund_audit_admin_id` int unsigned NOT NULL DEFAULT '0',
  `refund_remark` varchar(255) NOT NULL DEFAULT '',
  `source` varchar(16) NOT NULL DEFAULT 'manual',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  `add_time` int unsigned NOT NULL DEFAULT '0',
  `update_time` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_order_id` (`order_id`),
  KEY `idx_user_status` (`user_id`,`status`,`pay_status`),
  KEY `idx_refund_status` (`refund_status`,`update_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_vip_sku_price` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `plan_id` int unsigned NOT NULL DEFAULT '0',
  `goods_id` int unsigned NOT NULL DEFAULT '0',
  `goods_name` varchar(120) NOT NULL DEFAULT '',
  `sku_id` int unsigned NOT NULL DEFAULT '0',
  `sku_name` varchar(120) NOT NULL DEFAULT '',
  `origin_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `vip_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  `add_time` int unsigned NOT NULL DEFAULT '0',
  `update_time` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_plan_sku` (`plan_id`,`sku_id`),
  KEY `idx_goods_id` (`goods_id`,`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_vip_coupon_grant_log` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `plan_id` int unsigned NOT NULL DEFAULT '0',
  `coupon_id` int unsigned NOT NULL DEFAULT '0',
  `grant_batch_key` varchar(32) NOT NULL DEFAULT '',
  `grant_count` int unsigned NOT NULL DEFAULT '0',
  `valid_days` int unsigned NOT NULL DEFAULT '30',
  `status` varchar(16) NOT NULL DEFAULT 'processing',
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  `add_time` int unsigned NOT NULL DEFAULT '0',
  `update_time` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_plan_coupon_batch` (`user_id`,`plan_id`,`coupon_id`,`grant_batch_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_vip_event_log` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `event_type` varchar(32) NOT NULL DEFAULT '',
  `event_action` varchar(32) NOT NULL DEFAULT '',
  `order_id` int unsigned NOT NULL DEFAULT '0',
  `vip_order_id` int unsigned NOT NULL DEFAULT '0',
  `request_id` varchar(64) NOT NULL DEFAULT '',
  `payload_json` text,
  `operator_type` varchar(16) NOT NULL DEFAULT 'system',
  `operator_id` int unsigned NOT NULL DEFAULT '0',
  `add_time` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_user_event_time` (`user_id`,`event_type`,`add_time`),
  KEY `idx_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `hiolabs_vip_plan`
  (`id`,`plan_name`,`plan_code`,`duration_days`,`price`,`original_price`,`sort_order`,`enabled`,`monthly_coupon_id`,`monthly_coupon_count`,`monthly_coupon_valid_days`,`remark`,`is_delete`,`add_time`,`update_time`)
VALUES
  (1,CONVERT(0xE9BB84E98791E4BC9AE59198E5B9B4E58DA1 USING utf8mb4),'gold_year',365,69.00,69.00,10,1,0,6,30,'default_year_plan',0,0,0),
  (2,CONVERT(0xE9BB84E98791E4BC9AE59198E5ADA3E58DA1 USING utf8mb4),'gold_quarter',90,25.00,25.00,20,1,0,6,30,'default_quarter_plan',0,0,0)
ON DUPLICATE KEY UPDATE
  `plan_name` = VALUES(`plan_name`),
  `plan_code` = VALUES(`plan_code`),
  `duration_days` = VALUES(`duration_days`),
  `price` = VALUES(`price`),
  `original_price` = VALUES(`original_price`),
  `enabled` = VALUES(`enabled`),
  `monthly_coupon_count` = VALUES(`monthly_coupon_count`),
  `monthly_coupon_valid_days` = VALUES(`monthly_coupon_valid_days`),
  `update_time` = VALUES(`update_time`);

UPDATE `hiolabs_vip_plan`
SET
  `plan_name` = CONVERT(0xE9BB84E98791E4BC9AE59198E5B9B4E58DA1 USING utf8mb4),
  `update_time` = UNIX_TIMESTAMP()
WHERE `plan_code` = 'gold_year' AND `is_delete` = 0;

UPDATE `hiolabs_vip_plan`
SET
  `plan_name` = CONVERT(0xE9BB84E98791E4BC9AE59198E5ADA3E58DA1 USING utf8mb4),
  `update_time` = UNIX_TIMESTAMP()
WHERE `plan_code` = 'gold_quarter' AND `is_delete` = 0;

SET @perm_parent_settings = COALESCE(
  (SELECT id FROM `hiolabs_admin_permission` WHERE perm_key = 'menu.settings' LIMIT 1),
  6
);
SET @perm_parent_api = COALESCE(
  (SELECT id FROM `hiolabs_admin_permission` WHERE perm_key = 'menu.api' LIMIT 1),
  15
);

INSERT INTO `hiolabs_admin_permission`
  (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
VALUES
  ('menu.settings.vip','VIP会员','menu',@perm_parent_settings,'/dashboard/vip/plan','',1,0),
  ('menu.api.vip','VIP接口','menu',@perm_parent_api,'','',1,0)
ON DUPLICATE KEY UPDATE
  `perm_name` = VALUES(`perm_name`),
  `perm_type` = VALUES(`perm_type`),
  `parent_id` = VALUES(`parent_id`),
  `path` = VALUES(`path`),
  `method` = VALUES(`method`),
  `is_system` = VALUES(`is_system`),
  `is_delete` = VALUES(`is_delete`);

SET @perm_parent_api_vip = COALESCE(
  (SELECT id FROM `hiolabs_admin_permission` WHERE perm_key = 'menu.api.vip' LIMIT 1),
  @perm_parent_api
);

INSERT INTO `hiolabs_admin_permission`
  (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
VALUES
  ('admin:vip.planlist','VIP方案列表接口','api',@perm_parent_api_vip,'/admin/vip/planList','GET',1,0),
  ('admin:vip.plancreate','VIP方案创建接口','api',@perm_parent_api_vip,'/admin/vip/planCreate','POST',1,0),
  ('admin:vip.planupdate','VIP方案更新接口','api',@perm_parent_api_vip,'/admin/vip/planUpdate','POST',1,0),
  ('admin:vip.plantoggle','VIP方案状态接口','api',@perm_parent_api_vip,'/admin/vip/planToggle','POST',1,0),
  ('admin:vip.skupricelist','VIP SKU价格列表接口','api',@perm_parent_api_vip,'/admin/vip/skuPriceList','GET',1,0),
  ('admin:vip.skupricesave','VIP SKU价格保存接口','api',@perm_parent_api_vip,'/admin/vip/skuPriceSave','POST',1,0),
  ('admin:vip.memberlist','VIP会员列表接口','api',@perm_parent_api_vip,'/admin/vip/memberList','GET',1,0),
  ('admin:vip.orderlist','VIP订单列表接口','api',@perm_parent_api_vip,'/admin/vip/orderList','GET',1,0),
  ('admin:vip.refundlist','VIP退款列表接口','api',@perm_parent_api_vip,'/admin/vip/refundList','GET',1,0),
  ('admin:vip.refundapprove','VIP退款审核通过接口','api',@perm_parent_api_vip,'/admin/vip/refundApprove','POST',1,0),
  ('admin:vip.refundreject','VIP退款驳回接口','api',@perm_parent_api_vip,'/admin/vip/refundReject','POST',1,0)
ON DUPLICATE KEY UPDATE
  `perm_name` = VALUES(`perm_name`),
  `perm_type` = VALUES(`perm_type`),
  `parent_id` = VALUES(`parent_id`),
  `path` = VALUES(`path`),
  `method` = VALUES(`method`),
  `is_system` = VALUES(`is_system`),
  `is_delete` = VALUES(`is_delete`);

INSERT IGNORE INTO `hiolabs_admin_role_permission` (`role_id`,`permission_id`)
SELECT 2, p.id
FROM `hiolabs_admin_permission` p
WHERE p.perm_key IN (
  'menu.settings.vip',
  'menu.api.vip',
  'admin:vip.planlist',
  'admin:vip.plancreate',
  'admin:vip.planupdate',
  'admin:vip.plantoggle',
  'admin:vip.skupricelist',
  'admin:vip.skupricesave',
  'admin:vip.memberlist',
  'admin:vip.orderlist',
  'admin:vip.refundlist',
  'admin:vip.refundapprove',
  'admin:vip.refundreject'
);
