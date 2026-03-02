const COS = require('cos-nodejs-sdk-v5');
const request = require('request');
const mime = require('mime-types');

module.exports = class extends think.Service {
  constructor() {
    super();
    const ossConfig = think.config('oss') || {};
    this.region = ossConfig.region;
    this.bucket = ossConfig.bucket;
    this.domain = (ossConfig.domain || '').replace(/\/+$/, '');
    this.client = new COS({
      SecretId: ossConfig.accessKeyId,
      SecretKey: ossConfig.accessKeySecret
    });
  }

  ensureConfig() {
    if (!this.region || !this.bucket) {
      throw new Error('COS配置不完整');
    }
  }

  requestCos(method, params) {
    return new Promise((resolve, reject) => {
      this.client[method](params, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    });
  }

  buildUrl(key) {
    if (this.domain) {
      return `${this.domain}/${key}`;
    }
    return `https://${this.bucket}.cos.${this.region}.myqcloud.com/${key}`;
  }

  /**
   * 获取COS上传签名URL
   * 前端使用此URL进行PUT方式上传
   */
  async getUploadSignature() {
    this.ensureConfig();
    try {
      const key = think.uuid(32);
      const uploadUrl = this.client.getObjectUrl({
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
        Method: 'PUT',
        Sign: true,
        Expires: 600
      });
      return {
        uploadUrl,
        key,
        domain: this.domain || this.buildUrl('').replace(/\/+$/, '')
      };
    } catch (error) {
      console.error('生成COS签名失败:', error);
      throw new Error('生成上传签名失败');
    }
  }

  downloadRemote(url) {
    return new Promise((resolve, reject) => {
      request.get(
        {
          url,
          encoding: null,
          timeout: 15000,
          strictSSL: false,
          followAllRedirects: true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; hioshop-cos-uploader/1.0)'
          }
        },
        (err, response, body) => {
          if (err) {
            reject(err);
            return;
          }
          if (!response || response.statusCode !== 200 || !body) {
            reject(new Error(`download_failed_status_${response ? response.statusCode : 'unknown'}`));
            return;
          }
          const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          resolve({ body, contentType });
        }
      );
    });
  }

  /**
   * 从远程URL抓取图片并上传到COS
   * 用于商品分享图片的HTTPS转换
   * @param {string} remoteUrl - 远程图片URL
   * @returns {string} COS中的图片URL
   */
  async fetchAndUpload(remoteUrl) {
    this.ensureConfig();
    try {
      const { body, contentType } = await this.downloadRemote(remoteUrl);
      const mimeExt = mime.extension(contentType || '') || '';
      const ext = mimeExt ? `.${mimeExt}` : '';
      const key = `fetch/${think.uuid(32)}${ext}`;
      await this.requestCos('putObject', {
        Bucket: this.bucket,
        Region: this.region,
        Key: key,
        Body: body,
        ContentType: contentType || 'image/jpeg'
      });
      return this.buildUrl(key);
    } catch (error) {
      console.error('抓取并上传图片失败:', error);
      throw error;
    }
  }
};
