const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const mime = require('mime-types');
const dns = require('dns');
const net = require('net');
const https = require('https');
const url = require('url');

module.exports = class extends think.Service {
  constructor() {
    super();
    const cosConfig = think.config('cos') || {};
    this.region = cosConfig.region;
    this.bucket = cosConfig.bucket;
    this.domain = (cosConfig.domain || '').replace(/\/+$/, '');
    this.accessKeyId = String(cosConfig.accessKeyId || '');
    this.accessKeySecret = String(cosConfig.accessKeySecret || '');
    this.client = new S3Client({
      region: this.region,
      endpoint: `https://cos.${this.region}.myqcloud.com`,
      forcePathStyle: false,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.accessKeySecret
      }
    });
    this.maxFetchBytes = Number(cosConfig.maxFetchBytes || 10 * 1024 * 1024);
    this.maxRedirects = Number(cosConfig.maxRedirects || 3);
  }

  ensureConfig() {
    if (!this.region || !this.bucket || !this.accessKeyId || !this.accessKeySecret) {
      throw new Error('COS配置不完整');
    }
  }

  async putObject(key, body, contentType) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream'
    });
    await this.client.send(command);
  }

  buildUrl(key) {
    if (this.domain) {
      return `${this.domain}/${key}`;
    }
    return `https://${this.bucket}.cos.${this.region}.myqcloud.com/${key}`;
  }

  isBlockedHostname(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) {
      return true;
    }
    if (host === 'localhost' || host === 'localhost.localdomain') {
      return true;
    }
    if (host.endsWith('.local')) {
      return true;
    }
    return false;
  }

  isPrivateIpv4(ip) {
    const parts = String(ip || '').split('.').map(n => Number(n));
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a >= 224) {
      return true;
    }
    return false;
  }

  isPrivateIpv6(ip) {
    const value = String(ip || '').toLowerCase();
    if (!value) {
      return true;
    }
    if (value === '::1' || value === '::') {
      return true;
    }
    if (value.startsWith('fc') || value.startsWith('fd')) {
      return true;
    }
    if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) {
      return true;
    }
    if (value.startsWith('::ffff:')) {
      const ipv4 = value.replace('::ffff:', '');
      return this.isPrivateIpv4(ipv4);
    }
    return false;
  }

  isDisallowedIp(ip) {
    const family = net.isIP(ip);
    if (family === 4) {
      return this.isPrivateIpv4(ip);
    }
    if (family === 6) {
      return this.isPrivateIpv6(ip);
    }
    return true;
  }

  resolveHostname(hostname) {
    return new Promise((resolve, reject) => {
      dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) {
          reject(err);
          return;
        }
        const list = (addresses || [])
          .map(item => (item && item.address ? String(item.address) : ''))
          .filter(Boolean);
        resolve(list);
      });
    });
  }

  async assertRemoteUrlSafe(remoteUrl) {
    const rawUrl = String(remoteUrl || '').trim();
    if (!rawUrl) {
      throw new Error('invalid_url_empty');
    }
    let parsed;
    try {
      parsed = url.parse(rawUrl);
    } catch (err) {
      throw new Error('invalid_url_parse_failed');
    }
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'https:') {
      throw new Error('invalid_url_protocol');
    }
    const hostname = String(parsed.hostname || '').trim().toLowerCase();
    if (this.isBlockedHostname(hostname)) {
      throw new Error('invalid_url_hostname');
    }
    let ipList = [];
    if (net.isIP(hostname)) {
      ipList = [hostname];
    } else {
      ipList = await this.resolveHostname(hostname);
    }
    if (!ipList.length) {
      throw new Error('dns_resolve_empty');
    }
    const blockedIp = ipList.find(ip => this.isDisallowedIp(ip));
    if (blockedIp) {
      throw new Error(`blocked_ip_${blockedIp}`);
    }
    return rawUrl;
  }

  /**
   * 获取COS上传签名URL
   * 前端使用此URL进行PUT方式上传
   */
  async getUploadSignature() {
    this.ensureConfig();
    try {
      const key = think.uuid(32);
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const uploadUrl = await getSignedUrl(this.client, command, {
        expiresIn: 600
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

  downloadRemote(remoteUrl, redirectCount = 0) {
    if (redirectCount > this.maxRedirects) {
      return Promise.reject(new Error('too_many_redirects'));
    }
    return new Promise((resolve, reject) => {
      const req = https.get(remoteUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; hioshop-cos-uploader/1.0)',
          Accept: 'image/*'
        }
      }, async response => {
        const statusCode = Number(response && response.statusCode ? response.statusCode : 0);
        if (statusCode >= 300 && statusCode < 400 && response && response.headers && response.headers.location) {
          response.resume();
          try {
            const nextUrl = url.resolve(remoteUrl, response.headers.location);
            await this.assertRemoteUrlSafe(nextUrl);
            const result = await this.downloadRemote(nextUrl, redirectCount + 1);
            resolve(result);
          } catch (redirectError) {
            reject(redirectError);
          }
          return;
        }
        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`download_failed_status_${statusCode || 'unknown'}`));
          return;
        }
        const contentType = String((response.headers && response.headers['content-type']) || '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (!contentType || !contentType.startsWith('image/')) {
          response.resume();
          reject(new Error('download_invalid_content_type'));
          return;
        }
        const contentLengthHeader = Number((response.headers && response.headers['content-length']) || 0);
        if (contentLengthHeader > this.maxFetchBytes) {
          response.resume();
          reject(new Error('download_body_too_large'));
          return;
        }
        const chunks = [];
        let total = 0;
        response.on('data', chunk => {
          total += chunk.length;
          if (total > this.maxFetchBytes) {
            response.destroy(new Error('download_body_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({ body, contentType });
        });
        response.on('error', err => {
          reject(err);
        });
      });
      req.on('timeout', () => {
        req.destroy(new Error('download_timeout'));
      });
      req.on('error', err => {
        reject(err);
      });
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
      const safeUrl = await this.assertRemoteUrlSafe(remoteUrl);
      const { body, contentType } = await this.downloadRemote(safeUrl, 0);
      const mimeExt = mime.extension(contentType || '') || '';
      const ext = mimeExt ? `.${mimeExt}` : '';
      const key = `fetch/${think.uuid(32)}${ext}`;
      await this.putObject(key, body, contentType || 'image/jpeg');
      return this.buildUrl(key);
    } catch (error) {
      console.error('抓取并上传图片失败:', error);
      throw error;
    }
  }
};
