#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const mysql = require('mysql2/promise');

const dbConfig = require(path.join(__dirname, '../src/common/config/database.js'));

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const item = args.find((a) => a.startsWith(`${name}=`));
  return item ? item.split('=').slice(1).join('=') : fallback;
};
const hasFlag = (name) => args.includes(name);

const oldDomainRaw = getArg('--old', process.env.OLD_STORAGE_DOMAIN || '');
const newDomainRaw = getArg('--new', process.env.NEW_STORAGE_DOMAIN || '');
const apply = hasFlag('--apply');

if (!oldDomainRaw || !newDomainRaw) {
  console.error('用法: node scripts/replace-storage-domain.js --old=https://old-domain --new=https://new-domain [--apply]');
  process.exit(1);
}

const oldDomain = oldDomainRaw.replace(/\/+$/, '');
const newDomain = newDomainRaw.replace(/\/+$/, '');

if (!/^https?:\/\//i.test(oldDomain) || !/^https?:\/\//i.test(newDomain)) {
  console.error('old/new 域名必须包含 http:// 或 https://');
  process.exit(1);
}

const prefix = dbConfig.prefix || '';
const likePattern = `%${oldDomain}%`;
const textTypes = ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext'];

async function run() {
  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    charset: dbConfig.encoding || 'utf8mb4'
  });

  console.log(`[INFO] 模式: ${apply ? 'APPLY(写入)' : 'DRY-RUN(仅预览)'}`);
  console.log(`[INFO] 替换: ${oldDomain} -> ${newDomain}`);
  console.log(`[INFO] 数据库: ${dbConfig.database}, 表前缀: ${prefix}`);

  let touchedColumns = 0;
  let touchedRows = 0;
  let updatedRows = 0;

  try {
    const [columns] = await conn.query(
      `
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME LIKE ?
      AND DATA_TYPE IN (${textTypes.map(() => '?').join(',')})
      ORDER BY TABLE_NAME, ORDINAL_POSITION
      `,
      [dbConfig.database, `${prefix}%`, ...textTypes]
    );

    for (const col of columns) {
      const tableName = col.TABLE_NAME;
      const columnName = col.COLUMN_NAME;

      const [rows] = await conn.query(
        `SELECT COUNT(1) AS c FROM \`${tableName}\` WHERE \`${columnName}\` LIKE ?`,
        [likePattern]
      );
      const count = Number(rows[0] && rows[0].c ? rows[0].c : 0);
      if (!count) {
        continue;
      }

      touchedColumns += 1;
      touchedRows += count;
      console.log(`[HIT] ${tableName}.${columnName} -> ${count} 行命中`);

      if (apply) {
        const [result] = await conn.query(
          `UPDATE \`${tableName}\` SET \`${columnName}\` = REPLACE(\`${columnName}\`, ?, ?) WHERE \`${columnName}\` LIKE ?`,
          [oldDomain, newDomain, likePattern]
        );
        updatedRows += Number(result.affectedRows || 0);
      }
    }
  } finally {
    await conn.end();
  }

  console.log(`[DONE] 命中列数: ${touchedColumns}`);
  console.log(`[DONE] 命中行数: ${touchedRows}`);
  if (apply) {
    console.log(`[DONE] 实际更新行数: ${updatedRows}`);
  } else {
    console.log('[DONE] 当前为 DRY-RUN，未写入数据库。追加 --apply 执行写入。');
  }
}

run().catch((err) => {
  console.error('[FATAL] 执行失败:', err.message);
  process.exit(1);
});
