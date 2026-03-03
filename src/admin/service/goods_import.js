const fs = require('fs');
const path = require('path');
const moment = require('moment');
const XLSX = require('xlsx');

const IMPORT_MODE = {
  IMPORT: 'import',
  VALIDATE_ONLY: 'validate_only'
};

const TASK_STATUS = {
  PENDING: 'pending',
  VALIDATING: 'validating',
  VALIDATION_FAILED: 'validation_failed',
  IMPORTING: 'importing',
  PARTIAL_SUCCESS: 'partial_success',
  SUCCESS: 'success',
  FAILED: 'failed'
};

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

const ERROR_CODE = {
  SHEET_MISSING: 'SHEET_MISSING',
  HEADER_MISMATCH: 'HEADER_MISMATCH',
  REQUIRED: 'REQUIRED',
  INVALID_VALUE: 'INVALID_VALUE',
  INVALID_URL: 'INVALID_URL',
  DUPLICATE_IN_FILE: 'DUPLICATE_IN_FILE',
  RELATION_NOT_FOUND: 'RELATION_NOT_FOUND',
  ROW_LIMIT_EXCEEDED: 'ROW_LIMIT_EXCEEDED',
  SKU_SPU_NOT_FOUND: 'SKU_SPU_NOT_FOUND',
  SKIP_DUPLICATE_GOODS_SN: 'SKIP_DUPLICATE_GOODS_SN',
  IMPORT_SPU_FAILED: 'IMPORT_SPU_FAILED'
};

