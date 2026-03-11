// default config
const cosRegion = process.env.COS_REGION || 'ap-shanghai';
const cosBucket = process.env.COS_BUCKET || 'fybshopbk-1369967353';
const cosDomain =
  process.env.COS_DOMAIN ||
  `https://${cosBucket}.cos.${cosRegion}.myqcloud.com`;
const promotionFeatureFlag = String(process.env.FEATURE_PROMOTION_V1 || 'true').toLowerCase();
const testPayFeatureFlag = String(process.env.ENABLE_TEST_PAY_ENDPOINT || 'false').toLowerCase();

function parseSecretList(rawValue) {
    return String(rawValue || '')
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

module.exports = {
    default_module: 'api',
	port: 8360, //服务端口，可自定义
    security: {
        apiTokenSecret: process.env.API_JWT_SECRET || process.env.API_TOKEN_SECRET || '',
        adminTokenSecret: process.env.ADMIN_JWT_SECRET || process.env.ADMIN_TOKEN_SECRET || '',
        apiTokenLegacySecrets: parseSecretList(process.env.API_JWT_LEGACY_SECRETS || process.env.API_TOKEN_LEGACY_SECRETS || ''),
        adminTokenLegacySecrets: parseSecretList(process.env.ADMIN_JWT_LEGACY_SECRETS || process.env.ADMIN_TOKEN_LEGACY_SECRETS || ''),
        apiTokenExpiresIn: process.env.API_TOKEN_EXPIRES_IN || '7d',
        adminTokenExpiresIn: process.env.ADMIN_TOKEN_EXPIRES_IN || '12h',
        adminPasswordHashRounds: Number(process.env.ADMIN_PASSWORD_HASH_ROUNDS || 10),
        tokenAlgorithm: 'HS256'
    },
    features: {
        promotionV1: !['0', 'false', 'off', 'no'].includes(promotionFeatureFlag),
        enableTestPayEndpoint: ['1', 'true', 'on', 'yes'].includes(testPayFeatureFlag)
    },
    weixin: {
        appid: process.env.WEIXIN_APPID || '', // 小程序 appid
        secret: process.env.WEIXIN_SECRET || '', // 小程序密钥
        mch_id: process.env.WEIXIN_MCH_ID || '', // 商户帐号ID
        partner_key: process.env.WEIXIN_PARTNER_KEY || '', // 微信支付密钥
        notify_url: process.env.WEIXIN_NOTIFY_URL || 'https://api.fybshop.site/api/pay/notify' // 微信支付异步通知
    },
    express: {
        // 已废弃，之后考虑改回来，做成和阿里云的物流查询可以切换，方便大家的使用
        // 免费的，但是顺丰的话，要配合快递鸟的电子面单
        // 快递物流信息查询使用的是快递鸟接口，申请地址：http://www.kdniao.com/ 
        appid: process.env.EXPRESS_APPID || '', // 对应快递鸟用户后台 用户ID
        appkey: process.env.EXPRESS_APPKEY || '', // 对应快递鸟用户后台 API key
        request_url: process.env.EXPRESS_REQUEST_URL || ''
    },
   mianexpress:{
        appid: process.env.MIANEXPRESS_APPID || '', // 对应快递鸟用户后台 用户ID
        appkey: process.env.MIANEXPRESS_APPKEY || '', // 对应快递鸟用户后台 API key
        request_url: process.env.MIANEXPRESS_REQUEST_URL || '',
        print_url: process.env.MIANEXPRESS_PRINT_URL || '',
        ip_server_url: process.env.MIANEXPRESS_IP_SERVER_URL || ''
    },
    // 腾讯云COS配置
    cos: {
        region: cosRegion,
        accessKeyId: process.env.COS_SECRET_ID || '',
        accessKeySecret: process.env.COS_SECRET_KEY || '',
        bucket: cosBucket,
        domain: cosDomain
    },
    // qiniu: {
    //     access_key: 'asdlakjsdlajlajsdlas',      // 在七牛密钥管理中获取
    //     secret_key: 'alskdjalksjdlasjdlajsd',    // 在七牛密钥管理中获取
    //     bucket: 'bucketname',                    // 请填自己的bucket的名称
    //     domain: 'domain/'                         // 请填自己的domain域名
    // },
    // // 在七牛新建一个https的空间，这个是用来存储分享图片的https图片，对应的是goods表中的https_pic_url
    // qiniuHttps: {
    //     access_key: 'asdlakjsdlajlajsdlasasdla', // 在七牛密钥管理中获取
    //     secret_key: 'aaaaaaaaaaasdasdasdasd', // 在七牛密钥管理中获取
    //     bucket: 'bucketname', // 自己设置的
    //     domain: 'domain/', // 自己设置，例如：'http://img.你的域名.com/',别忘了这个”/”
    //     // https://developer.qiniu.com/kodo/manual/1671/region-endpoint
    //     zoneNum: 0  // 这个自己根据地区设置：华东 0；华北 1；华南 2； 北美 3；东南亚 4
    // },
    aliexpress:{
        // https://market.aliyun.com/products/56928004/cmapi021863.html?spm=5176.730005.productlist.d_cmapi021863.6ba73524uQjLqE&innerSource=search_%E5%85%A8%E5%9B%BD%E5%BF%AB%E9%80%92%E7%89%A9%E6%B5%81%E6%9F%A5%E8%AF%A2-%E5%BF%AB%E9%80%92%E6%9F%A5%E8%AF%A2%E6%8E%A5%E5%8F%A3#sku=yuncode1586300000
        url: process.env.ALIEXPRESS_URL || '', //阿里云的物流查询api，收费的
        appcode: process.env.ALIEXPRESS_APPCODE || '', // 阿里云后台获取
        sfLastNo: process.env.ALIEXPRESS_SF_LAST_NO || ''
    },
	templateId:{
		deliveryId: process.env.WEIXIN_TEMPLATE_DELIVERY_ID || '' // 模板id。在订阅消息里设置好后就可以得到
	},
};
