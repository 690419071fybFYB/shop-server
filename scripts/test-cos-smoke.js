#!/usr/bin/env node

/**
 * COS smoke test:
 * 1) Admin login
 * 2) Fetch upload signature
 * 3) Upload a tiny PNG to COS by signed PUT URL
 * 4) HEAD check uploaded object
 * 5) Trigger remote HTTPS fetch+upload API and HEAD check result
 */

const BASE_URL = process.env.HIOSHOP_ADMIN_API || 'http://127.0.0.1:8360/admin';
const ADMIN_USERNAME = process.env.HIOSHOP_ADMIN_USER || 'qilelab.com';
const ADMIN_PASSWORD = process.env.HIOSHOP_ADMIN_PASS || 'qilelab.com';
const REMOTE_IMAGE_URL = process.env.HIOSHOP_REMOTE_IMAGE_URL || 'https://picsum.photos/200/200';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    payload = null;
  }
  return { response, payload, text };
}

async function login() {
  const body = new URLSearchParams();
  body.set('username', ADMIN_USERNAME);
  body.set('password', ADMIN_PASSWORD);
  const { payload, text } = await requestJson(`${BASE_URL}/auth/login`, {
    method: 'POST',
    body
  });
  assert(payload && payload.errno === 0 && payload.data && payload.data.token, `登录失败: ${text.slice(0, 300)}`);
  return payload.data.token;
}

async function getUploadSignature(token) {
  const { payload, text } = await requestJson(`${BASE_URL}/index/getQiniuToken`, {
    method: 'GET',
    headers: {
      'X-Hioshop-Token': token
    }
  });
  assert(payload && payload.errno === 0 && payload.data && payload.data.uploadUrl, `获取上传签名失败: ${text.slice(0, 300)}`);
  return payload.data;
}

async function uploadBySignedUrl(signatureData) {
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zf1QAAAAASUVORK5CYII=';
  const content = Buffer.from(tinyPngBase64, 'base64');

  const putResponse = await fetch(signatureData.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(content.length)
    },
    body: content
  });
  assert(putResponse.ok, `签名直传失败: HTTP ${putResponse.status}`);

  const fileUrl = `${String(signatureData.domain || '').replace(/\/+$/, '')}/${signatureData.key}`;
  const headResponse = await fetch(fileUrl, { method: 'HEAD' });
  assert(headResponse.ok, `上传后文件不可访问: HTTP ${headResponse.status}`);
  return {
    fileUrl,
    contentType: headResponse.headers.get('content-type') || ''
  };
}

async function uploadRemoteHttpsImage(token) {
  const { payload, text } = await requestJson(`${BASE_URL}/goods/uploadHttpsImage`, {
    method: 'POST',
    headers: {
      'X-Hioshop-Token': token,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      url: REMOTE_IMAGE_URL
    })
  });
  assert(payload && payload.errno === 0 && payload.data, `远程抓图上传失败: ${text.slice(0, 300)}`);
  const fileUrl = payload.data;
  const headResponse = await fetch(fileUrl, { method: 'HEAD' });
  assert(headResponse.ok, `远程抓图产物不可访问: HTTP ${headResponse.status}`);
  return {
    fileUrl,
    contentType: headResponse.headers.get('content-type') || ''
  };
}

async function run() {
  const token = await login();
  console.log('1) 登录成功');

  const signatureData = await getUploadSignature(token);
  console.log('2) 签名获取成功');
  console.log(`   upload host: ${new URL(signatureData.uploadUrl).host}`);

  const uploaded = await uploadBySignedUrl(signatureData);
  console.log('3) 签名直传成功');
  console.log(`   file: ${uploaded.fileUrl}`);
  console.log(`   content-type: ${uploaded.contentType || 'unknown'}`);

  const fetched = await uploadRemoteHttpsImage(token);
  console.log('4) 远程抓图上传成功');
  console.log(`   file: ${fetched.fileUrl}`);
  console.log(`   content-type: ${fetched.contentType || 'unknown'}`);

  console.log('COS 冒烟通过。');
}

run().catch((error) => {
  console.error(`COS 冒烟失败: ${error.message || error}`);
  process.exit(1);
});
