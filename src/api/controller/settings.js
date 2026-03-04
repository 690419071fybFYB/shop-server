const Base = require("./base.js");
const validator = require("../../common/utils/validate");
module.exports = class extends Base {
  async showSettingsAction() {
    let info = await this.model("show_settings")
      .where({
        id: 1,
      })
      .find();
    return this.success(info);
  }
  async saveAction() {
    const userId = this.getLoginUserId();
    if (userId <= 0) {
      return this.fail(401, "请先登录");
    }
    const name = validator.sanitizeText(this.post("name"), 32);
    const mobile = validator.sanitizeText(this.post("mobile"), 32);
    const nickName = validator.sanitizeText(this.post("nickName"), 64);
    const avatar = validator.sanitizeAvatarUrl(this.post("avatar"));
    if (!nickName || nickName === "微信用户") {
      return this.fail(400, "请输入有效昵称");
    }
    if (mobile && !validator.isValidMobile(mobile)) {
      return this.fail(400, "手机号格式错误");
    }
    let name_mobile = 0;
    if (name != "" && mobile != "") {
      name_mobile = 1;
    }
    const newbuffer = Buffer.from(nickName);
    let nickname = newbuffer.toString("base64");
    let data = {
      name: name,
      mobile: mobile,
      nickname: nickname,
      avatar: avatar || "/static/images/default_avatar.png",
      name_mobile: name_mobile,
    };
    let info = await this.model("user")
      .where({
        id: userId,
      })
      .update(data);
    return this.success(info);
  }
  async userDetailAction() {
    let userId = this.getLoginUserId();
    if (userId != 0) {
      let info = await this.model("user")
        .where({
          id: userId,
        })
        .field("id,mobile,name,nickname,avatar")
        .find();
      try {
        info.nickname = Buffer.from(info.nickname || "", "base64").toString();
      } catch (error) {
        info.nickname = "";
      }
      return this.success(info);
    }
    else{
      return this.fail(401,'请先登录')
    }
  }
};
