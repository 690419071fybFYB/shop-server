#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const OSS = require('ali-oss');
const request = require('request');

const dbConfig = require(path.join(__dirname, '../src/common/config/database.js'));
const appConfig = require(path.join(__dirname, '../src/common/config/config.js'));

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const item = args.find((a) => a.startsWith(`${name}=`));
  return item ? item.split('=').slice(1).join('=') : fallback;
};
const hasFlag = (name) => args.includes(name);

const DRY_RUN = hasFlag('--dry-run');
const LIMIT = Number(getArg('--limit', '0')) || 0;
const CONCURRENCY = Number(getArg('--concurrency', '10')) || 10;
const ONLY_TABLES = (getArg('--tables', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ossConfig = appConfig.oss || {};
const dbPrefix = dbConfig.prefix || '';
const ossDomain = (ossConfig.domain || '').replace(/\/+$/, '');

if (!ossConfig.region || !ossConfig.bucket || !ossConfig.accessKeyId || !ossConfig.accessKeySecret) {
  console.error('[FATAL] OSS 配置不完整，请先检查 src/common/config/config.js 的 oss 配置。');
  process.exit(1);
}

const client = new OSS({
  region: ossConfig.region,
  accessKeyId: ossConfig.accessKeyId,
  accessKeySecret: ossConfig.accessKeySecret,
  bucket: ossConfig.bucket
});

const TABLES = [
  { table: 'ad', pk: 'id', fields: ['image_url'] },
  { table: 'category', pk: 'id', fields: ['icon_url', 'img_url'] },
  { table: 'goods', pk: 'id', fields: ['list_pic_url', 'https_pic_url', 'goods_desc'] },
  { table: 'goods_gallery', pk: 'id', fields: ['img_url'] },
  { table: 'cart', pk: 'id', fields: ['list_pic_url'] },
  { table: 'order_goods', pk: 'id', fields: ['list_pic_url'] },
  { table: 'user', pk: 'id', fields: ['avatar'] }
];

const contentTypeToExt = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg'
};

const urlCache = new Map();
const failedUrls = new Map();

function shouldMigrateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return false;
  if (ossDomain && url.startsWith(ossDomain)) return false;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(url)) return false;
  if (url.includes('.aliyuncs.com/')) return false;
  const isLegacyHost = /yanxuan\.nosdn\.127\.net|nos\.netease\.com/i.test(url);
  if (/^http:\/\//i.test(url)) return true;
  if (isLegacyHost) return true;
  return false;
}

function isLikelyImageUrl(url) {
  if (!url) return false;
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|#|$)/i.test(url)) return true;
  return /yanxuan\.nosdn\.127\.net|nos\.netease\.com/i.test(url);
}

function extractUrlsFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const matches = html.match(/https?:\/\/[^"'<>\s)]+/gi) || [];
  return [...new Set(matches)];
}

function inferExtByUrl(url) {
  const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  if (!match) return '';
  const ext = `.${match[1].toLowerCase()}`;
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) {
    return ext;
  }
  return '';
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    request.get(
      {
        url,
        encoding: null,
        timeout: 5000,
        strictSSL: false,
        followAllRedirects: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; hioshop-image-migrator/1.0)'
        }
      },
      (err, response, body) => {
        if (err) return reject(err);
        if (!response || response.statusCode !== 200) {
          return reject(new Error(`download_failed_status_${response ? response.statusCode : 'unknown'}`));
        }
        const contentType = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        resolve({ body, contentType });
      }
    );
  });
}

async function uploadToOssByUrl(sourceUrl) {
  if (urlCache.has(sourceUrl)) return urlCache.get(sourceUrl);
  if (failedUrls.has(sourceUrl)) throw failedUrls.get(sourceUrl);

  const { body, contentType } = await downloadImage(sourceUrl);
  const extFromType = contentTypeToExt[contentType] || '';
  const extFromUrl = inferExtByUrl(sourceUrl);
  const ext = extFromType || extFromUrl || '.jpg';
  const key = `legacy-migration/${new Date().toISOString().slice(0, 10)}/${crypto
    .createHash('md5')
    .update(sourceUrl)
    .digest('hex')}${ext}`;

  if (!DRY_RUN) {
    await client.put(key, body, {
      headers: {
        'Content-Type': contentType || 'application/octet-stream'
      }
    });
  }
  const migratedUrl = `${ossDomain}/${key}`;
  urlCache.set(sourceUrl, migratedUrl);
  return migratedUrl;
}

