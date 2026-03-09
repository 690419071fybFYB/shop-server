const Base = require("./base.js");
const fs = require("fs");
const path = require("path");
const mime = require('mime-types');

const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_AVATAR_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

function readFileHeader(filePath, length = 16) {
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

function isSupportedImageHeader(buffer) {
  if (!buffer || buffer.length < 12) {
    return false;
  }
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isGif =
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61;
  const isWebp =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;
  return isJpeg || isPng || isGif || isWebp;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeErrorMessage(error, fallback = 'unknown_error') {
  if (!error) return fallback;
  const message = String(error.message || error).trim();
  return message || fallback;
}

module.exports = class extends Base {
  async saveAvatarToLocal(file, mimeType) {
    const extByMime = mimeType ? (mime.extension(mimeType) || '') : '';
    const extByName = path.extname(file.name || file.originalFilename || '').replace('.', '').toLowerCase();
    const safeExt = (extByMime || extByName || 'jpg').replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
    const fileName = `${think.uuid(32)}.${safeExt}`;
    const dirPath = path.join(think.ROOT_PATH, 'www', 'static', 'upload', 'avatar');
    ensureDir(dirPath);
    const targetPath = path.join(dirPath, fileName);
    await fs.promises.copyFile(file.path, targetPath);
    return {
      key: `static/upload/avatar/${fileName}`,
      url: `/static/upload/avatar/${fileName}`
    };
  }

  async uploadAvatarAction() {
    const userId = this.getLoginUserId();
    if (userId <= 0) {
      return this.fail(401, "请先登录");
    }
    const file = this.file('upload_file');
    if (think.isEmpty(file)) {
      return this.fail("保存失败");
    }
    if (!file.path || Number(file.size || 0) <= 0) {
      return this.fail("文件为空");
    }
    if (Number(file.size || 0) > MAX_AVATAR_FILE_SIZE) {
      return this.fail("头像文件不能超过5MB");
    }
    const mimeType = String(file.type || '').toLowerCase();
    const ext = path.extname(file.name || file.originalFilename || '').toLowerCase();
    if (
      (mimeType && ALLOWED_AVATAR_MIME.indexOf(mimeType) === -1) &&
      (ext && ALLOWED_AVATAR_EXT.indexOf(ext) === -1)
    ) {
      return this.fail("仅支持图片上传");
    }
    const header = readFileHeader(file.path, 16);
    if (!isSupportedImageHeader(header)) {
      return this.fail("头像文件格式不支持");
    }
    try {
      let uploaded = null;
      try {
        const cosService = this.service('cos');
        uploaded = await cosService.uploadLocalFile(file.path, mimeType || 'image/jpeg', 'avatar');
      } catch (cosError) {
        // COS异常时降级到本地存储，避免真机头像上传流程阻塞
        const cosErrMsg = normalizeErrorMessage(cosError);
        think.logger && think.logger.error && think.logger.error(`[uploadAvatar][cos] ${cosErrMsg}`);
        if (cosError && cosError.stack) {
          think.logger && think.logger.error && think.logger.error(cosError.stack);
        }
        uploaded = await this.saveAvatarToLocal(file, mimeType || 'image/jpeg');
      }
      await this.model('user').where({ id: userId }).update({
        avatar: uploaded.url
      });
      return this.success({
        name: uploaded.key,
        fileUrl: uploaded.url,
      });
    } catch (error) {
      const errMsg = normalizeErrorMessage(error);
      console.error('头像上传失败:', error);
      // 向前端返回更具体的失败原因，避免只看到 errno=1000 难以排查
      return this.fail(`头像上传失败: ${errMsg}`);
    } finally {
      if (file.path) {
        fs.unlink(file.path, () => {});
      }
    }
  }

  async deleteFileAction() {
    return this.fail(404, '接口不存在');
  }
};
