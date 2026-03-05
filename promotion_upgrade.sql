-- Promotion V1 migration (idempotent)
-- Timezone default: Asia/Shanghai

SET NAMES utf8mb4;

START TRANSACTION;

SET @add_pay_expire_at_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_order'
        AND COLUMN_NAME = 'pay_expire_at'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_order` ADD COLUMN `pay_expire_at` int unsigned NOT NULL DEFAULT 0 COMMENT '支付过期时间（秒级时间戳）' AFTER `freight_price`"
  )
);
PREPARE stmt_add_pay_expire_at FROM @add_pay_expire_at_col;
EXECUTE stmt_add_pay_expire_at;
DEALLOCATE PREPARE stmt_add_pay_expire_at;

SET @add_promotion_detail_json_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_order'
        AND COLUMN_NAME = 'promotion_detail_json'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_order` ADD COLUMN `promotion_detail_json` text COMMENT '促销快照明细' AFTER `coupon_detail_json`"
  )
);
PREPARE stmt_add_promotion_detail_json FROM @add_promotion_detail_json_col;
EXECUTE stmt_add_promotion_detail_json;
DEALLOCATE PREPARE stmt_add_promotion_detail_json;

CREATE TABLE IF NOT EXISTS `hiolabs_promotion` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `promotion_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'timed_discount',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'draft',
  `start_at` int unsigned NOT NULL DEFAULT 0,
  `end_at` int unsigned NOT NULL DEFAULT 0,
  `is_delete` tinyint(1) NOT NULL DEFAULT 0,
  `add_time` int unsigned NOT NULL DEFAULT 0,
  `update_time` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uniq_promotion_key` (`promotion_key`) USING BTREE,
  KEY `idx_status_time` (`status`,`start_at`,`end_at`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `hiolabs_promotion_sku` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `promotion_id` int unsigned NOT NULL DEFAULT 0,
  `goods_id` int unsigned NOT NULL DEFAULT 0,
  `product_id` int unsigned NOT NULL DEFAULT 0,
  `seckill_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  `seckill_stock` int unsigned NOT NULL DEFAULT 0,
  `locked_stock` int unsigned NOT NULL DEFAULT 0,
  `sold_stock` int unsigned NOT NULL DEFAULT 0,
  `per_user_limit` int unsigned NOT NULL DEFAULT 0,
  `sort_order` int NOT NULL DEFAULT 100,
  `add_time` int unsigned NOT NULL DEFAULT 0,
  `update_time` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uniq_promo_product` (`promotion_id`,`product_id`) USING BTREE,
  KEY `idx_product` (`product_id`) USING BTREE,
  KEY `idx_goods` (`goods_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `hiolabs_promotion_tier` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `promotion_id` int unsigned NOT NULL DEFAULT 0,
  `threshold_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `reduce_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `sort_order` int NOT NULL DEFAULT 100,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_promotion` (`promotion_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `hiolabs_promotion_goods` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `promotion_id` int unsigned NOT NULL DEFAULT 0,
  `goods_id` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uniq_promo_goods` (`promotion_id`,`goods_id`) USING BTREE,
  KEY `idx_goods` (`goods_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `hiolabs_order_promotion` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int unsigned NOT NULL DEFAULT 0,
  `promotion_id` int unsigned NOT NULL DEFAULT 0,
  `promotion_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `promotion_name_snapshot` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `discount_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `detail_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `add_time` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_order_id` (`order_id`) USING BTREE,
  KEY `idx_promotion_id` (`promotion_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `hiolabs_promotion_order_lock` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int unsigned NOT NULL DEFAULT 0,
  `promotion_id` int unsigned NOT NULL DEFAULT 0,
  `promotion_sku_id` bigint unsigned NOT NULL DEFAULT 0,
  `user_id` int unsigned NOT NULL DEFAULT 0,
  `quantity` int unsigned NOT NULL DEFAULT 0,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'locked',
  `lock_expire_at` int unsigned NOT NULL DEFAULT 0,
  `add_time` int unsigned NOT NULL DEFAULT 0,
  `update_time` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_lock_expire` (`status`,`lock_expire_at`) USING BTREE,
  KEY `idx_order` (`order_id`) USING BTREE,
  KEY `idx_user_sku` (`user_id`,`promotion_sku_id`,`status`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- RBAC: menu and api permissions
INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'menu.settings.promotion','促销活动','menu',p.id,'/dashboard/promotion','',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.settings'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'menu.settings.promotion');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'menu.api.promotion','促销接口','menu',p.id,'','',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'menu.api.promotion');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:promotion.list','促销列表接口','api',p.id,'/admin/promotion/list','GET',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.promotion'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:promotion.list');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:promotion.detail','促销详情接口','api',p.id,'/admin/promotion/detail','GET',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.promotion'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:promotion.detail');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:promotion.create','促销创建接口','api',p.id,'/admin/promotion/create','POST',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.promotion'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:promotion.create');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:promotion.update','促销更新接口','api',p.id,'/admin/promotion/update','POST',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.promotion'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:promotion.update');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:promotion.toggle','促销状态切换接口','api',p.id,'/admin/promotion/toggle','POST',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.promotion'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:promotion.toggle');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:promotion.delete','促销删除接口','api',p.id,'/admin/promotion/delete','POST',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.promotion'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:promotion.delete');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:promotion.report','促销报表接口','api',p.id,'/admin/promotion/report','GET',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.promotion'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:promotion.report');

-- Grant promotion permissions to super admin role(1)
INSERT INTO `hiolabs_admin_role_permission` (`role_id`,`permission_id`)
SELECT 1, p.id
FROM `hiolabs_admin_permission` p
WHERE p.perm_key IN (
  'menu.settings.promotion','menu.api.promotion',
  'admin:promotion.list','admin:promotion.detail','admin:promotion.create',
  'admin:promotion.update','admin:promotion.toggle','admin:promotion.delete','admin:promotion.report'
)
AND NOT EXISTS (
  SELECT 1 FROM `hiolabs_admin_role_permission` rp
  WHERE rp.role_id = 1 AND rp.permission_id = p.id
);

COMMIT;