module.exports = class extends think.Service {
  constructor(...args) {
    super(...args);
    this.maxSkuRows = 1000;
  }

  now() {
    return parseInt(Date.now() / 1000, 10);
  }

  ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, {recursive: true});
    }
  }

  getWorkDir() {
    const dir = path.join(think.ROOT_PATH, 'runtime', 'goods-import');
    this.ensureDir(dir);
    return dir;
  }

  getUploadDir() {
    const dir = path.join(this.getWorkDir(), 'uploads');
    this.ensureDir(dir);
    return dir;
  }

  getErrorDir() {
    const dir = path.join(this.getWorkDir(), 'errors');
    this.ensureDir(dir);
    return dir;
  }

  getTaskModel() {
    return this.model('goods_import_task');
  }

  getTaskErrorModel() {
    return this.model('goods_import_error');
  }

  normalizeText(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  parseNumber(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const num = Number(value);
    if (Number.isNaN(num)) {
      return null;
    }
    return num;
  }

  parseInteger(value) {
    const num = this.parseNumber(value);
    if (num === null) {
      return null;
    }
    if (!Number.isInteger(num)) {
      return null;
    }
    return num;
  }

  parseBit(value, defaultValue = 0) {
    if (value === null || value === undefined || value === '') {
      return defaultValue;
    }
    const raw = this.normalizeText(value);
    if (raw === '0' || raw === '1') {
      return Number(raw);
    }
    return null;
  }

  isHttpUrl(value) {
    const url = this.normalizeText(value);
    if (!url) {
      return false;
    }
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (err) {
      return false;
    }
  }

  buildTaskNo() {
    return `GI${moment().format('YYYYMMDDHHmmss')}${Math.floor(Math.random() * 9000 + 1000)}`;
  }

  getTemplateBuffer() {
    const wb = XLSX.utils.book_new();
    const goodsRows = [
      GOODS_HEADERS,
      [
        'SPU_DEMO_001',
        '演示商品',
        '1005000',
        '商品简介示例',
        '商品详情示例',
        '件',
        '0',
        '0',
        '100',
        '0',
        'https://example.com/list.jpg',
        'https://example.com/1.jpg|https://example.com/2.jpg',
        '15'
      ]
    ];
    const skuRows = [
      SKU_HEADERS,
      [
        'SPU_DEMO_001',
        'SKU_DEMO_001',
        '演示商品-黑色128G',
        '199.00',
        '99.00',
        '100',
        '0.5',
        '颜色',
        '黑色',
        '容量',
        '128G',
        '',
        ''
      ]
    ];

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(goodsRows), 'goods');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(skuRows), 'sku');
    return XLSX.write(wb, {bookType: 'xlsx', type: 'buffer'});
  }

  saveUploadFile(file) {
    const ext = path.extname(file.name || file.originalFilename || '').toLowerCase() || '.xlsx';
    const targetName = `${this.buildTaskNo()}${ext}`;
    const targetPath = path.join(this.getUploadDir(), targetName);
    fs.copyFileSync(file.path, targetPath);
    return targetPath;
  }

  async createTaskFromUpload(file, mode, operatorId) {
    const taskNo = this.buildTaskNo();
    const filePath = this.saveUploadFile(file);
    const now = this.now();
    const taskId = await this.getTaskModel().add({
      task_no: taskNo,
      mode,
      status: TASK_STATUS.PENDING,
      file_path: filePath,
      error_file_path: '',
      operator_id: Number(operatorId) || 0,
      total_spu: 0,
      total_sku: 0,
      success_sku: 0,
      skipped_sku: 0,
      failed_sku: 0,
      summary_json: '',
      started_at: 0,
      finished_at: 0,
      add_time: now,
      update_time: now,
      is_delete: 0
    });
    return {taskId, taskNo};
  }

  buildError(sheetName, rowNo, spuCode, goodsSn, fieldName, errorCode, errorMsg, rawValue) {
    return {
      sheet_name: sheetName,
      row_no: rowNo,
      spu_code: this.normalizeText(spuCode),
      goods_sn: this.normalizeText(goodsSn),
      field_name: fieldName || '',
      error_code: errorCode,
      error_msg: errorMsg,
      raw_value: rawValue === undefined || rawValue === null ? '' : String(rawValue)
    };
  }

  isSkipError(errorCode) {
    return errorCode === ERROR_CODE.SKIP_DUPLICATE_GOODS_SN;
  }

  readSheetRows(workbook, sheetName, expectedHeaders) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return {
        rows: [],
        errors: [this.buildError(sheetName, 0, '', '', '', ERROR_CODE.SHEET_MISSING, `缺少工作表 ${sheetName}`, '')]
      };
    }

    const matrix = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: ''});
    if (!Array.isArray(matrix) || matrix.length === 0) {
      return {
        rows: [],
        errors: [this.buildError(sheetName, 1, '', '', '', ERROR_CODE.HEADER_MISMATCH, `${sheetName} 表为空`, '')]
      };
    }

    const headerRow = (matrix[0] || []).map(item => this.normalizeText(item));
    const normalizedExpected = expectedHeaders.map(item => this.normalizeText(item));
    const mismatch = normalizedExpected.length !== headerRow.length || normalizedExpected.some((header, idx) => header !== headerRow[idx]);
    if (mismatch) {
      return {
        rows: [],
        errors: [this.buildError(sheetName, 1, '', '', '', ERROR_CODE.HEADER_MISMATCH, `${sheetName} 表头不匹配`, headerRow.join(','))]
      };
    }

    const rows = [];
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i] || [];
      const payload = {};
      let hasValue = false;
      expectedHeaders.forEach((header, idx) => {
        const value = row[idx];
        if (value !== '' && value !== null && value !== undefined) {
          hasValue = true;
        }
        payload[header] = this.normalizeText(value);
      });
      if (!hasValue) {
        continue;
      }
      payload.__rowNo = i + 1;
      rows.push(payload);
    }

    return {rows, errors: []};
  }

  splitGalleryUrls(raw) {
    return this.normalizeText(raw)
      .split('|')
      .map(item => this.normalizeText(item))
      .filter(Boolean);
  }

  buildSpecValue(row) {
    const items = [];
    const pairs = [
      ['spec1_name', 'spec1_value'],
      ['spec2_name', 'spec2_value'],
      ['spec3_name', 'spec3_value']
    ];
    pairs.forEach(([nameKey, valueKey]) => {
      const n = this.normalizeText(row[nameKey]);
      const v = this.normalizeText(row[valueKey]);
      if (n && v) {
        items.push(`${n}:${v}`);
      }
    });
    return items.join('|');
  }

  async validateWorkbook(filePath) {
    let workbook;
    try {
      workbook = XLSX.readFile(filePath, {cellDates: false, raw: false});
    } catch (err) {
      return {
        goodsRows: [],
        skuRows: [],
        errors: [this.buildError('file', 0, '', '', '', ERROR_CODE.INVALID_VALUE, '文件解析失败，请确认是有效的 xlsx 文件', err.message || '')],
        existingSkuSet: new Set()
      };
    }

    const goodsResult = this.readSheetRows(workbook, 'goods', GOODS_HEADERS);
    const skuResult = this.readSheetRows(workbook, 'sku', SKU_HEADERS);
    const errors = [...goodsResult.errors, ...skuResult.errors];

    if (skuResult.rows.length > this.maxSkuRows) {
      errors.push(this.buildError('sku', 0, '', '', '', ERROR_CODE.ROW_LIMIT_EXCEEDED, `SKU 行数超过限制 ${this.maxSkuRows}`, skuResult.rows.length));
    }

    const goodsRows = [];
    const skuRows = [];

    const goodsSpuMap = new Map();
    const goodsCategoryIds = new Set();
    const goodsFreightIds = new Set();

    for (const row of goodsResult.rows) {
      const rowNo = row.__rowNo;
      const spuCode = this.normalizeText(row.spu_code);
      if (!spuCode) {
        errors.push(this.buildError('goods', rowNo, '', '', 'spu_code', ERROR_CODE.REQUIRED, 'spu_code 必填', row.spu_code));
      } else if (goodsSpuMap.has(spuCode)) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'spu_code', ERROR_CODE.DUPLICATE_IN_FILE, 'spu_code 在 goods 表内重复', row.spu_code));
      }

      const name = this.normalizeText(row.name);
      if (!name) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'name', ERROR_CODE.REQUIRED, 'name 必填', row.name));
      }

      const categoryId = this.parseInteger(row.category_id);
      if (categoryId === null || categoryId <= 0) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'category_id', ERROR_CODE.INVALID_VALUE, 'category_id 必须为正整数', row.category_id));
      } else {
        goodsCategoryIds.add(categoryId);
      }

      const freightTemplateId = this.parseInteger(row.freight_template_id);
      if (freightTemplateId === null || freightTemplateId < 0) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'freight_template_id', ERROR_CODE.INVALID_VALUE, 'freight_template_id 必须为非负整数', row.freight_template_id));
      } else {
        goodsFreightIds.add(freightTemplateId);
      }

      const listPicUrl = this.normalizeText(row.list_pic_url);
      if (!listPicUrl) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'list_pic_url', ERROR_CODE.REQUIRED, 'list_pic_url 必填', row.list_pic_url));
      } else if (!this.isHttpUrl(listPicUrl)) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'list_pic_url', ERROR_CODE.INVALID_URL, 'list_pic_url 需为 http/https URL', row.list_pic_url));
      }

      const galleryUrls = this.splitGalleryUrls(row.gallery_urls);
      if (!galleryUrls.length) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'gallery_urls', ERROR_CODE.REQUIRED, 'gallery_urls 必填，使用 | 分隔多个 URL', row.gallery_urls));
      } else {
        galleryUrls.forEach((url) => {
          if (!this.isHttpUrl(url)) {
            errors.push(this.buildError('goods', rowNo, spuCode, '', 'gallery_urls', ERROR_CODE.INVALID_URL, 'gallery_urls 存在非法 URL', url));
          }
        });
      }

      const isNew = this.parseBit(row.is_new, 0);
      if (isNew === null) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'is_new', ERROR_CODE.INVALID_VALUE, 'is_new 仅支持 0/1', row.is_new));
      }

      const isOnSale = this.parseBit(row.is_on_sale, 0);
      if (isOnSale === null) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'is_on_sale', ERROR_CODE.INVALID_VALUE, 'is_on_sale 仅支持 0/1', row.is_on_sale));
      }

      const sortOrder = this.parseInteger(row.sort_order === '' ? 100 : row.sort_order);
      if (sortOrder === null || sortOrder < 0) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'sort_order', ERROR_CODE.INVALID_VALUE, 'sort_order 必须为非负整数', row.sort_order));
      }

      const sellVolume = this.parseInteger(row.sell_volume === '' ? 0 : row.sell_volume);
      if (sellVolume === null || sellVolume < 0) {
        errors.push(this.buildError('goods', rowNo, spuCode, '', 'sell_volume', ERROR_CODE.INVALID_VALUE, 'sell_volume 必须为非负整数', row.sell_volume));
      }

      const normalized = {
        __rowNo: rowNo,
        spu_code: spuCode,
        name,
        category_id: categoryId,
        goods_brief: this.normalizeText(row.goods_brief),
        goods_desc: this.normalizeText(row.goods_desc),
        goods_unit: this.normalizeText(row.goods_unit) || '件',
        is_new: isNew === null ? 0 : isNew,
        is_on_sale: isOnSale === null ? 0 : isOnSale,
        sort_order: sortOrder === null ? 100 : sortOrder,
        sell_volume: sellVolume === null ? 0 : sellVolume,
        list_pic_url: listPicUrl,
        gallery_urls: galleryUrls,
        freight_template_id: freightTemplateId === null ? 0 : freightTemplateId
      };

      goodsRows.push(normalized);
      if (spuCode && !goodsSpuMap.has(spuCode)) {
        goodsSpuMap.set(spuCode, normalized);
      }
    }

    const skuSnSet = new Set();
    for (const row of skuResult.rows) {
      const rowNo = row.__rowNo;
      const spuCode = this.normalizeText(row.spu_code);
      if (!spuCode) {
        errors.push(this.buildError('sku', rowNo, '', '', 'spu_code', ERROR_CODE.REQUIRED, 'spu_code 必填', row.spu_code));
      } else if (!goodsSpuMap.has(spuCode)) {
        errors.push(this.buildError('sku', rowNo, spuCode, '', 'spu_code', ERROR_CODE.SKU_SPU_NOT_FOUND, 'sku.spu_code 在 goods 表中不存在', row.spu_code));
      }

      const goodsSn = this.normalizeText(row.goods_sn);
      if (!goodsSn) {
        errors.push(this.buildError('sku', rowNo, spuCode, '', 'goods_sn', ERROR_CODE.REQUIRED, 'goods_sn 必填', row.goods_sn));
      } else if (skuSnSet.has(goodsSn)) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'goods_sn', ERROR_CODE.DUPLICATE_IN_FILE, 'goods_sn 在文件中重复', row.goods_sn));
      } else {
        skuSnSet.add(goodsSn);
      }

      const retailPrice = this.parseNumber(row.retail_price);
      if (retailPrice === null || retailPrice < 0) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'retail_price', ERROR_CODE.INVALID_VALUE, 'retail_price 必须为大于等于 0 的数字', row.retail_price));
      }

      const cost = this.parseNumber(row.cost);
      if (cost === null || cost < 0) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'cost', ERROR_CODE.INVALID_VALUE, 'cost 必须为大于等于 0 的数字', row.cost));
      }

      const goodsNumber = this.parseInteger(row.goods_number);
      if (goodsNumber === null || goodsNumber < 0) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'goods_number', ERROR_CODE.INVALID_VALUE, 'goods_number 必须为非负整数', row.goods_number));
      }

      const goodsWeight = this.parseNumber(row.goods_weight);
      if (goodsWeight === null || goodsWeight < 0) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'goods_weight', ERROR_CODE.INVALID_VALUE, 'goods_weight 必须为大于等于 0 的数字', row.goods_weight));
      }

      const spec1Name = this.normalizeText(row.spec1_name);
      const spec1Value = this.normalizeText(row.spec1_value);
      if (!spec1Name) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'spec1_name', ERROR_CODE.REQUIRED, 'spec1_name 必填', row.spec1_name));
      }
      if (!spec1Value) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'spec1_value', ERROR_CODE.REQUIRED, 'spec1_value 必填', row.spec1_value));
      }

      const spec2Name = this.normalizeText(row.spec2_name);
      const spec2Value = this.normalizeText(row.spec2_value);
      if ((spec2Name && !spec2Value) || (!spec2Name && spec2Value)) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'spec2_name/spec2_value', ERROR_CODE.INVALID_VALUE, 'spec2_name 与 spec2_value 需要成对填写', `${row.spec2_name}|${row.spec2_value}`));
      }

      const spec3Name = this.normalizeText(row.spec3_name);
      const spec3Value = this.normalizeText(row.spec3_value);
      if ((spec3Name && !spec3Value) || (!spec3Name && spec3Value)) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'spec3_name/spec3_value', ERROR_CODE.INVALID_VALUE, 'spec3_name 与 spec3_value 需要成对填写', `${row.spec3_name}|${row.spec3_value}`));
      }

      const normalized = {
        __rowNo: rowNo,
        spu_code: spuCode,
        goods_sn: goodsSn,
        goods_name: this.normalizeText(row.goods_name),
        retail_price: retailPrice === null ? 0 : retailPrice,
        cost: cost === null ? 0 : cost,
        goods_number: goodsNumber === null ? 0 : goodsNumber,
        goods_weight: goodsWeight === null ? 0 : goodsWeight,
        spec1_name: spec1Name,
        spec1_value: spec1Value,
        spec2_name: spec2Name,
        spec2_value: spec2Value,
        spec3_name: spec3Name,
        spec3_value: spec3Value
      };
      normalized.spec_value = this.buildSpecValue(normalized);
      if (normalized.spec_value.length > 50) {
        errors.push(this.buildError('sku', rowNo, spuCode, goodsSn, 'spec1/spec2/spec3', ERROR_CODE.INVALID_VALUE, '组合规格值长度不能超过 50', normalized.spec_value));
      }
      skuRows.push(normalized);
    }

    const skuCountBySpu = skuRows.reduce((acc, row) => {
      const key = row.spu_code;
      if (!key) {
        return acc;
      }
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    goodsRows.forEach((row) => {
      if (row.spu_code && !skuCountBySpu[row.spu_code]) {
        errors.push(this.buildError('goods', row.__rowNo, row.spu_code, '', 'spu_code', ERROR_CODE.REQUIRED, '当前 spu_code 在 sku 表中无对应行', row.spu_code));
      }
    });

    if (goodsCategoryIds.size) {
      const categoryList = await this.model('category').where({id: ['IN', [...goodsCategoryIds]]}).field('id').select();
      const validCategorySet = new Set(categoryList.map(item => Number(item.id)));
      goodsRows.forEach((row) => {
        if (row.category_id > 0 && !validCategorySet.has(Number(row.category_id))) {
          errors.push(this.buildError('goods', row.__rowNo, row.spu_code, '', 'category_id', ERROR_CODE.RELATION_NOT_FOUND, 'category_id 对应类目不存在', row.category_id));
        }
      });
    }

    if (goodsFreightIds.size) {
      const freightList = await this.model('freight_template').where({
        id: ['IN', [...goodsFreightIds]],
        is_delete: 0
      }).field('id').select();
      const validFreightSet = new Set(freightList.map(item => Number(item.id)));
      goodsRows.forEach((row) => {
        if (row.freight_template_id > 0 && !validFreightSet.has(Number(row.freight_template_id))) {
          errors.push(this.buildError('goods', row.__rowNo, row.spu_code, '', 'freight_template_id', ERROR_CODE.RELATION_NOT_FOUND, 'freight_template_id 不存在或已删除', row.freight_template_id));
        }
      });
    }

    const skuList = skuRows.map(item => item.goods_sn).filter(Boolean);
    const existingSkuSet = new Set();
    if (skuList.length) {
      const existing = await this.model('product').where({
        goods_sn: ['IN', skuList],
        is_delete: 0
      }).field('goods_sn').select();
      existing.forEach((item) => {
        existingSkuSet.add(this.normalizeText(item.goods_sn));
      });
      skuRows.forEach((row) => {
        if (row.goods_sn && existingSkuSet.has(row.goods_sn)) {
          errors.push(this.buildError('sku', row.__rowNo, row.spu_code, row.goods_sn, 'goods_sn', ERROR_CODE.SKIP_DUPLICATE_GOODS_SN, 'goods_sn 已存在，当前行将跳过导入', row.goods_sn));
        }
      });
    }

    return {
      goodsRows,
      skuRows,
      errors,
      existingSkuSet
    };
  }

  formatPriceRange(values) {
    if (!values.length) {
      return {
        display: '0.00',
        min: 0
      };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      return {
        display: min.toFixed(2),
        min
      };
    }
    return {
      display: `${min.toFixed(2)}~${max.toFixed(2)}`,
      min
    };
  }

  async getSpecificationId() {
    const defaultSpec = await this.model('specification').where({name: '规格'}).find();
    if (!think.isEmpty(defaultSpec) && Number(defaultSpec.id) > 0) {
      return Number(defaultSpec.id);
    }
    const first = await this.model('specification').order('id ASC').find();
    if (!think.isEmpty(first) && Number(first.id) > 0) {
      return Number(first.id);
    }
    return 1;
  }

  async importOneSpu(transactionModel, goodsRow, skuRows, specificationId) {
    const bindTransactionModel = (name) => {
      const model = transactionModel.model(name);
      // Use the same DB instance/connection within transaction scope.
      model.db(transactionModel.db());
      return model;
    };
    const goodsModel = bindTransactionModel('goods');
    const galleryModel = bindTransactionModel('goods_gallery');
    const specModel = bindTransactionModel('goods_specification');
    const productModel = bindTransactionModel('product');

    const goodsInfo = {
      category_id: goodsRow.category_id,
      is_on_sale: goodsRow.is_on_sale,
      name: goodsRow.name,
      goods_number: 0,
      sell_volume: goodsRow.sell_volume,
      keywords: '',
      retail_price: '0.00',
      min_retail_price: 0,
      cost_price: '0.00',
      min_cost_price: 0,
      goods_brief: goodsRow.goods_brief,
      goods_desc: goodsRow.goods_desc,
      sort_order: goodsRow.sort_order,
      is_index: 0,
      is_new: goodsRow.is_new,
      goods_unit: goodsRow.goods_unit || '件',
      https_pic_url: goodsRow.list_pic_url,
      list_pic_url: goodsRow.list_pic_url,
      freight_template_id: goodsRow.freight_template_id,
      freight_type: 0,
      is_delete: 0,
      has_gallery: goodsRow.gallery_urls.length > 0 ? 1 : 0,
      has_done: 0
    };

    const goodsId = await goodsModel.add(goodsInfo);

    if (goodsRow.gallery_urls.length > 0) {
      const galleryData = goodsRow.gallery_urls.map((url, idx) => ({
        goods_id: goodsId,
        img_url: url,
        img_desc: '',
        sort_order: idx,
        is_delete: 0
      }));
      await galleryModel.addMany(galleryData);
    }

    const retailPrices = [];
    const costs = [];
    let stockSum = 0;

    for (const skuRow of skuRows) {
      const specId = await specModel.add({
        goods_id: goodsId,
        specification_id: specificationId,
        value: skuRow.spec_value,
        pic_url: '',
        is_delete: 0
      });

      await productModel.add({
        goods_id: goodsId,
        goods_specification_ids: String(specId),
        goods_sn: skuRow.goods_sn,
        goods_number: skuRow.goods_number,
        retail_price: skuRow.retail_price,
        cost: skuRow.cost,
        goods_weight: skuRow.goods_weight,
        has_change: 0,
        goods_name: skuRow.goods_name || goodsRow.name,
        is_on_sale: goodsRow.is_on_sale,
        is_delete: 0
      });

      stockSum += Number(skuRow.goods_number || 0);
      retailPrices.push(Number(skuRow.retail_price || 0));
      costs.push(Number(skuRow.cost || 0));
    }

    const retailRange = this.formatPriceRange(retailPrices);
    const costRange = this.formatPriceRange(costs);

    await goodsModel.where({id: goodsId}).update({
      goods_number: stockSum,
      retail_price: retailRange.display,
      min_retail_price: retailRange.min,
      cost_price: costRange.display,
      min_cost_price: costRange.min
    });

    return {
      goods_id: goodsId,
      sku_count: skuRows.length
    };
  }

  groupSkuBySpu(skuRows) {
    const map = new Map();
    skuRows.forEach((row) => {
      if (!map.has(row.spu_code)) {
        map.set(row.spu_code, []);
      }
      map.get(row.spu_code).push(row);
    });
    return map;
  }

  getSummaryStats(errors, totalSku) {
    const skipped = errors.filter(item => this.isSkipError(item.error_code)).length;
    const failed = errors.length - skipped;
    return {
      skipped,
      failed,
      totalSku
    };
  }

  async saveTaskErrors(taskId, errors) {
    const model = this.getTaskErrorModel();
    await model.where({task_id: taskId}).delete();
    if (!errors.length) {
      return;
    }
    const now = this.now();
    const rows = errors.map(item => ({
      task_id: taskId,
      sheet_name: item.sheet_name,
      row_no: item.row_no,
      spu_code: item.spu_code || '',
      goods_sn: item.goods_sn || '',
      field_name: item.field_name || '',
      error_code: item.error_code,
      error_msg: item.error_msg,
      raw_row_json: item.raw_value || '',
      add_time: now
    }));
    await model.addMany(rows);
  }

  createErrorWorkbookBuffer(errors) {
    const wb = XLSX.utils.book_new();
    const rows = [
      ['sheet_name', 'row_no', 'spu_code', 'goods_sn', 'field_name', 'error_code', 'error_msg', 'raw_value']
    ];
    errors.forEach((item) => {
      rows.push([
        item.sheet_name,
        item.row_no,
        item.spu_code || '',
        item.goods_sn || '',
        item.field_name || '',
        item.error_code,
        item.error_msg,
        item.raw_value || ''
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'errors');
    return XLSX.write(wb, {bookType: 'xlsx', type: 'buffer'});
  }

  async saveErrorFile(taskNo, errors) {
    if (!errors.length) {
      return '';
    }
    const filename = `${taskNo}_errors.xlsx`;
    const filePath = path.join(this.getErrorDir(), filename);
    fs.writeFileSync(filePath, this.createErrorWorkbookBuffer(errors));
    return filePath;
  }

  buildTaskSummary(payload) {
    return JSON.stringify(payload);
  }

  async updateTask(taskId, payload) {
    payload.update_time = this.now();
    await this.getTaskModel().where({id: taskId}).update(payload);
  }

  async executeTask(taskId) {
    const taskModel = this.getTaskModel();
    const task = await taskModel.where({id: taskId, is_delete: 0}).find();
    if (think.isEmpty(task)) {
      return {processed: false, reason: 'task_not_found'};
    }

    const mode = task.mode === IMPORT_MODE.VALIDATE_ONLY ? IMPORT_MODE.VALIDATE_ONLY : IMPORT_MODE.IMPORT;
    const validation = await this.validateWorkbook(task.file_path);
    const summaryStats = this.getSummaryStats(validation.errors, validation.skuRows.length);

    const commonSummary = {
      total_spu: validation.goodsRows.length,
      total_sku: validation.skuRows.length,
      skipped_sku: summaryStats.skipped,
      failed_sku: summaryStats.failed
    };

    await this.saveTaskErrors(taskId, validation.errors);
    const errorFilePath = await this.saveErrorFile(task.task_no, validation.errors);

    if (mode === IMPORT_MODE.VALIDATE_ONLY) {
      const status = summaryStats.failed > 0 ? TASK_STATUS.VALIDATION_FAILED : TASK_STATUS.SUCCESS;
      await this.updateTask(taskId, {
        status,
        error_file_path: errorFilePath,
        total_spu: commonSummary.total_spu,
        total_sku: commonSummary.total_sku,
        success_sku: 0,
        skipped_sku: commonSummary.skipped_sku,
        failed_sku: commonSummary.failed_sku,
        summary_json: this.buildTaskSummary({
          mode,
          validation_only: true,
          ...commonSummary
        }),
        finished_at: this.now()
      });
      return {processed: true, task_id: taskId, status};
    }

    if (summaryStats.failed > 0) {
      await this.updateTask(taskId, {
        status: TASK_STATUS.VALIDATION_FAILED,
        error_file_path: errorFilePath,
        total_spu: commonSummary.total_spu,
        total_sku: commonSummary.total_sku,
        success_sku: 0,
        skipped_sku: commonSummary.skipped_sku,
        failed_sku: commonSummary.failed_sku,
        summary_json: this.buildTaskSummary({
          mode,
          validation_only: false,
          ...commonSummary
        }),
        finished_at: this.now()
      });
      return {processed: true, task_id: taskId, status: TASK_STATUS.VALIDATION_FAILED};
    }

    await this.updateTask(taskId, {
      status: TASK_STATUS.IMPORTING,
      error_file_path: errorFilePath,
      total_spu: commonSummary.total_spu,
      total_sku: commonSummary.total_sku,
      skipped_sku: commonSummary.skipped_sku,
      failed_sku: 0,
      success_sku: 0
    });

    const skipSkuSet = new Set(
      validation.errors
        .filter(item => item.error_code === ERROR_CODE.SKIP_DUPLICATE_GOODS_SN)
        .map(item => item.goods_sn)
    );

    const importableSkuRows = validation.skuRows.filter(item => !skipSkuSet.has(item.goods_sn));
    const skuGroupMap = this.groupSkuBySpu(importableSkuRows);
    const goodsMap = new Map(validation.goodsRows.map(item => [item.spu_code, item]));

    const specificationId = await this.getSpecificationId();
    const importErrors = [];
    let successSku = 0;

    for (const [spuCode, skuRows] of skuGroupMap.entries()) {
      const goodsRow = goodsMap.get(spuCode);
      if (!goodsRow) {
        skuRows.forEach((row) => {
          importErrors.push(this.buildError('sku', row.__rowNo, row.spu_code, row.goods_sn, 'spu_code', ERROR_CODE.SKU_SPU_NOT_FOUND, '未找到对应 goods 行', row.spu_code));
        });
        continue;
      }
      try {
        const transactionModel = this.model('goods');
        await transactionModel.transaction(async () => {
          await this.importOneSpu(transactionModel, goodsRow, skuRows, specificationId);
        });
        successSku += skuRows.length;
      } catch (err) {
        skuRows.forEach((row) => {
          importErrors.push(this.buildError('sku', row.__rowNo, row.spu_code, row.goods_sn, 'spu_code', ERROR_CODE.IMPORT_SPU_FAILED, `SPU 导入失败: ${err.message || 'unknown'}`, row.spu_code));
        });
      }
    }

    const allErrors = validation.errors.concat(importErrors);
    const failedSku = importErrors.length;
    const skippedSku = commonSummary.skipped_sku;

    await this.saveTaskErrors(taskId, allErrors);
    const finalErrorPath = await this.saveErrorFile(task.task_no, allErrors);

    let finalStatus = TASK_STATUS.SUCCESS;
    if (failedSku > 0 && successSku === 0) {
      finalStatus = TASK_STATUS.FAILED;
    } else if (failedSku > 0 || skippedSku > 0) {
      finalStatus = TASK_STATUS.PARTIAL_SUCCESS;
    }

    await this.updateTask(taskId, {
      status: finalStatus,
      error_file_path: finalErrorPath,
      total_spu: commonSummary.total_spu,
      total_sku: commonSummary.total_sku,
      success_sku: successSku,
      skipped_sku: skippedSku,
      failed_sku: failedSku,
      summary_json: this.buildTaskSummary({
        mode,
        total_spu: commonSummary.total_spu,
        total_sku: commonSummary.total_sku,
        success_sku: successSku,
        skipped_sku: skippedSku,
        failed_sku: failedSku
      }),
      finished_at: this.now()
    });

    return {processed: true, task_id: taskId, status: finalStatus};
  }

  async processNextPendingTask() {
    const taskModel = this.getTaskModel();
    const task = await taskModel.where({
      status: TASK_STATUS.PENDING,
      is_delete: 0
    }).order('id ASC').find();

    if (think.isEmpty(task)) {
      return {processed: false, reason: 'empty'};
    }

    const now = this.now();
    const affectedRows = await taskModel.where({
      id: task.id,
      status: TASK_STATUS.PENDING
    }).update({
      status: TASK_STATUS.VALIDATING,
      started_at: now,
      update_time: now
    });

    if (!affectedRows) {
      return {processed: false, reason: 'locked'};
    }

    try {
      return await this.executeTask(task.id);
    } catch (err) {
      await this.updateTask(task.id, {
        status: TASK_STATUS.FAILED,
        finished_at: this.now(),
        summary_json: this.buildTaskSummary({
          mode: task.mode,
          fatal: true,
          message: err.message || 'unknown'
        })
      });
      return {processed: true, task_id: task.id, status: TASK_STATUS.FAILED, message: err.message || 'unknown'};
    }
  }
};