async function migrateTextField(value) {
  if (!value || typeof value !== 'string') return { changed: false, nextValue: value };
  if (shouldMigrateUrl(value) && isLikelyImageUrl(value)) {
    const migratedUrl = await uploadToOssByUrl(value);
    return { changed: migratedUrl !== value, nextValue: migratedUrl };
  }
  return { changed: false, nextValue: value };
}

async function migrateHtmlField(html) {
  if (!html || typeof html !== 'string') return { changed: false, nextValue: html };
  const urls = extractUrlsFromHtml(html).filter((url) => shouldMigrateUrl(url) && isLikelyImageUrl(url));
  if (!urls.length) return { changed: false, nextValue: html };

  let nextValue = html;
  let changed = false;
  const queue = [...urls];
  const replacements = new Map();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }).map(async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const migratedUrl = await uploadToOssByUrl(url);
        replacements.set(url, migratedUrl);
      } catch (err) {
        failedUrls.set(url, err);
        console.warn(`[WARN] goods_desc 内URL迁移失败: ${url} -> ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  for (const [url, migratedUrl] of replacements.entries()) {
    if (migratedUrl !== url) {
      nextValue = nextValue.split(url).join(migratedUrl);
      changed = true;
    }
  }
  return { changed, nextValue };
}

async function run() {
  console.log(
    `[INFO] 开始迁移，dryRun=${DRY_RUN}, limit=${LIMIT || 'unlimited'}, concurrency=${CONCURRENCY}, tables=${ONLY_TABLES.join(',') || 'ALL'}`
  );
  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    charset: dbConfig.encoding || 'utf8mb4'
  });

  let scannedRows = 0;
  let updatedRows = 0;
  let migratedFieldCount = 0;

  try {
    for (const cfg of TABLES) {
      if (ONLY_TABLES.length && !ONLY_TABLES.includes(cfg.table)) continue;
      const tableName = `${dbPrefix}${cfg.table}`;
      const selectFields = [cfg.pk, ...cfg.fields].join(', ');
      const [rows] = await conn.query(`SELECT ${selectFields} FROM \`${tableName}\``);

      console.log(`[INFO] 扫描表 ${tableName}, rows=${rows.length}`);
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        scannedRows += 1;
        const updates = {};
        if (idx > 0 && idx % 1000 === 0) {
          console.log(`[INFO] ${tableName} 进度 ${idx}/${rows.length}`);
        }

        for (const field of cfg.fields) {
          const value = row[field];
          try {
            if (field === 'goods_desc') {
              const result = await migrateHtmlField(value);
              if (result.changed) {
                updates[field] = result.nextValue;
                migratedFieldCount += 1;
              }
            } else {
              const result = await migrateTextField(value);
              if (result.changed) {
                updates[field] = result.nextValue;
                migratedFieldCount += 1;
              }
            }
          } catch (err) {
            failedUrls.set(value, err);
            console.warn(`[WARN] 字段迁移失败 table=${tableName} id=${row[cfg.pk]} field=${field} -> ${err.message}`);
          }
        }

        const setCols = Object.keys(updates);
        if (setCols.length > 0) {
          updatedRows += 1;
          if (!DRY_RUN) {
            const sqlSet = setCols.map((col) => `\`${col}\` = ?`).join(', ');
            const sqlParams = [...setCols.map((col) => updates[col]), row[cfg.pk]];
            await conn.query(`UPDATE \`${tableName}\` SET ${sqlSet} WHERE \`${cfg.pk}\` = ?`, sqlParams);
          }
        }

        if (LIMIT > 0 && updatedRows >= LIMIT) {
          console.log(`[INFO] 达到 limit=${LIMIT}，提前结束。`);
          break;
        }
      }
      console.log(`[INFO] 完成表 ${tableName}`);
      if (LIMIT > 0 && updatedRows >= LIMIT) break;
    }
  } finally {
    await conn.end();
  }

  console.log('[DONE] 迁移结束');
  console.log(`[DONE] 扫描记录数: ${scannedRows}`);
  console.log(`[DONE] 更新记录数: ${updatedRows}`);
  console.log(`[DONE] 迁移字段数: ${migratedFieldCount}`);
  console.log(`[DONE] URL缓存命中后唯一上传数: ${urlCache.size}`);
  console.log(`[DONE] 失败URL数: ${failedUrls.size}`);

  if (failedUrls.size > 0) {
    console.log('[FAILED_URLS]');
    for (const [url, err] of failedUrls.entries()) {
      console.log(`${url} -> ${err.message}`);
    }
  }
}

run().catch((err) => {
  console.error('[FATAL] 迁移失败:', err);
  process.exit(1);
});
