SET NAMES utf8mb4;

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `hiolabs_invite_config` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否开启拉新活动',
  `reward_coupon_id` int unsigned NOT NULL DEFAULT '0' COMMENT '奖励券模板ID',
  `daily_limit` int unsigned NOT NULL DEFAULT '10' COMMENT '单邀请人每日奖励上限',
  `add_time` int NOT NULL DEFAULT '0',
  `update_time` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `hiolabs_invite_relation` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `inviter_user_id` int unsigned NOT NULL DEFAULT '0',
  `invitee_user_id` int unsigned NOT NULL DEFAULT '0',
  `invite_code` varchar(24) NOT NULL DEFAULT '',
  `bind_at` int NOT NULL DEFAULT '0',
  `reward_status` varchar(32) NOT NULL DEFAULT 'pending',
  `reward_coupon_id` int unsigned NOT NULL DEFAULT '0',
  `reward_coupon_user_id` bigint unsigned NOT NULL DEFAULT '0',
  `fail_reason` varchar(255) NOT NULL DEFAULT '',
  `add_time` int NOT NULL DEFAULT '0',
  `update_time` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_invitee_user` (`invitee_user_id`),
  KEY `idx_inviter_bind` (`inviter_user_id`,`bind_at`),
  KEY `idx_reward_status` (`reward_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_user' AND COLUMN_NAME = 'invite_code') = 0,
  "ALTER TABLE `hiolabs_user` ADD COLUMN `invite_code` varchar(24) DEFAULT NULL COMMENT '拉新邀请码' AFTER `avatar`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `hiolabs_user`
SET `invite_code` = CONCAT('U', LPAD(`id`, 7, '0'))
WHERE (`invite_code` IS NULL OR `invite_code` = '');

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiolabs_user' AND INDEX_NAME = 'uniq_invite_code') = 0,
  "CREATE UNIQUE INDEX `uniq_invite_code` ON `hiolabs_user` (`invite_code`)",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `hiolabs_invite_config` (`id`,`enabled`,`reward_coupon_id`,`daily_limit`,`add_time`,`update_time`)
SELECT 1,0,0,10,UNIX_TIMESTAMP(),UNIX_TIMESTAMP()
WHERE NOT EXISTS (SELECT 1 FROM `hiolabs_invite_config` WHERE id = 1);

SET @menu_settings_id := (
  SELECT id
  FROM `hiolabs_admin_permission`
  WHERE perm_key = 'menu.settings'
  LIMIT 1
);
SET @menu_api_id := (
  SELECT id
  FROM `hiolabs_admin_permission`
  WHERE perm_key = 'menu.api'
  LIMIT 1
);

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'menu.settings.invite','拉新有礼','menu',IFNULL(@menu_settings_id, 6),'/dashboard/invite','',1,0
WHERE NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` WHERE perm_key = 'menu.settings.invite');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'menu.api.invite','拉新有礼接口','menu',IFNULL(@menu_api_id, 15),'','',1,0
WHERE NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` WHERE perm_key = 'menu.api.invite');

SET @menu_api_invite_id := (
  SELECT id
  FROM `hiolabs_admin_permission`
  WHERE perm_key = 'menu.api.invite'
  LIMIT 1
);

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:invite.config','拉新配置接口','api',@menu_api_invite_id,'/admin/invite/config','GET,POST',1,0
WHERE @menu_api_invite_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` WHERE perm_key = 'admin:invite.config');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:invite.list','拉新记录接口','api',@menu_api_invite_id,'/admin/invite/list','GET',1,0
WHERE @menu_api_invite_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` WHERE perm_key = 'admin:invite.list');

INSERT IGNORE INTO `hiolabs_admin_role_permission` (`role_id`,`permission_id`)
SELECT r.id, p.id
FROM `hiolabs_admin_role` r
INNER JOIN `hiolabs_admin_permission` p
  ON p.perm_key IN (
    'menu.settings.invite',
    'menu.api.invite',
    'admin:invite.config',
    'admin:invite.list'
  )
WHERE r.role_key IN ('super_admin', 'ops_admin')
  AND r.is_delete = 0;

COMMIT;
