SET NAMES utf8mb4;

-- Read-only scan for potentially mojibake text in promotion fields.
-- This script does NOT modify any data.
-- `candidate_repaired` is only a reversible preview result for manual confirmation.

SELECT
  id,
  promotion_key,
  name AS raw_value,
  HEX(name) AS raw_hex,
  CONVERT(CAST(CONVERT(name USING latin1) AS BINARY) USING utf8mb4) AS candidate_repaired
FROM hiolabs_promotion
WHERE is_delete = 0
  AND name <> ''
  AND HEX(name) REGEXP 'C2|C3'
  AND HEX(name) <> HEX(CONVERT(CAST(CONVERT(name USING latin1) AS BINARY) USING utf8mb4))
ORDER BY id DESC;

SELECT
  id,
  promotion_key,
  promo_tag AS raw_value,
  HEX(promo_tag) AS raw_hex,
  CONVERT(CAST(CONVERT(promo_tag USING latin1) AS BINARY) USING utf8mb4) AS candidate_repaired
FROM hiolabs_promotion
WHERE is_delete = 0
  AND promo_tag <> ''
  AND HEX(promo_tag) REGEXP 'C2|C3'
  AND HEX(promo_tag) <> HEX(CONVERT(CAST(CONVERT(promo_tag USING latin1) AS BINARY) USING utf8mb4))
ORDER BY id DESC;
