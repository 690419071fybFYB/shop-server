const httpClient = require('../../common/utils/http');
const _ = require('lodash');
module.exports = class extends think.Service {
    getExpressConfig() {
        const config = think.config('express') || {};
        return {
            appid: String(config.appid || '').trim(),
            appkey: String(config.appkey || '').trim(),
            request_url: String(config.request_url || '').trim()
        };
    }
    getMianExpressConfig() {
        const config = think.config('mianexpress') || {};
        return {
            appid: String(config.appid || '').trim(),
            appkey: String(config.appkey || '').trim(),
            request_url: String(config.request_url || '').trim(),
            print_url: String(config.print_url || '').trim(),
            ip_server_url: String(config.ip_server_url || '').trim()
        };
    }
    ensureRequiredConfig(config, requiredKeys = [], scene = 'express') {
        const missing = (Array.isArray(requiredKeys) ? requiredKeys : [])
            .map((key) => String(key || '').trim())
            .filter((key) => key && !config[key]);
        if (missing.length > 0) {
            throw new Error(`[${scene}] missing config: ${missing.join(', ')}`);
        }
        return config;
    }
    async queryExpress(shipperCode, logisticCode, orderCode = '') {
        const expressConfig = this.ensureRequiredConfig(
            this.getExpressConfig(),
            ['appid', 'appkey', 'request_url'],
            'express.queryExpress'
        );
        // 最终得到的数据，初始化
        let expressInfo = {
            success: false,
            shipperCode: shipperCode,
            shipperName: '',
            logisticCode: logisticCode,
            isFinish: 0,
            traces: []
        };
        // 要post的数据，进行编码，签名
        const fromData = this.generateFromData(shipperCode, logisticCode, orderCode, expressConfig);
        if (think.isEmpty(fromData)) {
            return expressInfo;
        }
        // post的参数
        const sendOptions = {
            method: 'POST',
            url: expressConfig.request_url,
            headers: {
                'content-type': 'application/x-www-form-urlencoded;charset=utf-8'
            },
            form: fromData
        };
        // post请求
        try {
            const requestResult = await httpClient.requestText(sendOptions);
            if (think.isEmpty(requestResult)) {
                return expressInfo;
            }
            expressInfo = this.parseExpressResult(requestResult);
            expressInfo.shipperCode = shipperCode;
            expressInfo.logisticCode = logisticCode;
            return expressInfo;
        } catch (err) {
            return expressInfo;
        }
    }
    // 快递物流信息请求系统级参数 要post的数据，进行编码，签名
    generateFromData(shipperCode, logisticCode, orderCode, expressConfig = this.getExpressConfig()) {
        const requestData = this.generateRequestData(shipperCode, logisticCode, orderCode);
        const fromData = {
            RequestData: encodeURI(requestData), // 把字符串作为 URI 进行编码
            EBusinessID: expressConfig.appid, // 客户号
            RequestType: '1002', // 请求代码
            DataSign: this.generateDataSign(requestData, expressConfig.appkey), // 签名
            DataType: '2' //数据类型：2
        };
        return fromData;
    }
    // JavaScript 值转换为 JSON 字符串。
    generateRequestData(shipperCode, logisticCode, orderCode = '') {
        // 参数验证
        const requestData = {
            OrderCode: orderCode,
            ShipperCode: shipperCode,
            LogisticCode: logisticCode
        };
        return JSON.stringify(requestData);
    }
    // 编码加密
    generateDataSign(requestData, appKey) {
        return encodeURI(Buffer.from(think.md5(requestData + appKey)).toString('base64'));
    }
    parseExpressResult(requestResult) {
        const expressInfo = {
            success: false,
            shipperCode: '',
            shipperName: '',
            logisticCode: '',
            isFinish: 0,
            traces: []
        };
        if (think.isEmpty(requestResult)) {
            return expressInfo;
        }
        try {
            if (_.isString(requestResult)) {
                requestResult = JSON.parse(requestResult); // 将一个 JSON 字符串转换为对象。
            }
        } catch (err) {
            return expressInfo;
        }
        if (think.isEmpty(requestResult.Success)) {
            return expressInfo;
        }
        // 判断是否已签收
        if (Number.parseInt(requestResult.State) === 3) {
            expressInfo.isFinish = 1;
        }
        expressInfo.success = true;
        if (!think.isEmpty(requestResult.Traces) && Array.isArray(requestResult.Traces)) {
            expressInfo.traces = _.map(requestResult.Traces, item => {
                return {
                    datetime: item.AcceptTime,
                    content: item.AcceptStation
                };
            });
            _.reverse(expressInfo.traces);
        }
        return expressInfo;
    }
    // 电子面单开始
    async mianExpress(data = {}) {
        const mianExpressConfig = this.ensureRequiredConfig(
            this.getMianExpressConfig(),
            ['appid', 'appkey', 'request_url'],
            'express.mianExpress'
        );
        // 从前台传过来的数据
        let expressInfo = data;
        // 进行编码，签名
        const fromData = this.mianFromData(data, mianExpressConfig);
        if (think.isEmpty(fromData)) {
            return expressInfo;
        }
        // 请求的参数设置
        const sendOptions = {
            method: 'POST',
            url: mianExpressConfig.request_url,
            headers: {
                'content-type': 'application/x-www-form-urlencoded;charset=utf-8'
            },
            form: fromData
        };
        // post请求
        try {
            const requestResult = await httpClient.requestText(sendOptions);
            if (think.isEmpty(requestResult)) {
                return expressInfo;
            }
            expressInfo = this.parseMianExpressResult(requestResult);
            let htmldata = expressInfo.PrintTemplate;
            let html = htmldata.toString();
            return expressInfo;
        } catch (err) {
            return expressInfo;
        }
    }
    // 电子面单信息请求系统级参数 要post的数据 进行编码，签名
    mianFromData(data, mianExpressConfig = this.getMianExpressConfig()) {
        const requestData = JSON.stringify(data); // data：post进来的 // JavaScript 值转换为 JSON 字符串。
        const fromData = {
            RequestData: encodeURI(requestData),
            EBusinessID: mianExpressConfig.appid,
            RequestType: '1007',
            DataSign: this.mianDataSign(requestData, mianExpressConfig.appkey),
            DataType: '2'
        };
        // console.log('fromdata======');
        return fromData;
    }
    // 加密签名
    mianDataSign(requestData, appKey) {
        return encodeURI(Buffer.from(think.md5(requestData + appKey)).toString('base64'));
    }
    // 返回数据
    parseMianExpressResult(requestResult) {
        const expressInfo = {
            success: false,
        };
        if (think.isEmpty(requestResult)) {
            return expressInfo;
        }
        try {
            if (_.isString(requestResult)) {
                requestResult = JSON.parse(requestResult);
            }
            return requestResult;
        } catch (err) {
            return expressInfo;
        }
        return expressInfo;
    }
    // 电子面单结束
    // 批量打印开始
    // build_form();
    /**
     * 组装POST表单用于调用快递鸟批量打印接口页面
     */
    async buildForm(data = {}) {
        const mianExpressConfig = this.ensureRequiredConfig(
            this.getMianExpressConfig(),
            ['appid', 'appkey', 'print_url', 'ip_server_url'],
            'express.buildForm'
        );
        let requestData = data;
        requestData = '[{"OrderCode":"234351215333113311353","PortName":"打印机名称一"}]';
        //OrderCode:需要打印的订单号，和调用快递鸟电子面单的订单号一致，PortName：本地打印机名称，请参考使用手册设置打印机名称。支持多打印机同时打印。
        // $request_data = '[{"OrderCode":"234351215333113311353","PortName":"打印机名称一"},{"OrderCode":"234351215333113311354","PortName":"打印机名称二"}]';
        let requestDataEncode = encodeURI(requestData);
        let API_URL = mianExpressConfig.print_url;
        const clientIp = await this.get_ip();
        let dataSign = this.printDataSign(clientIp, requestDataEncode, mianExpressConfig.appkey);
        //是否预览，0-不预览 1-预览
        let is_priview = '0';
        let EBusinessID = mianExpressConfig.appid;
        //组装表单
        let form = '<form id="form1" method="POST" action="' + API_URL + '"><input type="text" name="RequestData" value="' + requestData + '"/><input type="text" name="EBusinessID" value="' + EBusinessID + '"/><input type="text" name="DataSign" value="' + dataSign + '"/><input type="text" name="IsPriview" value="' + is_priview + '"/></form><script>form1.submit();</script>';
        console.log(form);
        return form;
    }
    // 加密签名
    printDataSign(ip, requestData, appKey) {
        return encodeURI(Buffer.from(ip + think.md5(requestData + appKey)).toString('base64'));
    }
    /**
     * 判断是否为内网IP
     * @param ip IP
     * @return 是否内网IP
     */
    // function is_private_ip($ip) {
    //     return !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    // }
    /**
     * 获取客户端IP(非用户服务器IP)
     * @return 客户端IP
     */
    async get_ip() {
        const mianExpressConfig = this.ensureRequiredConfig(
            this.getMianExpressConfig(),
            ['ip_server_url'],
            'express.get_ip'
        );
        const sendOptions = {
            method: 'GET',
            url: mianExpressConfig.ip_server_url,
            headers: {
                'content-type': 'application/x-www-form-urlencoded;charset=utf-8'
            }
        };
        // post请求
        try {
            const requestResult = await httpClient.requestText(sendOptions);
            if (think.isEmpty(requestResult)) {
                let i = 0
                return i;
            }
            var ip = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
            var text = ip.exec(requestResult);
            console.log(text[0]);
            return text[0];
        } catch (err) {
            return 0;
        }
    }
    // 批量打印结束
};
