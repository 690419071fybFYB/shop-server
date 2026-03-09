-- Ad crop images migration (idempotent)
-- Timezone default: Asia/Shanghai

SET NAMES utf8mb4;

START TRANSACTION;

SET @add_banner_image_url_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_ad'
        AND COLUMN_NAME = 'banner_image_url'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_ad` ADD COLUMN `banner_image_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '轮播裁剪图' AFTER `image_url`"
  )
);
PREPARE stmt_add_banner_image_url_col FROM @add_banner_image_url_col;
EXECUTE stmt_add_banner_image_url_col;
DEALLOCATE PREPARE stmt_add_banner_image_url_col;

SET @add_popup_image_url_col = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hiolabs_ad'
        AND COLUMN_NAME = 'popup_image_url'
    ),
    'SELECT 1',
    "ALTER TABLE `hiolabs_ad` ADD COLUMN `popup_image_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '弹窗裁剪图' AFTER `banner_image_url`"
  )
);
PREPARE stmt_add_popup_image_url_col FROM @add_popup_image_url_col;
EXECUTE stmt_add_popup_image_url_col;
DEALLOCATE PREPARE stmt_add_popup_image_url_col;

UPDATE `hiolabs_ad`
SET `banner_image_url` = `image_url`
WHERE (`banner_image_url` IS NULL OR `banner_image_url` = '')
  AND IFNULL(`image_url`, '') <> '';

UPDATE `hiolabs_ad`
SET `popup_image_url` = `image_url`
WHERE (`popup_image_url` IS NULL OR `popup_image_url` = '')
  AND IFNULL(`image_url`, '') <> '';

COMMIT;
