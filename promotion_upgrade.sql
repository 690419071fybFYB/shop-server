SET NAMES utf8mb4;

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `hiolabs_promotion` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL DEFAULT '' COMMENT '活动名称',
  `promo_tag` varchar(32) NOT NULL DEFAULT '' COMMENT '活动标签',
  `promo_type` varchar(16) NOT NULL DEFAULT 'discount' COMMENT 'discount/direct_reduce',
  `discount_rate` decimal(5,2) NOT NULL DEFAULT '10.00' COMMENT '折扣率，10为不打折',
  `reduce_amount` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '直减金额',
  `scope_type` varchar(16) NOT NULL DEFAULT 'all' COMMENT 'all/goods',
  `start_at` int NOT NULL DEFAULT '0' COMMENT '开始时间戳',
  `end_at` int NOT NULL DEFAULT '0' COMMENT '结束时间戳',
  `priority` int NOT NULL DEFAULT '0' COMMENT '优先级，越大越优先',
  `status` varchar(16) NOT NULL DEFAULT 'draft' COMMENT 'draft/enabled/disabled',
  `is_delete` tinyint(1) NOT NULL DEFAULT '0',
  `add_time` int NOT NULL DEFAULT '0',
  `update_time` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_status_time` (`status`,`start_at`,`end_at`),
  KEY `idx_priority` (`priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `hiolabs_promotion_goods` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `promotion_id` int unsigned NOT NULL DEFAULT '0',
  `goods_id` int unsigned NOT NULL DEFAULT '0',
  `add_time` int NOT NULL DEFAULT '0',
  `update_time` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_promotion_goods` (`promotion_id`,`goods_id`),
  KEY `idx_goods_id` (`goods_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- legacy schema compatibility for existing hiolabs_promotion
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion' AND COLUMN_NAME = 'promo_tag') = 0,
  "ALTER TABLE `hiolabs_promotion` ADD COLUMN `promo_tag` varchar(32) NOT NULL DEFAULT '' COMMENT '活动标签' AFTER `name`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion' AND COLUMN_NAME = 'promo_type') = 0,
  "ALTER TABLE `hiolabs_promotion` ADD COLUMN `promo_type` varchar(16) NOT NULL DEFAULT 'discount' COMMENT 'discount/direct_reduce' AFTER `promo_tag`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion' AND COLUMN_NAME = 'discount_rate') = 0,
  "ALTER TABLE `hiolabs_promotion` ADD COLUMN `discount_rate` decimal(5,2) NOT NULL DEFAULT '10.00' COMMENT '折扣率，10为不打折' AFTER `promo_type`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion' AND COLUMN_NAME = 'reduce_amount') = 0,
  "ALTER TABLE `hiolabs_promotion` ADD COLUMN `reduce_amount` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '直减金额' AFTER `discount_rate`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion' AND COLUMN_NAME = 'scope_type') = 0,
  "ALTER TABLE `hiolabs_promotion` ADD COLUMN `scope_type` varchar(16) NOT NULL DEFAULT 'all' COMMENT 'all/goods' AFTER `reduce_amount`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion' AND COLUMN_NAME = 'priority') = 0,
  "ALTER TABLE `hiolabs_promotion` ADD COLUMN `priority` int NOT NULL DEFAULT '0' COMMENT '优先级，越大越优先' AFTER `end_at`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `hiolabs_promotion`
SET `promo_type` = CASE
  WHEN (`promo_type` IS NULL OR `promo_type` = '') AND `type` = 'direct_reduce' THEN 'direct_reduce'
  WHEN (`promo_type` IS NULL OR `promo_type` = '') THEN 'discount'
  ELSE `promo_type`
END;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion' AND INDEX_NAME = 'idx_status_time') = 0,
  "CREATE INDEX `idx_status_time` ON `hiolabs_promotion` (`status`,`start_at`,`end_at`)",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion' AND INDEX_NAME = 'idx_priority') = 0,
  "CREATE INDEX `idx_priority` ON `hiolabs_promotion` (`priority`)",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- legacy schema compatibility for existing hiolabs_promotion_goods
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion_goods' AND COLUMN_NAME = 'add_time') = 0,
  "ALTER TABLE `hiolabs_promotion_goods` ADD COLUMN `add_time` int NOT NULL DEFAULT '0'",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion_goods' AND COLUMN_NAME = 'update_time') = 0,
  "ALTER TABLE `hiolabs_promotion_goods` ADD COLUMN `update_time` int NOT NULL DEFAULT '0'",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion_goods' AND INDEX_NAME = 'uniq_promotion_goods') = 0,
  "CREATE UNIQUE INDEX `uniq_promotion_goods` ON `hiolabs_promotion_goods` (`promotion_id`,`goods_id`)",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_promotion_goods' AND INDEX_NAME = 'idx_goods_id') = 0,
  "CREATE INDEX `idx_goods_id` ON `hiolabs_promotion_goods` (`goods_id`)",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

COMMIT;
