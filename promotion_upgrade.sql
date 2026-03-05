SET NAMES utf8mb4;

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
