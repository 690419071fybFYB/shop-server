const Base = require('./base.js');
const moment = require('moment');
const fs = require('fs');
const path = require("path");
const htmlSanitizer = require('../../common/utils/sanitize_html');
// const qiniu = require('qiniu'); // 已替换为腾讯云COS

const IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const IMPORT_ACCEPTED_MIME = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
];
const GOODS_SCHEMA_CACHE_MS = 60000;
const goodsSchemaState = {
    checkedAt: 0,
    hasAddTime: false
};

function readFileHeader(filePath, length = 8) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, 0);
        fs.closeSync(fd);
        return buffer;
    } catch (error) {
        return null;
    }
}

function isZipFileHeader(buffer) {
    if (!buffer || buffer.length < 4) {
        return false;
    }
    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];
    if (b0 !== 0x50 || b1 !== 0x4b) {
        return false;
    }
    // ZIP local header / empty archive / split archive signature.
    return (b2 === 0x03 && b3 === 0x04) || (b2 === 0x05 && b3 === 0x06) || (b2 === 0x07 && b3 === 0x08);
}

module.exports = class extends Base {
    async hasGoodsAddTimeColumn() {
        const nowMs = Date.now();
        if ((nowMs - goodsSchemaState.checkedAt) < GOODS_SCHEMA_CACHE_MS) {
            return goodsSchemaState.hasAddTime;
        }
        try {
            const rows = await this.model('goods').query("SHOW COLUMNS FROM `hiolabs_goods` LIKE 'add_time'");
            goodsSchemaState.hasAddTime = Array.isArray(rows) && rows.length > 0;
        } catch (err) {
            goodsSchemaState.hasAddTime = false;
        }
        goodsSchemaState.checkedAt = nowMs;
        return goodsSchemaState.hasAddTime;
    }

    normalizeNumber(value, fallback = 0) {
        const num = Number(value);
        return Number.isNaN(num) ? fallback : num;
    }

    parseOptionalPrice(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        const num = Number(value);
        if (Number.isNaN(num) || num < 0) {
            return null;
        }
        return num;
    }

    async normalizePickerSort(sortBy, sortOrder) {
        const hasAddTime = await this.hasGoodsAddTimeColumn();
        const map = {
            sell_volume: 'g.sell_volume',
            min_retail_price: 'g.min_retail_price',
            goods_number: 'g.goods_number',
            // Prefer true create-time ordering when available.
            add_time: hasAddTime ? 'g.add_time' : 'g.id'
        };
        const by = String(sortBy || 'add_time').trim();
        const column = map[by] || map.add_time;
        const order = String(sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        return {
            column,
            order
        };
    }

    parseOptionalOnSale(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }
        const text = String(value).toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(text)) return 1;
        if (['0', 'false', 'no', 'off'].includes(text)) return 0;
        return null;
    }

    escapeLike(value) {
        return String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/%/g, '\\%')
            .replace(/_/g, '\\_')
            .replace(/'/g, "''");
    }

    async pickerListAction() {
        const page = Math.max(1, parseInt(this.get('page') || 1, 10));
        const size = Math.min(100, Math.max(1, parseInt(this.get('size') || 10, 10)));
        const offset = (page - 1) * size;
        const keyword = String(this.get('keyword') || '').trim();
        const categoryId = parseInt(this.get('categoryId') || 0, 10);
        const minPrice = this.parseOptionalPrice(this.get('minPrice'));
        const maxPrice = this.parseOptionalPrice(this.get('maxPrice'));
        const isOnSale = this.parseOptionalOnSale(this.get('isOnSale'));
        const {column: sortColumn, order: sortOrder} = await this.normalizePickerSort(this.get('sortBy'), this.get('sortOrder'));

        const where = ['g.is_delete = 0'];
        if (keyword) {
            where.push(`g.name LIKE '%${this.escapeLike(keyword)}%' ESCAPE '\\\\'`);
        }

        if (categoryId > 0) {
            const categoryRows = await this.model('category').where({
                id: ['=', categoryId]
            }).select();
            if (categoryRows.length > 0) {
                const childRows = await this.model('category').where({
                    parent_id: categoryId
                }).select();
                const ids = [categoryId].concat(childRows.map(item => Number(item.id || 0)).filter(id => id > 0));
                where.push(`g.category_id IN (${Array.from(new Set(ids)).join(',')})`);
            } else {
                where.push('1=0');
            }
        }
        if (minPrice !== null) {
            where.push(`g.min_retail_price >= ${Number(minPrice)}`);
        }
        if (maxPrice !== null) {
            where.push(`g.min_retail_price <= ${Number(maxPrice)}`);
        }
        if (isOnSale !== null) {
            where.push(`g.is_on_sale = ${isOnSale}`);
        }

        const whereSql = where.join(' AND ');
        const countSql = `SELECT COUNT(1) AS total FROM hiolabs_goods g WHERE ${whereSql}`;
        const listSql = `
            SELECT
                g.id,
                g.name,
                g.list_pic_url,
                g.category_id,
                c.name AS category_name,
                g.min_retail_price,
                g.goods_number,
                g.sell_volume,
                g.is_on_sale,
                g.id AS add_time
            FROM hiolabs_goods g
            LEFT JOIN hiolabs_category c ON g.category_id = c.id
            WHERE ${whereSql}
            ORDER BY ${sortColumn} ${sortOrder}, g.id DESC
            LIMIT ${offset}, ${size}
        `;
        const [countRows, listRows] = await Promise.all([
            this.model('goods').query(countSql),
            this.model('goods').query(listSql)
        ]);
        const total = Number((countRows[0] && countRows[0].total) || 0);
        return this.success({
            count: total,
            currentPage: page,
            totalPages: Math.ceil(total / size),
            data: listRows || []
        });
    }

    async pickerSkuAction() {
        const goodsId = parseInt(this.get('goodsId') || 0, 10);
        if (goodsId <= 0) {
            return this.fail(400, 'goodsId 参数不正确');
        }
        const sql = `
            SELECT
                p.id AS product_id,
                p.goods_id,
                p.goods_sn,
                COALESCE(g.name, p.goods_name, '') AS goods_name,
                p.retail_price,
                p.goods_number,
                p.is_on_sale,
                COALESCE(gs.value, '') AS spec_value
            FROM hiolabs_product p
            LEFT JOIN hiolabs_goods g ON p.goods_id = g.id
            LEFT JOIN hiolabs_goods_specification gs ON p.goods_specification_ids = gs.id AND gs.is_delete = 0
            WHERE p.goods_id = ${Number(goodsId)}
              AND p.is_delete = 0
            ORDER BY p.id ASC
        `;
        const rows = await this.model('product').query(sql);
        return this.success(rows || []);
    }

    /**
     * index action
     * @return {Promise} []
     */
    async indexAction() {
        const page = this.get('page') || 1;
        const size = this.get('size');
        const name = this.get('name') || '';
        const model = this.model('goods');
        const data = await model.where({
            name: ['like', `%${name}%`],
            is_delete: 0
        }).order(['sort_order asc']).page(page, size).countSelect();
        // let newData = data;
        for (const item of data.data) {
            const info = await this.model('category').where({
                id: item.category_id
            }).find();
            item.category_name = info.name;
            if (item.is_on_sale == 1) {
                item.is_on_sale = true;
            } else {
                item.is_on_sale = false;
            }
            if (item.is_index == 1) {
                item.is_index = true;
            } else {
                item.is_index = false;
            }
            let product = await this.model('product').where({
                goods_id: item.id,
                is_delete: 0
            }).select();
            for (const ele of product) {
                let spec = await this.model('goods_specification').where({
                    id: ele.goods_specification_ids,
                    is_delete: 0
                }).find();
                ele.value = spec.value;
                ele.is_on_sale = ele.is_on_sale ? "1" : "0";
            }
            item.product = product;
        }
        return this.success(data);
    }
    async pickerAction() {
        const page = Math.max(Number(this.get('page') || 1), 1);
        const rawSize = Number(this.get('size') || 10);
        const size = Math.min(Math.max(rawSize || 10, 1), 50);
        const keyword = String(this.get('keyword') || '').trim();
        const parentCategoryId = Number(this.get('parentCategoryId') || 0);
        const categoryId = Number(this.get('categoryId') || 0);
        const isOnSale = this.get('isOnSale');
        const sortByRaw = String(this.get('sortBy') || 'id').trim();
        const sortOrderRaw = String(this.get('sortOrder') || 'desc').trim().toLowerCase();

        const sortWhitelist = new Set(['id', 'retail_price', 'sell_volume', 'goods_number']);
        const sortBy = sortWhitelist.has(sortByRaw) ? sortByRaw : 'id';
        const sortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';

        const where = {
            is_delete: 0
        };
        if (keyword) {
            where.name = ['like', `%${keyword}%`];
        }
        if (categoryId > 0) {
            where.category_id = categoryId;
        } else if (parentCategoryId > 0) {
            const children = await this.model('category').where({
                parent_id: parentCategoryId
            }).field('id').select();
            const childIds = children.map(item => Number(item.id)).filter(id => id > 0);
            if (childIds.length > 0) {
                where.category_id = ['IN', childIds];
            } else {
                where.category_id = -1;
            }
        }
        if (isOnSale !== undefined && isOnSale !== null && `${isOnSale}` !== '') {
            where.is_on_sale = Number(isOnSale) === 1 ? 1 : 0;
        }

        const fields = 'id,name,list_pic_url,category_id,retail_price,goods_number,is_on_sale,sell_volume';
        const data = await this.model('goods')
            .where(where)
            .field(fields)
            .order(`${sortBy} ${sortOrder}`)
            .page(page, size)
            .countSelect();

        const categoryIds = Array.from(new Set((data.data || []).map(item => Number(item.category_id)).filter(id => id > 0)));
        let categoryMap = {};
        if (categoryIds.length > 0) {
            const categoryRows = await this.model('category').where({
                id: ['IN', categoryIds]
            }).field('id,name').select();
            categoryMap = categoryRows.reduce((acc, row) => {
                acc[Number(row.id)] = row.name || '';
                return acc;
            }, {});
        }

        data.data = (data.data || []).map((item) => ({
            ...item,
            category_name: categoryMap[Number(item.category_id)] || ''
        }));
        return this.success(data);
    }
    async pickerSelectedAction() {
        const idsRaw = String(this.get('ids') || '').trim();
        if (!idsRaw) {
            return this.success([]);
        }
        const ids = Array.from(new Set(idsRaw
            .split(',')
            .map((id) => Number(String(id).trim()))
            .filter((id) => id > 0)
        ));
        if (!ids.length) {
            return this.success([]);
        }

        const fields = 'id,name,list_pic_url,category_id,retail_price,goods_number,is_on_sale,sell_volume';
        const rows = await this.model('goods')
            .where({
                id: ['IN', ids],
                is_delete: 0
            })
            .field(fields)
            .select();

        const categoryIds = Array.from(new Set(rows.map(item => Number(item.category_id)).filter(id => id > 0)));
        let categoryMap = {};
        if (categoryIds.length > 0) {
            const categoryRows = await this.model('category').where({
                id: ['IN', categoryIds]
            }).field('id,name').select();
            categoryMap = categoryRows.reduce((acc, row) => {
                acc[Number(row.id)] = row.name || '';
                return acc;
            }, {});
        }

        const orderMap = ids.reduce((acc, id, index) => {
            acc[id] = index;
            return acc;
        }, {});
        const result = rows.map((item) => ({
            ...item,
            category_name: categoryMap[Number(item.category_id)] || ''
        })).sort((a, b) => {
            const indexA = orderMap[Number(a.id)];
            const indexB = orderMap[Number(b.id)];
            return Number(indexA) - Number(indexB);
        });
        return this.success(result);
    }
    async getExpressDataAction() {
        let kd = [];
        let cate = [];
        const kdData = await this.model('freight_template').where({
            is_delete: 0
        }).select();
        for (const item of kdData) {
            kd.push({
                value: item.id,
                label: item.name
            })
        }
        const cateData = await this.model('category').where({
            parent_id: 0
        }).select();
        for (const item of cateData) {
            cate.push({
                value: item.id,
                label: item.name
            })
        }
        let infoData = {
            kd: kd,
            cate: cate
        };
        return this.success(infoData);
    }
    async copygoodsAction() {
        const goodsId = this.post('id');
        let data = await this.model('goods').where({
            id: goodsId
        }).find();
        delete data.id;
        data.is_on_sale = 0;
        let insertId = await this.model('goods').add(data);
        let goodsGallery = await this.model('goods_gallery').where({
            goods_id: goodsId,
            is_delete:0,
        }).select();
        for (const item of goodsGallery) {
            let gallery = {
                img_url: item.img_url,
                sort_order: item.sort_order,
                goods_id: insertId
            }
            await this.model('goods_gallery').add(gallery);
        }
        return this.success(insertId);
    }
    async updateStock(goods_sn, goods_number) {
        console.log('存在，现在就更新');
        await this.model('product').where({
            goods_sn: goods_sn
        }).update({
            goods_number: goods_number
        });
    }
    async updateGoodsNumberAction() {
        let all_goods = await this.model('goods').where({
            is_delete: 0,
            is_on_sale: 1
        }).select();
        for (const item of all_goods) {
            let goodsSum = await this.model('product').where({
                goods_id: item.id
            }).sum('goods_number');
            await this.model('goods').where({
                id: item.id
            }).update({
                goods_number: goodsSum
            });
            await think.timeout(2000);
        }
        return this.success();
    }
    async onsaleAction() {
        const page = this.get('page') || 1;
        const size = this.get('size');
        const model = this.model('goods');
        const data = await model.where({
            is_delete: 0,
            is_on_sale: 1
        }).order(['sort_order asc']).page(page, size).countSelect();
        for (const item of data.data) {
            const info = await this.model('category').where({
                id: item.category_id
            }).find();
            item.category_name = info.name;
            // if (info.parent_id != 0) {
            //     const parentInfo = await this.model('category').where({id: info.parent_id}).find();
            //     item.category_p_name = parentInfo.name;
            // }
            if (item.is_on_sale == 1) {
                item.is_on_sale = true;
            } else {
                item.is_on_sale = false;
            }
            if (item.is_index == 1) {
                item.is_index = true;
            } else {
                item.is_index = false;
            }
            let product = await this.model('product').where({
                goods_id: item.id,
                is_delete: 0
            }).select();
            for (const ele of product) {
                let spec = await this.model('goods_specification').where({
                    id: ele.goods_specification_ids,
                    is_delete: 0
                }).find();
                ele.value = spec.value;
                ele.is_on_sale = ele.is_on_sale ? "1" : "0";
            }
            item.product = product;
        }
        return this.success(data);
    }
    async outAction() {
        const page = this.get('page') || 1;
        const size = this.get('size');
        const model = this.model('goods');
        const data = await model.where({
            is_delete: 0,
            goods_number: ['<=', 0]
        }).order(['sort_order asc']).page(page, size).countSelect();
        for (const item of data.data) {
            const info = await this.model('category').where({
                id: item.category_id
            }).find();
            item.category_name = info.name;
            if (item.is_on_sale == 1) {
                item.is_on_sale = true;
            } else {
                item.is_on_sale = false;
            }
            if (item.is_index == 1) {
                item.is_index = true;
            } else {
                item.is_index = false;
            }
            let product = await this.model('product').where({
                goods_id: item.id,
                is_delete: 0
            }).select();
            for (const ele of product) {
                let spec = await this.model('goods_specification').where({
                    id: ele.goods_specification_ids,
                    is_delete: 0
                }).find();
                ele.value = spec.value;
                ele.is_on_sale = ele.is_on_sale ? "1" : "0";
            }
            item.product = product;
        }
        return this.success(data);
    }
    async dropAction() {
        const page = this.get('page') || 1;
        const size = this.get('size');
        const model = this.model('goods');
        const data = await model.where({
            is_delete: 0,
            is_on_sale: 0
        }).order(['id DESC']).page(page, size).countSelect();
        for (const item of data.data) {
            const info = await this.model('category').where({
                id: item.category_id
            }).find();
            item.category_name = info.name;
            if (item.is_on_sale == 1) {
                item.is_on_sale = true;
            } else {
                item.is_on_sale = false;
            }
            if (item.is_index == 1) {
                item.is_index = true;
            } else {
                item.is_index = false;
            }
            let product = await this.model('product').where({
                goods_id: item.id,
                is_delete: 0
            }).select();
            for (const ele of product) {
                let spec = await this.model('goods_specification').where({
                    id: ele.goods_specification_ids,
                    is_delete: 0
                }).find();
                ele.value = spec.value;
                ele.is_on_sale = ele.is_on_sale ? "1" : "0";
            }
            item.product = product;
        }
        return this.success(data);
    }
    async sortAction() {
        const page = this.get('page') || 1;
        const size = this.get('size');
        const model = this.model('goods');
        const index = this.get('index');
        if (index == 1) {
            const data = await model.where({
                is_delete: 0
            }).order(['sell_volume DESC']).page(page, size).countSelect();
            for (const item of data.data) {
                const info = await this.model('category').where({
                    id: item.category_id
                }).find();
                item.category_name = info.name;
                if (item.is_on_sale == 1) {
                    item.is_on_sale = true;
                } else {
                    item.is_on_sale = false;
                }
                if (item.is_index == 1) {
                    item.is_index = true;
                } else {
                    item.is_index = false;
                }
                let product = await this.model('product').where({
                    goods_id: item.id,
                    is_delete: 0
                }).select();
                for (const ele of product) {
                    let spec = await this.model('goods_specification').where({
                        id: ele.goods_specification_ids,
                        is_delete: 0
                    }).find();
                    ele.value = spec.value;
                    ele.is_on_sale = ele.is_on_sale ? "1" : "0";
                }
                item.product = product;
            }
            return this.success(data);
        } else if (index == 2) {
            const data = await model.where({
                is_delete: 0
            }).order(['retail_price DESC']).page(page, size).countSelect();
            for (const item of data.data) {
                const info = await this.model('category').where({
                    id: item.category_id
                }).find();
                item.category_name = info.name;
                if (item.is_on_sale == 1) {
                    item.is_on_sale = true;
                } else {
                    item.is_on_sale = false;
                }
                if (item.is_index == 1) {
                    item.is_index = true;
                } else {
                    item.is_index = false;
                }
                let product = await this.model('product').where({
                    goods_id: item.id,
                    is_delete: 0
                }).select();
                for (const ele of product) {
                    let spec = await this.model('goods_specification').where({
                        id: ele.goods_specification_ids,
                        is_delete: 0
                    }).find();
                    ele.value = spec.value;
                    ele.is_on_sale = ele.is_on_sale ? "1" : "0";
                }
                item.product = product;
            }
            return this.success(data);
        } else if (index == 3) {
            const data = await model.where({
                is_delete: 0
            }).order(['goods_number DESC']).page(page, size).countSelect();
            for (const item of data.data) {
                const info = await this.model('category').where({
                    id: item.category_id
                }).find();
                item.category_name = info.name;
                if (item.is_on_sale == 1) {
                    item.is_on_sale = true;
                } else {
                    item.is_on_sale = false;
                }
                if (item.is_index == 1) {
                    item.is_index = true;
                } else {
                    item.is_index = false;
                }
                let product = await this.model('product').where({
                    goods_id: item.id,
                    is_delete: 0
                }).select();
                for (const ele of product) {
                    let spec = await this.model('goods_specification').where({
                        id: ele.goods_specification_ids,
                        is_delete: 0
                    }).find();
                    ele.value = spec.value;
                    ele.is_on_sale = ele.is_on_sale ? "1" : "0";
                }
                item.product = product;
            }
            return this.success(data);
        }
    }
    async saleStatusAction() {
        const id = this.get('id');
        const status = this.get('status');
        let sale = 0;
        if (status == 'true') {
            sale = 1;
        }
        const model = this.model('goods');
        await model.where({
            id: id
        }).update({
            is_on_sale: sale
        });
        await this.model('cart').where({
            goods_id: id
        }).update({
            is_on_sale: sale,
            checked: sale
        });
    }
    async productStatusAction() {
        const id = this.get('id');
        const status = this.get('status');
        const model = this.model('product');
        await model.where({
            id: id
        }).update({
            is_on_sale: status
        });
		// 4.14更新
		await this.model('cart').where({
			product_id: id,
			is_delete: 0
		}).update({
			is_on_sale: status
		})
    }
    async indexShowStatusAction() {
        const id = this.get('id');
        const status = this.get('status');
        let stat = 0;
        if (status == 'true') {
            stat = 1;
        }
        const model = this.model('goods');
        await model.where({
            id: id
        }).update({
            is_index: stat
        });
    }
    async infoAction() {
        const id = this.get('id');
        const model = this.model('goods');
        const data = await model.where({
            id: id
        }).find();
        let category_id = data.category_id;
        let infoData = {
            info: data,
            category_id: category_id,
        };
        return this.success(infoData);
    }
    async getAllSpecificationAction() {
        const specInfo = await this.model('specification').where({
            id: ['>', 0]
        }).select();
        let specOptionsData = [];
        for (const spitem of specInfo) {
            let info = {
                value: spitem.id,
                label: spitem.name
            };
            specOptionsData.push(info);
        }
        return this.success(specOptionsData);
    }
    async getAllCategory1Action() { // 我写的算法
        const model = this.model('category');
        const data = await model.where({
            is_show: 1,
            level: 'L1'
        }).select();
        const c_data = await model.where({
            is_show: 1,
            level: 'L2'
        }).select();
        let newData = [];
        for (const item of data) {
            let children = [];
            for (const citem of c_data) {
                if (citem.parent_id == item.id) {
                    children.push({
                        value: citem.id,
                        label: citem.name
                    })
                }
            }
            newData.push({
                value: item.id,
                label: item.name,
                children: children
            });
        }
        return this.success(newData);
    }
    async getAllCategoryAction() { // 老婆的算法
        const model = this.model('category');
        const data = await model.where({
            is_show: 1,
            level: 'L1'
        }).field('id,name').select();
        let newData = [];
        for (const item of data) {
            let children = [];
            const c_data = await model.where({
                is_show: 1,
                level: 'L2',
                parent_id: item.id
            }).field('id,name').select();
            for (const c_item of c_data) {
                children.push({
                    value: c_item.id,
                    label: c_item.name
                })
            }
            newData.push({
                value: item.id,
                label: item.name,
                children: children
            });
        }
        return this.success(newData);
    }
    async storeAction() {
        const values = this.post('info') || {};
        const specData = this.post('specData');
        const specValue = this.post('specValue');
        const cateId = this.post('cateId');
        const model = this.model('goods');
        values.goods_desc = htmlSanitizer.sanitizeRichText(values.goods_desc);
        let picUrl = values.list_pic_url;
        let goods_id = values.id;
        values.category_id = cateId;
        values.is_index = values.is_index ? 1 : 0;
        values.is_new = values.is_new ? 1 : 0;
        let id = values.id;
        if (id > 0) {
            await model.where({
                id: id
            }).update(values);
            await this.model('cart').where({
                goods_id: id
            }).update({
                checked: values.is_on_sale,
                is_on_sale: values.is_on_sale,
                list_pic_url: picUrl,
                freight_template_id: values.freight_template_id
            });
            await this.model('product').where({
                goods_id: id
            }).update({
                is_delete: 1
            });
            await this.model('goods_specification').where({
                goods_id: id
            }).update({
                is_delete: 1
            });
            for (const item of specData) {
                if (item.id > 0) {
                    await this.model('cart').where({
                        product_id: item.id,
                        is_delete: 0,
                    }).update({
                        retail_price: item.retail_price,
                        goods_specifition_name_value: item.value,
                        goods_sn: item.goods_sn
                    });
                    delete item.is_delete;
                    item.is_delete = 0;
                    await this.model('product').where({
                        id: item.id
                    }).update(item);
                    let specificationData = {
                        value: item.value,
                        specification_id: specValue,
                        is_delete: 0
                    };
                    await this.model('goods_specification').where({
                        id: item.goods_specification_ids
                    }).update(specificationData);
                } else {
                    let specificationData = {
                        value: item.value,
                        goods_id: id,
                        specification_id: specValue
                    }
                    let specId = await this.model('goods_specification').add(specificationData);
                    item.goods_specification_ids = specId;
                    item.goods_id = id;
                    await this.model('product').add(item);
                }
            }
			for(const [index, item] of values.gallery.entries()){
				if(item.is_delete == 1 && item.id > 0){
					await this.model('goods_gallery').where({
						id:item.id
					}).update({
						is_delete:1
					})
				}
				else if(item.is_delete == 0 && item.id > 0){
					await this.model('goods_gallery').where({
						id:item.id
					}).update({
						sort_order:index
					})
				}
				else if(item.is_delete == 0 && item.id == 0){
					await this.model('goods_gallery').add({
						goods_id:id,
						img_url:item.url,
						sort_order:index
					})
				}
			}
        } else {
            delete values.id;
            goods_id = await model.add(values);
            for (const item of specData) {
                let specificationData = {
                    value: item.value,
                    goods_id: goods_id,
                    specification_id: specValue
                }
                let specId = await this.model('goods_specification').add(specificationData);
                item.goods_specification_ids = specId;
                item.goods_id = goods_id;
                item.is_on_sale = 1;
                await this.model('product').add(item);
            }
			for(const [index, item] of values.gallery.entries()){
				await this.model('goods_gallery').add({
					goods_id:goods_id,
					img_url:item.url,
					sort_order:index
				})
			}
        }
        let pro = await this.model('product').where({
            goods_id: goods_id,
            is_on_sale: 1,
            is_delete: 0
        }).select();
        if (pro.length > 1) {
            let goodsNum = await this.model('product').where({
                goods_id: goods_id,
                is_on_sale: 1,
                is_delete: 0
            }).sum('goods_number');
            let retail_price = await this.model('product').where({
                goods_id: goods_id,
                is_on_sale: 1,
                is_delete: 0
            }).getField('retail_price');
            let maxPrice = Math.max(...retail_price);
            let minPrice = Math.min(...retail_price);
            let cost = await this.model('product').where({
                goods_id: goods_id,
                is_on_sale: 1,
                is_delete: 0
            }).getField('cost');
            let maxCost = Math.max(...cost);
            let minCost = Math.min(...cost);
            let goodsPrice = '';
            if(minPrice == maxPrice){
                goodsPrice = minPrice;
            }
            else{
                goodsPrice = minPrice + '~' + maxPrice;
            }
            let costPrice = minCost + '~' + maxCost;
            await this.model('goods').where({
                id: goods_id
            }).update({
                goods_number: goodsNum,
                retail_price: goodsPrice,
                cost_price: costPrice,
                min_retail_price: minPrice,
                min_cost_price: minCost,
            });
        } else {
            let info = {
                goods_number: pro[0].goods_number,
                retail_price: pro[0].retail_price,
                cost_price: pro[0].cost,
                min_retail_price: pro[0].retail_price,
                min_cost_price: pro[0].cost,
            }
            await this.model('goods').where({
                id: goods_id
            }).update(info);
        }
        return this.success(goods_id);
    }
    async updatePriceAction() {
        let data = this.post('');
		let goods_id = data.goods_id;
        await this.model('goods_specification').where({
            id: data.goods_specification_ids
        }).update({
            value: data.value
        });
        await this.model('product').where({
            id: data.id
        }).update(data);
		let pro = await this.model('product').where({
		    goods_id: goods_id,
		    is_on_sale: 1,
		    is_delete: 0
		}).select();
		if(pro.length == 0){
			return this.fail(100,'商品的规格数量至少1个')
		}
        await this.model('cart').where({
            product_id: data.id,
            is_delete: 0,
        }).update({
            retail_price: data.retail_price,
            goods_specifition_name_value: data.value,
            goods_sn: data.goods_sn
        });
        delete data.value;
     
        if (pro.length > 1) {
            let goodsNum = await this.model('product').where({
                goods_id: goods_id,
                is_on_sale: 1,
                is_delete: 0
            }).sum('goods_number');
            let retail_price = await this.model('product').where({
                goods_id: goods_id,
                is_on_sale: 1,
                is_delete: 0
            }).getField('retail_price');
            let maxPrice = Math.max(...retail_price);
            let minPrice = Math.min(...retail_price);
            let cost = await this.model('product').where({
                goods_id: goods_id,
                is_on_sale: 1,
                is_delete: 0
            }).getField('cost');
            let maxCost = Math.max(...cost);
            let minCost = Math.min(...cost);
            let goodsPrice = '';
            if(minPrice == maxPrice){
                goodsPrice = minPrice;
            }
            else{
                goodsPrice = minPrice + '~' + maxPrice;
            }
            let costPrice = minCost + '~' + maxCost;
            await this.model('goods').where({
                id: goods_id
            }).update({
                goods_number: goodsNum,
                retail_price: goodsPrice,
                cost_price: costPrice,
                min_retail_price: minPrice,
                min_cost_price: minCost,
            });
        } else if(pro.length == 1){
            let info = {
                goods_number: pro[0].goods_number,
                retail_price: pro[0].retail_price,
                cost_price: pro[0].cost,
                min_retail_price: pro[0].retail_price,
                min_cost_price: pro[0].cost,
            }
            await this.model('goods').where({
                id: goods_id
            }).update(info);
        }
        return this.success();
    }
    async checkSkuAction() {
        const info = this.post('info');
        if (info.id > 0) {
            const model = this.model('product');
            const data = await model.where({
                id: ['<>', info.id],
                goods_sn: info.goods_sn,
                is_delete: 0
            }).find();
            if (!think.isEmpty(data)) {
                return this.fail(100, '重复')
            } else {
                return this.success();
            }
        } else {
            const model = this.model('product');
            const data = await model.where({
                goods_sn: info.goods_sn,
                is_delete: 0
            }).find();
            if (!think.isEmpty(data)) {
                return this.fail(100, '重复')
            } else {
                return this.success();
            }
        }
    }
    async updateSortAction() {
        const id = this.post('id');
        const sort = this.post('sort');
        const model = this.model('goods');
        const data = await model.where({
            id: id
        }).update({
            sort_order: sort
        });
        return this.success(data);
    }
    async updateShortNameAction() {
        const id = this.post('id');
        const short_name = this.post('short_name');
        const model = this.model('goods');
        const data = await model.where({
            id: id
        }).update({
            short_name: short_name
        });
        return this.success(data);
    }
    async galleryListAction() {
        const id = this.get('id');
        const model = this.model('goods_gallery');
        const data = await model.where({
            goods_id: id,
            is_delete:0
        }).select();
        // console.log(data);
        return this.success(data);
    }
    async galleryAction() {
        const url = this.post('url');
        const id = this.post('goods_id');
        let info = {
            goods_id: id,
            img_url: url
        }
        await this.model('goods_gallery').add(info);
        return this.success();
    }
    async getGalleryListAction() {
        const goodsId = this.post('goodsId');
        const data = await this.model('goods_gallery').where({
            goods_id: goodsId,
            is_delete:0
        }).order('sort_order asc').select();
        let galleryData = [];
        for (const item of data) {
            let pdata = {
                id: item.id,
                url: item.img_url,
				is_delete:0,
            }
            galleryData.push(pdata);
        }
        let info = {
            galleryData: galleryData,
        }
        return this.success(info);
    }
    async deleteGalleryFileAction() {
        const url = this.post('url');
        const id = this.post('id');
        await this.model('goods_gallery').where({
            id: id
        }).limit(1).update({
            is_delete: 1
        });
        return this.success('文件删除成功');
    }
    async galleryEditAction() {
        if (!this.isPost) {
            return false;
        }
        const values = this.post();
        let data = values.data;
        // console.log(data);
        const model = this.model('goods_gallery');
        for (const item of data) {
            let id = item.id;
            let sort = parseInt(item.sort_order);
            // console.log(sort);
            await this.model('goods_gallery').where({
                id: id
            }).update({
                sort_order: sort
            });
        }
        return this.success();
    }
    async deleteListPicUrlAction() {
        const id = this.post('id');
        console.log(id);
        await this.model('goods').where({
            id: id
        }).limit(1).update({
            list_pic_url: 0
        });
        return this.success();
    }
    async destoryAction() {
        const id = this.post('id');
        await this.model('goods').where({
            id: id
        }).limit(1).update({
            is_delete: 1
        });
        await this.model('product').where({
            goods_id: id
        }).update({
            is_delete: 1
        });
        await this.model('goods_specification').where({
            goods_id: id
        }).update({
            is_delete: 1
        });
        return this.success();
    }
    async importTemplateAction() {
        try {
            const service = this.service('goods_import', 'admin');
            const buffer = await service.getTemplateBuffer();
            const filename = `goods_import_template_v1.xlsx`;
            this.ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            this.ctx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
            this.ctx.body = buffer;
            return;
        } catch (error) {
            console.error('导出导入模板失败:', error);
            return this.fail(500, '导出模板失败');
        }
    }
    async importTaskCreateAction() {
        const file = this.file('file');
        const mode = String(this.post('mode') || 'import');
        if (think.isEmpty(file) || !file.path) {
            return this.fail(400, '请上传 xlsx 文件');
        }
        if (Number(file.size || 0) <= 0) {
            return this.fail(400, '上传文件为空');
        }
        if (Number(file.size || 0) > IMPORT_MAX_FILE_SIZE) {
            return this.fail(400, `文件过大，最大支持 ${IMPORT_MAX_FILE_SIZE / 1024 / 1024}MB`);
        }
        if (file.type && IMPORT_ACCEPTED_MIME.indexOf(file.type) === -1) {
            return this.fail(400, '文件类型不支持，仅允许 xlsx');
        }
        const ext = path.extname(file.name || file.originalFilename || '').toLowerCase();
        if (ext !== '.xlsx') {
            return this.fail(400, '仅支持 xlsx 文件');
        }
        const header = readFileHeader(file.path, 8);
        if (!isZipFileHeader(header)) {
            return this.fail(400, '文件内容不合法，仅支持 xlsx');
        }
        if (mode !== 'import' && mode !== 'validate_only') {
            return this.fail(400, 'mode 参数非法');
        }
        try {
            const service = this.service('goods_import', 'admin');
            const result = await service.createTaskFromUpload(file, mode, think.userId);
            return this.success(result);
        } catch (error) {
            console.error('创建导入任务失败:', error);
            return this.fail(500, error.message || '创建导入任务失败');
        } finally {
            if (file.path) {
                fs.unlink(file.path, () => {});
            }
        }
    }
    async importTaskListAction() {
        const page = this.get('page') || 1;
        const size = this.get('size') || 10;
        const taskModel = this.model('goods_import_task');
        const data = await taskModel.where({
            is_delete: 0
        }).order('id DESC').page(page, size).countSelect();

        const operatorIds = Array.from(new Set((data.data || []).map(item => Number(item.operator_id)).filter(id => id > 0)));
        let operatorMap = {};
        if (operatorIds.length > 0) {
            const adminRows = await this.model('admin').where({
                id: ['IN', operatorIds]
            }).field('id,username').select();
            operatorMap = adminRows.reduce((acc, item) => {
                acc[item.id] = item.username;
                return acc;
            }, {});
        }

        const list = (data.data || []).map((item) => {
            let summary = {};
            if (item.summary_json) {
                try {
                    summary = JSON.parse(item.summary_json);
                } catch (err) {
                    summary = {};
                }
            }
            return {
                ...item,
                operator_name: operatorMap[item.operator_id] || '',
                summary
            };
        });

        data.data = list;
        return this.success(data);
    }
    async importTaskDetailAction() {
        const id = Number(this.get('id'));
        if (!id) {
            return this.fail(400, 'id 参数错误');
        }
        const task = await this.model('goods_import_task').where({
            id,
            is_delete: 0
        }).find();
        if (think.isEmpty(task)) {
            return this.fail(404, '任务不存在');
        }
        let summary = {};
        if (task.summary_json) {
            try {
                summary = JSON.parse(task.summary_json);
            } catch (err) {
                summary = {};
            }
        }
        const errors = await this.model('goods_import_error').where({
            task_id: id
        }).order('id DESC').limit(200).select();
        let operator = {};
        if (task.operator_id > 0) {
            operator = await this.model('admin').where({id: task.operator_id}).field('id,username').find();
        }
        return this.success({
            ...task,
            summary,
            operator_name: operator.username || '',
            errors
        });
    }
    async importTaskErrorFileAction() {
        const id = Number(this.get('id'));
        if (!id) {
            return this.fail(400, 'id 参数错误');
        }
        const task = await this.model('goods_import_task').where({
            id,
            is_delete: 0
        }).find();
        if (think.isEmpty(task)) {
            return this.fail(404, '任务不存在');
        }
        if (!task.error_file_path || !fs.existsSync(task.error_file_path)) {
            return this.fail(404, '错误文件不存在');
        }
        const filename = `${task.task_no || 'goods_import'}_errors.xlsx`;
        this.ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        this.ctx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        this.ctx.body = fs.readFileSync(task.error_file_path);
        return;
    }
    async uploadHttpsImageAction() {
        const remoteUrl = String(this.post('url') || '').trim();
        if (!remoteUrl || remoteUrl.length > 2048) {
            return this.fail(400, '图片地址不合法');
        }
        try {
            const cosService = this.service('cos');
            const cosUrl = await cosService.fetchAndUpload(remoteUrl);
            console.info(`[uploadHttpsImage] operator=${think.userId || 0} target=${remoteUrl} result=success`);
            return this.success(cosUrl);
        } catch (error) {
            console.warn(`[uploadHttpsImage] operator=${think.userId || 0} target=${remoteUrl} result=failed reason=${error && error.message ? error.message : 'unknown'}`);
            console.error('上传HTTPS图片失败:', error);
            return this.fail(400, '上传失败');
        }
    }
};
