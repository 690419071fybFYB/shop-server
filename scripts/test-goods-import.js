#!/usr/bin/env node

require('dotenv').config({path: '.env.local'});
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const jwt = require('jsonwebtoken');

const BASE_URL = process.env.HIOSHOP_ADMIN_API || 'http://127.0.0.1:8360/admin';
const API_BASE_URL = process.env.HIOSHOP_API_BASE || BASE_URL.replace(/\/admin\/?$/, '/api');
const ADMIN_USERNAME = process.env.HIOSHOP_ADMIN_USER || 'qilelab.com';
const ADMIN_PASSWORD = process.env.HIOSHOP_ADMIN_PASS || 'qilelab.com';
const API_TOKEN_SECRET = process.env.API_TOKEN_SECRET || process.env.API_JWT_SECRET || '';
const API_USER_ID = Number(process.env.COUPON_TEST_USER_ID || process.env.TEST_API_USER_ID || 1048);
const POLL_INTERVAL_MS = Number(process.env.HIOSHOP_IMPORT_POLL_MS || 2000);
const POLL_MAX_RETRY = Number(process.env.HIOSHOP_IMPORT_POLL_MAX_RETRY || 60);

const GOODS_HEADERS = [
  'spu_code',
  'name',
  'category_id',
  'goods_brief',
  'goods_desc',
  'goods_unit',
  'is_new',
  'is_on_sale',
  'sort_order',
  'sell_volume',
  'list_pic_url',
  'gallery_urls',
  'freight_template_id'
];

const SKU_HEADERS = [
  'spu_code',
  'goods_sn',
  'goods_name',
  'retail_price',
  'cost',
  'goods_number',
  'goods_weight',
  'spec1_name',
  'spec1_value',
  'spec2_name',
  'spec2_value',
  'spec3_name',
  'spec3_value'
];

