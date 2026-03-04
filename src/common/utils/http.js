const http = require('http');
const https = require('https');
const querystring = require('querystring');
const urlUtil = require('url');

function buildUrl(rawUrl, qs) {
  if (!qs || typeof qs !== 'object' || Object.keys(qs).length === 0) {
    return rawUrl;
  }
  const sep = rawUrl.indexOf('?') === -1 ? '?' : '&';
  return `${rawUrl}${sep}${querystring.stringify(qs)}`;
}

function requestText(options = {}) {
  return new Promise((resolve, reject) => {
    const method = String(options.method || 'GET').toUpperCase();
    const timeout = Number(options.timeout || 10000);
    const targetUrl = buildUrl(String(options.url || ''), options.qs || null);
    if (!targetUrl) {
      reject(new Error('invalid_request_url'));
      return;
    }
    const parsed = urlUtil.parse(targetUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    let payload = null;
    const headers = Object.assign({}, options.headers || {});

    if (options.form && typeof options.form === 'object') {
      payload = querystring.stringify(options.form);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=utf-8';
      }
    } else if (options.body !== undefined && options.body !== null) {
      if (Buffer.isBuffer(options.body) || typeof options.body === 'string') {
        payload = options.body;
      } else {
        payload = JSON.stringify(options.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    if (payload !== null && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = transport.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      headers
    }, res => {
      const statusCode = Number(res.statusCode || 0);
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        raw += chunk;
      });
      res.on('end', () => {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`http_status_${statusCode}`));
          return;
        }
        resolve(raw);
      });
    });

    req.setTimeout(timeout, () => {
      req.destroy(new Error('http_timeout'));
    });
    req.on('error', reject);
    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

async function requestJson(options = {}) {
  const text = await requestText(options);
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('http_invalid_json');
  }
}

module.exports = {
  requestText,
  requestJson
};
