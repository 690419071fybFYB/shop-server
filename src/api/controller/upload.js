const Base = require("./base.js");
const fs = require("fs");

module.exports = class extends Base {
  async uploadAvatarAction() {
    const file = this.file('upload_file');
    if (think.isEmpty(file)) {
      return this.fail("保存失败");
    }
    if (!file.type || file.type.indexOf('image/') !== 0) {
      return this.fail("仅支持图片上传");
    }
    try {
      const ossService = this.service('oss');
      const uploaded = await ossService.uploadLocalFile(file.path, file.type, 'avatar');
      const userId = this.getLoginUserId();
      if (userId > 0) {
        await this.model('user').where({ id: userId }).update({
          avatar: uploaded.url
        });
      }
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
