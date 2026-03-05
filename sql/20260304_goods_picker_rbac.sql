-- Goods picker RBAC migration (idempotent)
SET NAMES utf8mb4;

START TRANSACTION;

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'menu.api.goods_picker','商品选品接口','menu',p.id,'','',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'menu.api.goods_picker');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:goods.pickerlist','商品选品列表接口','api',p.id,'/admin/goods/pickerList','GET',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.goods_picker'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:goods.pickerlist');

INSERT INTO `hiolabs_admin_permission` (`perm_key`,`perm_name`,`perm_type`,`parent_id`,`path`,`method`,`is_system`,`is_delete`)
SELECT 'admin:goods.pickersku','商品选品SKU接口','api',p.id,'/admin/goods/pickerSku','GET',1,0
FROM `hiolabs_admin_permission` p
WHERE p.perm_key = 'menu.api.goods_picker'
  AND NOT EXISTS (SELECT 1 FROM `hiolabs_admin_permission` x WHERE x.perm_key = 'admin:goods.pickersku');

INSERT INTO `hiolabs_admin_role_permission` (`role_id`,`permission_id`)
SELECT 1, p.id
FROM `hiolabs_admin_permission` p
WHERE p.perm_key IN ('menu.api.goods_picker','admin:goods.pickerlist','admin:goods.pickersku')
  AND NOT EXISTS (
    SELECT 1 FROM `hiolabs_admin_role_permission` rp
    WHERE rp.role_id = 1 AND rp.permission_id = p.id
  );

COMMIT;