const FINAL_STATUS = new Set(['validation_failed', 'partial_success', 'success', 'failed']);

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (contentType.includes('text/html')) {
    throw new Error(`接口返回 HTML，可能路由未生效: ${url}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`接口返回非 JSON: ${url}; 响应: ${text.slice(0, 200)}`);
  }

  return {response, payload};
}

async function login() {
  const body = new URLSearchParams();
  body.set('username', ADMIN_USERNAME);
  body.set('password', ADMIN_PASSWORD);
  const {payload} = await requestJson(`${BASE_URL}/auth/login`, {
    method: 'POST',
    body
  });
  assert(payload.errno === 0, `登录失败: ${payload.errmsg || 'unknown'}`);
  assert(payload.data && payload.data.token, '登录成功但未返回 token');
  return payload.data.token;
}

function withToken(token, extraHeaders = {}) {
  return {
    'X-Hioshop-Token': token,
    ...extraHeaders
  };
}

async function getExpressData(token) {
  const {payload} = await requestJson(`${BASE_URL}/goods/getExpressData`, {
    method: 'GET',
    headers: withToken(token)
  });
  assert(payload.errno === 0, `获取类目/运费模板失败: ${payload.errmsg || 'unknown'}`);
  const cateList = (payload.data && payload.data.cate) || [];
  const kdList = (payload.data && payload.data.kd) || [];
  const categoryId = Number(cateList[0] && cateList[0].value) || 1005000;
  const freightTemplateId = Number(kdList[0] && kdList[0].value) || 0;
  return {categoryId, freightTemplateId};
}

async function writeWorkbook(filePath, goodsRows, skuRows) {
  const wb = new ExcelJS.Workbook();
  const goodsSheet = wb.addWorksheet('goods');
  [GOODS_HEADERS, ...goodsRows].forEach((row) => goodsSheet.addRow(row));
  const skuSheet = wb.addWorksheet('sku');
  [SKU_HEADERS, ...skuRows].forEach((row) => skuSheet.addRow(row));
  await wb.xlsx.writeFile(filePath);
}

function normalizeSheetCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result') && value.result !== undefined && value.result !== null) {
      return value.result;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'text') && value.text !== undefined && value.text !== null) {
      return value.text;
    }
    if (Array.isArray(value.richText)) {
      return value.richText.map(item => item && item.text ? item.text : '').join('');
    }
  }
  return value;
}

function sheetToObjectRows(sheet) {
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers = [];
  for (let i = 1; i <= Number(headerRow.cellCount || 0); i++) {
    headers.push(String(normalizeSheetCell(headerRow.getCell(i).value) || '').trim());
  }
  if (!headers.length) {
    return [];
  }
  const rows = [];
  for (let rowNo = 2; rowNo <= Number(sheet.rowCount || 0); rowNo++) {
    const row = sheet.getRow(rowNo);
    let hasValue = false;
    const payload = {};
    for (let colNo = 1; colNo <= headers.length; colNo++) {
      const header = headers[colNo - 1] || `col_${colNo}`;
      const rawValue = normalizeSheetCell(row.getCell(colNo).value);
      const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
      payload[header] = value;
      if (value !== '') {
        hasValue = true;
      }
    }
    if (hasValue) {
      rows.push(payload);
    }
  }
  return rows;
}

async function createImportTask(token, filePath, mode) {
  const form = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  form.append(
    'file',
    new Blob([fileBuffer], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
    path.basename(filePath)
  );
  form.append('mode', mode);

  const {payload} = await requestJson(`${BASE_URL}/goods/importTaskCreate`, {
    method: 'POST',
    headers: withToken(token),
    body: form
  });

  assert(payload.errno === 0, `创建导入任务失败: ${payload.errmsg || 'unknown'}`);
  assert(payload.data && payload.data.taskId, '导入任务创建成功但缺少 taskId');
  return Number(payload.data.taskId);
}

async function getTaskDetail(token, taskId) {
  const {payload} = await requestJson(`${BASE_URL}/goods/importTaskDetail?id=${taskId}`, {
    method: 'GET',
    headers: withToken(token)
  });
  assert(payload.errno === 0, `查询任务详情失败(taskId=${taskId}): ${payload.errmsg || 'unknown'}`);
  return payload.data;
}

function buildApiToken() {
  if (!API_TOKEN_SECRET) {
    return '';
  }
  return jwt.sign({user_id: Number(API_USER_ID)}, API_TOKEN_SECRET);
}

async function triggerProcessTask(apiToken) {
  if (!apiToken) {
    return {ok: false, detail: 'missing_api_token'};
  }
  const {payload} = await requestJson(`${API_BASE_URL}/crontab/processGoodsImportTask`, {
    method: 'GET',
    headers: {
      'X-Hioshop-Token': apiToken
    }
  });
  const errno = Number(payload && payload.errno);
  if (errno !== 0) {
    return {ok: false, detail: `errno=${errno}, errmsg=${payload.errmsg || ''}`};
  }
  return {ok: true, detail: JSON.stringify(payload.data || {})};
}

async function waitTaskDone(token, taskId, apiToken) {
  let lastStatus = 'unknown';
  let lastProcessDetail = 'not-triggered';
  for (let i = 0; i < POLL_MAX_RETRY; i++) {
    try {
      const processResult = await triggerProcessTask(apiToken);
      lastProcessDetail = processResult.detail;
    } catch (err) {
      lastProcessDetail = `process_error=${err.message || err}`;
    }
    const detail = await getTaskDetail(token, taskId);
    lastStatus = String(detail && detail.status || 'unknown');
    if (FINAL_STATUS.has(detail.status)) {
      return detail;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`任务轮询超时(taskId=${taskId}, lastStatus=${lastStatus}, processor=${lastProcessDetail})`);
}

async function downloadTemplateAndCheck(token, tempDir) {
  const response = await fetch(`${BASE_URL}/goods/importTemplate`, {
    method: 'GET',
    headers: withToken(token)
  });
  assert(response.ok, `模板下载失败, status=${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  assert(buf.length > 0, '模板下载为空');

  const templateFile = path.join(tempDir, 'template.xlsx');
  fs.writeFileSync(templateFile, buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templateFile);
  assert(!!wb.getWorksheet('goods'), '模板缺少 goods sheet');
  assert(!!wb.getWorksheet('sku'), '模板缺少 sku sheet');
}

async function downloadErrorFileAndCheck(token, taskId) {
  const response = await fetch(`${BASE_URL}/goods/importTaskErrorFile?id=${taskId}`, {
    method: 'GET',
    headers: withToken(token)
  });
  assert(response.ok, `错误文件下载失败, status=${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  assert(buf.length > 0, '错误文件为空');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.getWorksheet('errors');
  assert(sheet, '错误文件缺少 errors sheet');
  const rows = sheetToObjectRows(sheet);
  assert(Array.isArray(rows) && rows.length > 0, '错误文件缺少错误行');
  const hasDuplicateSkip = rows.some((row) => String(row.error_code || '').includes('SKIP_DUPLICATE_GOODS_SN'));
  assert(hasDuplicateSkip, '错误文件未包含重复 SKU 跳过错误码');
}

async function run() {
  const start = Date.now();
  const ts = `${Date.now()}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `hioshop-goods-import-${ts}-`));

  const results = [];
  const pushResult = (name, status, detail = '') => {
    results.push({name, status, detail});
  };

  try {
    const token = await login();
    const apiToken = buildApiToken();
    pushResult('登录', 'PASS', `user=${ADMIN_USERNAME}`);

    // 路由和表可用性探测
    const listProbe = await requestJson(`${BASE_URL}/goods/importTaskList?page=1&size=1`, {
      method: 'GET',
      headers: withToken(token)
    });
    assert(listProbe.payload.errno === 0, `导入任务列表接口不可用: ${listProbe.payload.errmsg || 'unknown'}`);
    pushResult('接口探测', 'PASS', 'importTaskList 可访问');

    await downloadTemplateAndCheck(token, tempDir);
    pushResult('模板下载校验', 'PASS');

    const {categoryId, freightTemplateId} = await getExpressData(token);
    pushResult('基础数据获取', 'PASS', `category_id=${categoryId}, freight_template_id=${freightTemplateId}`);

    const sharedGoods = {
      categoryId,
      freightTemplateId,
      listPic: `https://example.com/${ts}/list.jpg`,
      gallery: `https://example.com/${ts}/g1.jpg|https://example.com/${ts}/g2.jpg`
    };

    // 用例1：validate_only 成功
    const spuValidate = `AUTO_SPU_VALIDATE_${ts}`;
    const skuValidate = `AUTO_SKU_VALIDATE_${ts}`;
    const validateFile = path.join(tempDir, 'validate_only.xlsx');
    await writeWorkbook(
      validateFile,
      [[
        spuValidate,
        `自动化校验商品-${ts}`,
        String(sharedGoods.categoryId),
        '自动化校验简介',
        '自动化校验详情',
        '件',
        '0',
        '0',
        '100',
        '0',
        sharedGoods.listPic,
        sharedGoods.gallery,
        String(sharedGoods.freightTemplateId)
      ]],
      [[
        spuValidate,
        skuValidate,
        `自动化校验SKU-${ts}`,
        '88.00',
        '38.00',
        '30',
        '0.50',
        '颜色',
        '黑色',
        '容量',
        '128G',
        '',
        ''
      ]]
    );
    const validateTaskId = await createImportTask(token, validateFile, 'validate_only');
    const validateTask = await waitTaskDone(token, validateTaskId, apiToken);
    assert(validateTask.status === 'success', `validate_only 任务状态异常: ${validateTask.status}`);
    assert(Number(validateTask.total_sku) === 1, `validate_only total_sku 预期1，实际${validateTask.total_sku}`);
    assert(Number(validateTask.failed_sku) === 0, `validate_only failed_sku 预期0，实际${validateTask.failed_sku}`);
    pushResult('预检模式', 'PASS', `taskId=${validateTaskId}`);

    // 用例2：import 成功
    const spuImport = `AUTO_SPU_IMPORT_${ts}`;
    const skuImport = `AUTO_SKU_IMPORT_${ts}`;
    const importFile = path.join(tempDir, 'import_success.xlsx');
    await writeWorkbook(
      importFile,
      [[
        spuImport,
        `自动化导入商品-${ts}`,
        String(sharedGoods.categoryId),
        '自动化导入简介',
        '自动化导入详情',
        '件',
        '0',
        '0',
        '100',
        '0',
        sharedGoods.listPic,
        sharedGoods.gallery,
        String(sharedGoods.freightTemplateId)
      ]],
      [[
        spuImport,
        skuImport,
        `自动化导入SKU-${ts}`,
        '99.00',
        '49.00',
        '20',
        '0.60',
        '颜色',
        '白色',
        '',
        '',
        '',
        ''
      ]]
    );
    const importTaskId = await createImportTask(token, importFile, 'import');
    const importTask = await waitTaskDone(token, importTaskId, apiToken);
    assert(importTask.status === 'success', `import 任务状态异常: ${importTask.status}`);
    assert(Number(importTask.success_sku) === 1, `import success_sku 预期1，实际${importTask.success_sku}`);
    assert(Number(importTask.failed_sku) === 0, `import failed_sku 预期0，实际${importTask.failed_sku}`);
    pushResult('导入成功', 'PASS', `taskId=${importTaskId}`);

    // 用例3：重复 SKU 跳过 + 错误文件
    const spuDup = `AUTO_SPU_DUP_${ts}`;
    const dupFile = path.join(tempDir, 'import_duplicate.xlsx');
    await writeWorkbook(
      dupFile,
      [[
        spuDup,
        `自动化重复SKU商品-${ts}`,
        String(sharedGoods.categoryId),
        '自动化重复简介',
        '自动化重复详情',
        '件',
        '0',
        '0',
        '100',
        '0',
        sharedGoods.listPic,
        sharedGoods.gallery,
        String(sharedGoods.freightTemplateId)
      ]],
      [[
        spuDup,
        skuImport,
        `自动化重复SKU-${ts}`,
        '109.00',
        '59.00',
        '10',
        '0.80',
        '颜色',
        '银色',
        '',
        '',
        '',
        ''
      ]]
    );
    const dupTaskId = await createImportTask(token, dupFile, 'import');
    const dupTask = await waitTaskDone(token, dupTaskId, apiToken);
    assert(dupTask.status === 'partial_success', `重复 SKU 任务状态异常: ${dupTask.status}`);
    assert(Number(dupTask.skipped_sku) >= 1, `重复 SKU skipped_sku 预期>=1，实际${dupTask.skipped_sku}`);
    pushResult('重复SKU跳过', 'PASS', `taskId=${dupTaskId}`);

    await downloadErrorFileAndCheck(token, dupTaskId);
    pushResult('错误文件校验', 'PASS', `taskId=${dupTaskId}`);

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.log('\n=== 商品批量导入自动化测试结果 ===');
    results.forEach((item, idx) => {
      console.log(`${idx + 1}. [${item.status}] ${item.name}${item.detail ? ` - ${item.detail}` : ''}`);
    });
    console.log(`总耗时: ${elapsed}s`);
  } catch (error) {
    console.error('\n=== 商品批量导入自动化测试失败 ===');
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    try {
      fs.rmSync(tempDir, {recursive: true, force: true});
    } catch (err) {
      // ignore
    }
  }
}

run();
