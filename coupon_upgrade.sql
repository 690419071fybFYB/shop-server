-- Coupon feature upgrade script (idempotent)

SET NAMES utf8mb4;

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `hiolabs_coupon` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `coupon_key` varchar(64) NOT NULL DEFAULT '',
  `name` varchar(128) NOT NULL DEFAULT '',
  `type` varchar(32) NOT NULL DEFAULT 'full_reduction',
  `threshold_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `reduce_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount_rate` decimal(5,2) NOT NULL DEFAULT '10.00',
  `discount_max_reduce` decimal(10,2) NOT NULL DEFAULT '0.00',
  `scope_type` varchar(16) NOT NULL DEFAULT 'all',
  `segment_rules_json` text,
  `claim_start_at` int NOT NULL DEFAULT '0',
  `claim_end_at` int NOT NULL DEFAULT '0',
  `use_start_at` int NOT NULL DEFAULT '0',
  `use_end_at` int NOT NULL DEFAULT '0',
  `total_limit` int NOT NULL DEFAULT '0',
  `received_count` int NOT NULL DEFAULT '0',
  `used_count` int NOT NULL DEFAULT '0',
  `per_user_limit` int NOT NULL DEFAULT '1',
  `status` varchar(16) NOT NULL DEFAULT 'draft',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  `add_time` int NOT NULL DEFAULT '0',
  `update_time` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_coupon_key` (`coupon_key`),
  KEY `idx_status_time` (`status`,`use_start_at`,`use_end_at`),
  KEY `idx_claim_time` (`claim_start_at`,`claim_end_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_coupon_goods` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `coupon_id` int unsigned NOT NULL DEFAULT '0',
  `goods_id` int NOT NULL DEFAULT '0',
  `add_time` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_coupon_goods` (`coupon_id`,`goods_id`),
  KEY `idx_goods_id` (`goods_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_user_coupon` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `coupon_id` int unsigned NOT NULL DEFAULT '0',
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `status` varchar(16) NOT NULL DEFAULT 'unused',
  `claim_time` int NOT NULL DEFAULT '0',
  `lock_time` int NOT NULL DEFAULT '0',
  `used_time` int NOT NULL DEFAULT '0',
  `expire_time` int NOT NULL DEFAULT '0',
  `lock_order_id` int unsigned NOT NULL DEFAULT '0',
  `used_order_id` int unsigned NOT NULL DEFAULT '0',
  `discount_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_coupon_once` (`user_id`,`coupon_id`),
  KEY `idx_user_status_expire` (`user_id`,`status`,`expire_time`),
  KEY `idx_order_lock` (`lock_order_id`,`status`),
  KEY `idx_order_used` (`used_order_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hiolabs_order_coupon` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int unsigned NOT NULL DEFAULT '0',
  `user_coupon_id` bigint unsigned NOT NULL DEFAULT '0',
  `coupon_id` int unsigned NOT NULL DEFAULT '0',
  `coupon_type` varchar(32) NOT NULL DEFAULT '',
  `coupon_name_snapshot` varchar(128) NOT NULL DEFAULT '',
  `discount_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `add_time` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_user_coupon_id` (`user_coupon_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @add_coupon_price_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_order'
        AND COLUMN_NAME = 'coupon_price'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_order` ADD COLUMN `coupon_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '优惠券优惠金额'"
  )
);
PREPARE stmt_add_coupon_price FROM @add_coupon_price_col;
EXECUTE stmt_add_coupon_price;
DEALLOCATE PREPARE stmt_add_coupon_price;

SET @add_promotions_price_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_order'
        AND COLUMN_NAME = 'promotions_price'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_order` ADD COLUMN `promotions_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '营销优惠金额'"
  )
);
PREPARE stmt_add_promotions_price FROM @add_promotions_price_col;
EXECUTE stmt_add_promotions_price;
DEALLOCATE PREPARE stmt_add_promotions_price;

SET @add_coupon_detail_json_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_order'
        AND COLUMN_NAME = 'coupon_detail_json'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_order` ADD COLUMN `coupon_detail_json` text COMMENT '优惠券快照明细'"
  )
);
PREPARE stmt_add_coupon_detail_json FROM @add_coupon_detail_json_col;
EXECUTE stmt_add_coupon_detail_json;
DEALLOCATE PREPARE stmt_add_coupon_detail_json;

INSERT INTO `hiolabs_admin_permission`
(`id`, `perm_key`, `perm_name`, `perm_type`, `parent_id`, `path`, `method`, `is_system`, `is_delete`)
VALUES
(20,'menu.settings.coupon','优惠券','menu',6,'/dashboard/coupon','',1,0),
(40,'menu.api.coupon','优惠券接口','menu',15,'','',1,0),
(41,'admin:coupon.list','优惠券列表接口','api',40,'/admin/coupon/list','GET',1,0),
(42,'admin:coupon.detail','优惠券详情接口','api',40,'/admin/coupon/detail','GET',1,0),
(43,'admin:coupon.create','优惠券创建接口','api',40,'/admin/coupon/create','POST',1,0),
(44,'admin:coupon.update','优惠券更新接口','api',40,'/admin/coupon/update','POST',1,0),
(45,'admin:coupon.toggle','优惠券状态切换接口','api',40,'/admin/coupon/toggle','POST',1,0),
(46,'admin:coupon.delete','优惠券删除接口','api',40,'/admin/coupon/delete','POST',1,0),
(47,'admin:coupon.claimrecord','优惠券领取记录接口','api',40,'/admin/coupon/claimRecord','GET',1,0),
(48,'admin:coupon.userecord','优惠券使用记录接口','api',40,'/admin/coupon/useRecord','GET',1,0),
(49,'admin:coupon.claimrecordexport','优惠券领取记录导出接口','api',40,'/admin/coupon/claimRecordExport','GET',1,0),
(50,'admin:coupon.userecordexport','优惠券使用记录导出接口','api',40,'/admin/coupon/useRecordExport','GET',1,0)
ON DUPLICATE KEY UPDATE
`perm_name` = VALUES(`perm_name`),
`perm_type` = VALUES(`perm_type`),
`parent_id` = VALUES(`parent_id`),
`path` = VALUES(`path`),
`method` = VALUES(`method`),
`is_delete` = VALUES(`is_delete`);

COMMIT;
