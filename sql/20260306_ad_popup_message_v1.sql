-- Ad popup + message center migration (idempotent)
-- Timezone default: Asia/Shanghai

SET NAMES utf8mb4;

START TRANSACTION;

SET @add_ad_title_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_ad'
        AND COLUMN_NAME = 'title'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_ad` ADD COLUMN `title` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '广告标题（消息标题）' AFTER `id`"
  )
);
PREPARE stmt_add_ad_title_col FROM @add_ad_title_col;
EXECUTE stmt_add_ad_title_col;
DEALLOCATE PREPARE stmt_add_ad_title_col;

SET @add_ad_placement_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_ad'
        AND COLUMN_NAME = 'placement'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_ad` ADD COLUMN `placement` tinyint unsigned NOT NULL DEFAULT 1 COMMENT '投放位置：1轮播，2弹窗，3轮播+弹窗' AFTER `image_url`"
  )
);
PREPARE stmt_add_ad_placement_col FROM @add_ad_placement_col;
EXECUTE stmt_add_ad_placement_col;
DEALLOCATE PREPARE stmt_add_ad_placement_col;

SET @add_ad_start_time_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_ad'
        AND COLUMN_NAME = 'start_time'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_ad` ADD COLUMN `start_time` int unsigned NOT NULL DEFAULT 0 COMMENT '开始时间（秒级时间戳）' AFTER `placement`"
  )
);
PREPARE stmt_add_ad_start_time_col FROM @add_ad_start_time_col;
EXECUTE stmt_add_ad_start_time_col;
DEALLOCATE PREPARE stmt_add_ad_start_time_col;

CREATE TABLE IF NOT EXISTS `hiolabs_user_ad_read` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL DEFAULT 0,
  `ad_id` int unsigned NOT NULL DEFAULT 0,
  `read_time` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uniq_user_ad` (`user_id`,`ad_id`) USING BTREE,
  KEY `idx_ad_id` (`ad_id`) USING BTREE,
  KEY `idx_user_id` (`user_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

COMMIT;
