const OSS = require('ali-oss');

module.exports = class extends think.Service {
    constructor() {
        super();
        const ossConfig = think.config('oss');
        this.client = new OSS({
            region: ossConfig.region,
            accessKeyId: ossConfig.accessKeyId,
            accessKeySecret: ossConfig.accessKeySecret,
            bucket: ossConfig.bucket
        });
        this.domain = ossConfig.domain;
    }

    /**
     * 获取OSS上传签名URL
     * 前端使用此URL进行PUT方式上传
     */
    async getUploadSignature() {
        try {
            // 生成唯一的文件名
            const key = think.uuid(32);

            // 生成签名URL,有效期10分钟(600秒)
            const url = this.client.signatureUrl(key, {
                method: 'PUT',
                expires: 600,
                'Content-Type': 'application/octet-stream'
            });

            // 返回签名URL和访问域名
            return {
                uploadUrl: url,
                key: key,
                domain: this.domain
            };
        } catch (error) {
            console.error('生成OSS签名失败:', error);
            throw new Error('生成上传签名失败');
        }
    }

    /**
     * 从远程URL抓取图片并上传到OSS
     * 用于商品分享图片的HTTPS转换
     * @param {string} remoteUrl - 远程图片URL
     * @returns {string} OSS中的图片URL
     */
    async fetchAndUpload(remoteUrl) {
        try {
            // 下载远程图片
            const response = await this.client.get(remoteUrl);

            if (!response || !response.content) {
                throw new Error('下载远程图片失败');
            }

            // 生成新的文件名
            const key = think.uuid(32);

            // 上传到OSS
            const result = await this.client.put(key, response.content, {
                headers: {
                    'Content-Type': response.res.headers['content-type'] || 'image/jpeg'
                }
            });

            return result.url; // 返回完整的访问URL
        } catch (error) {
            console.error('抓取并上传图片失败:', error);
            throw error;
        }
    }
};
