const Base = require("./base.js");
const fs = require("fs");
const path = require("path");

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

module.exports = class extends Base {
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
      const ossService = this.service('oss');
      const uploaded = await ossService.uploadLocalFile(file.path, mimeType || 'image/jpeg', 'avatar');
      await this.model('user').where({ id: userId }).update({
        avatar: uploaded.url
      });
      return this.success({
        name: uploaded.key,
        fileUrl: uploaded.url,
      });
    } catch (error) {
      console.error('头像上传失败:', error);
      return this.fail("头像上传失败");
    } finally {
      if (file.path) {
        fs.unlink(file.path, () => {});
      }
    }
  }

  // async deleteFileAction() {
  //     const url = this.post('para');
  //     let newUrl = url.lastIndexOf("/");
  //     let fileName = url.substring(newUrl + 1);
  //     let delePath = './www/static/upload/goods/detail/' + fileName;
  //     fs.unlink(delePath, function (err) {
  //         if (err) throw err;
  //         return false;
  //     });
  //     return this.success('文件删除成功');
  // }
};
