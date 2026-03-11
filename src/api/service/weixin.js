const crypto = require('crypto');
const md5 = require('md5');
const moment = require('moment');
const httpClient = require('../../common/utils/http');

const UNIFIED_ORDER_URL = 'https://api.mch.weixin.qq.com/pay/unifiedorder';
const ACCESS_TOKEN_GUARD_SECONDS = 120;
let cachedAccessToken = '';
let cachedAccessTokenExpireAt = 0;

module.exports = class extends think.Service {
    getNonceStr() {
        return crypto.randomBytes(16).toString('hex');
    }
    getWeixinConfig() {
        const config = think.config('weixin') || {};
        return {
            appid: String(config.appid || '').trim(),
            secret: String(config.secret || '').trim(),
            mch_id: String(config.mch_id || '').trim(),
            partner_key: String(config.partner_key || '').trim(),
            notify_url: String(config.notify_url || '').trim()
        };
    }
    ensureWeixinConfig(requiredKeys = [], scene = 'weixin') {
        const config = this.getWeixinConfig();
        const missing = (Array.isArray(requiredKeys) ? requiredKeys : [])
            .map((key) => String(key || '').trim())
            .filter((key) => key && !config[key]);
        if (missing.length > 0) {
            throw new Error(`[${scene}] missing config: ${missing.join(', ')}`);
        }
        return config;
    }
    filterSignPayload(payload) {
        const result = {};
        for (const key of Object.keys(payload || {})) {
            if (key === 'sign') {
                continue;
            }
            const value = payload[key];
            if (value === undefined || value === null || value === '') {
                continue;
            }
            result[key] = String(value);
        }
        return result;
    }
    buildXml(payload) {
        const keys = Object.keys(payload || {});
        const nodes = keys.map((key) => {
            const value = String(payload[key]);
            if (/^\d+$/.test(value)) {
                return `<${key}>${value}</${key}>`;
            }
            return `<${key}><![CDATA[${value}]]></${key}>`;
        });
        return `<xml>${nodes.join('')}</xml>`;
    }
    parseXml(xmlText) {
        const text = String(xmlText || '').trim();
        if (!text) {
            return {};
        }
        const result = {};
        const regex = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
        let match = regex.exec(text);
        while (match) {
            const key = match[1];
            if (key !== 'xml') {
                result[key] = match[2] !== undefined ? match[2] : (match[3] || '');
            }
            match = regex.exec(text);
        }
        return result;
    }
    buildSign(payload) {
        const signPayload = this.filterSignPayload(payload);
        const query = this.buildQuery(signPayload);
        return this.signQuery(query);
    }
    /**
     * 解析微信登录用户数据
     * @param sessionKey
     * @param encryptedData
     * @param iv
     * @returns {Promise.<string>}
     */
    async decryptUserInfoData(sessionKey, encryptedData, iv) {
        const weixinConfig = this.ensureWeixinConfig(['appid'], 'weixin.decryptUserInfoData');
        // base64 decode
        const _sessionKey = Buffer.from(sessionKey, 'base64');
        encryptedData = Buffer.from(encryptedData, 'base64');
        iv = Buffer.from(iv, 'base64');
        let decoded = '';
        try {
            // 解密
            const decipher = crypto.createDecipheriv('aes-128-cbc', _sessionKey, iv);
            // 设置自动 padding 为 true，删除填充补位
            decipher.setAutoPadding(true);
            decoded = decipher.update(encryptedData, 'binary', 'utf8');
            decoded += decipher.final('utf8');
            decoded = JSON.parse(decoded);
        } catch (err) {
            return '';
        }
        if (decoded.watermark.appid !== weixinConfig.appid) {
            return '';
        }
        return decoded;
    }
    /**
     * 统一下单
     * @param payInfo
     * @returns {Promise}
     */
    async createUnifiedOrder(payInfo) {
        const weixinConfig = this.ensureWeixinConfig(['appid', 'mch_id', 'partner_key', 'notify_url'], 'weixin.createUnifiedOrder');
        const requestData = {
            appid: weixinConfig.appid,
            mch_id: weixinConfig.mch_id,
            nonce_str: this.getNonceStr(),
            body: payInfo.body,
            out_trade_no: payInfo.out_trade_no,
            total_fee: String(payInfo.total_fee),
            spbill_create_ip: payInfo.spbill_create_ip || '127.0.0.1',
            notify_url: weixinConfig.notify_url,
            trade_type: 'JSAPI',
            openid: payInfo.openid
        };
        requestData.sign = this.buildSign(requestData);

        const xmlBody = this.buildXml(requestData);
        const responseText = await httpClient.requestText({
            method: 'POST',
            url: UNIFIED_ORDER_URL,
            body: xmlBody,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8'
            }
        });
        const responseData = this.parseXml(responseText);
        if (responseData.return_code === 'SUCCESS' && responseData.result_code === 'SUCCESS') {
            const returnParams = {
                appid: responseData.appid || weixinConfig.appid,
                timeStamp: parseInt(Date.now() / 1000) + '',
                nonceStr: responseData.nonce_str || requestData.nonce_str,
                package: `prepay_id=${responseData.prepay_id}`,
                signType: 'MD5'
            };
            const paramStr = `appId=${returnParams.appid}&nonceStr=${returnParams.nonceStr}&package=${returnParams.package}&signType=${returnParams.signType}&timeStamp=${returnParams.timeStamp}&key=${weixinConfig.partner_key}`;
            returnParams.paySign = md5(paramStr).toUpperCase();
            return returnParams;
        }
        throw responseData;
    }
    async getTotalFee(sn) {
        let total_fee = await this.model('order').where({
            order_sn: sn
        }).field('actual_price').find();
        let res = total_fee.actual_price;
        return res;
    }
    /**
     * 生成排序后的支付参数 query
     * @param queryObj
     * @returns {Promise.<string>}
     */
    buildQuery(queryObj) {
        const sortPayOptions = {};
        for (const key of Object.keys(queryObj).sort()) {
            sortPayOptions[key] = queryObj[key];
        }
        let payOptionQuery = '';
        for (const key of Object.keys(sortPayOptions).sort()) {
            payOptionQuery += key + '=' + sortPayOptions[key] + '&';
        }
        payOptionQuery = payOptionQuery.substring(0, payOptionQuery.length - 1);
        return payOptionQuery;
    }
    /**
     * 对 query 进行签名
     * @param queryStr
     * @returns {Promise.<string>}
     */
    signQuery(queryStr) {
        const weixinConfig = this.ensureWeixinConfig(['partner_key'], 'weixin.signQuery');
        queryStr = queryStr + '&key=' + weixinConfig.partner_key;
        const md5 = require('md5');
        const md5Sign = md5(queryStr);
        return md5Sign.toUpperCase();
    }
    /**
     * 处理微信支付回调
     * @param notifyData
     * @returns {{}}
     */
    payNotify(notifyData) {
        if (think.isEmpty(notifyData)) {
            return false;
        }
        const notifyObj = {};
        let sign = '';
        for (const key of Object.keys(notifyData)) {
            if (key !== 'sign') {
                notifyObj[key] = notifyData[key][0];
            } else {
                sign = notifyData[key][0];
            }
        }
        if (notifyObj.return_code !== 'SUCCESS' || notifyObj.result_code !== 'SUCCESS') {
            return false;
        }
        const signString = this.signQuery(this.buildQuery(notifyObj));
        if (think.isEmpty(sign) || signString !== sign) {
            return false;
        }
        let timeInfo = notifyObj.time_end;
        let pay_time = moment(timeInfo, 'YYYYMMDDHHmmss');
        notifyObj.time_end = new Date(Date.parse(pay_time)).getTime() / 1000
        return notifyObj;
    }
    /**
     * 申请退款
     * @param refundInfo
     * @returns {Promise}
     */
    createRefund(payInfo) {
        return this.createUnifiedOrder(payInfo);
    }
    async getAccessToken(forceRefresh = false) {
        const weixinConfig = this.ensureWeixinConfig(['appid', 'secret'], 'weixin.getAccessToken');
        if (!forceRefresh && cachedAccessToken && Date.now() < cachedAccessTokenExpireAt) {
            return cachedAccessToken;
        }
        const options = {
            method: 'GET',
            // url: 'https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=',
            url: 'https://api.weixin.qq.com/cgi-bin/token',
            qs: {
                grant_type: 'client_credential',
                secret: weixinConfig.secret,
                appid: weixinConfig.appid
            }
        };
        try {
            const sessionData = await httpClient.requestJson(options);
            if (!sessionData.access_token) {
                return '';
            }
            const expiresIn = Number(sessionData.expires_in || 7200);
            const safeSeconds = Math.max(60, expiresIn - ACCESS_TOKEN_GUARD_SECONDS);
            cachedAccessToken = sessionData.access_token;
            cachedAccessTokenExpireAt = Date.now() + safeSeconds * 1000;
            return cachedAccessToken;
        } catch (err) {
            return '';
        }
    }
    async getPhoneNumberByCode(code) {
        const requestPhoneNumber = async(accessToken) => {
            if (!accessToken) {
                return {
                    errcode: -1,
                    errmsg: '获取access_token失败'
                };
            }
            return httpClient.requestJson({
                method: 'POST',
                url: 'https://api.weixin.qq.com/wxa/business/getuserphonenumber',
                qs: {
                    access_token: accessToken
                },
                body: {
                    code: code
                },
                json: true
            });
        };
        try {
            let data = await requestPhoneNumber(await this.getAccessToken());
            const errcode = Number(data && data.errcode || 0);
            if (errcode === 40001 || errcode === 42001) {
                data = await requestPhoneNumber(await this.getAccessToken(true));
            }
            return data;
        } catch (err) {
            return {
                errcode: -1,
                errmsg: '获取手机号失败'
            };
        }
    }
    async getSelfToken(params) {
        var key = ['meiweiyuxianmeiweiyuxian', params.timestamp, params.nonce].sort().join('');
        //将token （自己设置的） 、timestamp（时间戳）、nonce（随机数）三个参数进行字典排序
        var sha1 = crypto.createHash('sha1');
        //将上面三个字符串拼接成一个字符串再进行sha1加密
        sha1.update(key);
        //将加密后的字符串与signature进行对比，若成功，返回success。如果通过验证，则，注释掉这个函数
        let a = sha1.digest('hex');
        let b = params.signature;
        if (a == b) {
            return true;
        }
    }
    async sendMessage(token, data) {
        const sendInfo = {
            method: 'POST',
            url: 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + token,
            body: data,
            json: true
        };
        let posting = await httpClient.requestJson(sendInfo);
        console.log(posting);
        return posting;
    }
    async getMessageATempId(type) {
        switch (type) {
            case 1:
                return 'TXWzXjO4C0odXCwQk4idgBtGcgSKBEWXJETYBZcRAzE';
                break;
                // 支付成功
            case 2:
                return 'COiQGBTzTtz_us5qYeJf0K-pFAyubBuWQh40sV1eAuw';
                break;
                // 发货通知
            default:
                return '400';
        }
    }
    async getMessageTempId(type) {
        switch (type) {
            case 1:
                return 'TXWzXjO4C0odXCwQk4idgBtGcgSKBEWXJETYBZcRAzE';
                break;
                // 支付成功
            case 2:
                return 'COiQGBTzTtz_us5qYeJf0K-pFAyubBuWQh40sV1eAuw';
                break;
                // 发货通知
            default:
                return '400';
        }
    }
    async sendTextMessage(data, access_token) {
        const sendInfo = {
            method: 'POST',
            url: 'https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=' + access_token,
            body: {
                touser: data.FromUserName,
                msgtype: "text",
                text: {
                    content: data.Content
                }
            },
            json: true
        };
        let posting = await httpClient.requestJson(sendInfo);
        return posting;
    }
    async sendImageMessage(media_id, data, access_token) {
        const sendInfo = {
            method: 'POST',
            url: 'https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=' + access_token,
            body: {
                touser: data.FromUserName,
                msgtype: "image",
                image: {
                    media_id: media_id
                }
            },
            json: true
        };
        let posting = await httpClient.requestJson(sendInfo);
        return posting;
    }
};
