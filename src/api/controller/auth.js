const Base = require("./base.js");
const rp = require("request-promise");
module.exports = class extends Base {
  async loginByWeixinAction() {
    // const code = this.post('code');
    const code = this.post("code");
    let currentTime = parseInt(new Date().getTime() / 1000);
    const clientIp = ""; // 暂时不记录 ip test git
    // 获取openid
    const options = {
      method: "GET",
      url: "https://api.weixin.qq.com/sns/jscode2session",
      qs: {
        grant_type: "authorization_code",
        js_code: code,
        secret: think.config("weixin.secret"),
        appid: think.config("weixin.appid"),
      },
    };
    let sessionData = await rp(options);
    sessionData = JSON.parse(sessionData);
    if (!sessionData.openid) {
      return this.fail("登录失败，openid无效");
    }
    // 根据openid查找用户是否已经注册
    let userId = await this.model("user")
      .where({
        weixin_openid: sessionData.openid,
      })
      .getField("id", true);
    let is_new = 0;
    const buffer = Buffer.from('微信用户');
    let nickname = buffer.toString("base64");
    if (think.isEmpty(userId)) {
      // 注册
      userId = await this.model("user").add({
        username: "微信用户" + think.uuid(6),
        password: sessionData.openid,
        register_time: currentTime,
        register_ip: clientIp,
        last_login_time: currentTime,
        last_login_ip: clientIp,
        mobile: "",
        weixin_openid: sessionData.openid,
        nickname: nickname,
        avatar:'/static/images/default_avatar.png'
      });
      is_new = 1;
    }
    sessionData.user_id = userId;
    // 更新登录信息
    await this.model("user")
      .where({
        id: userId,
      })
      .update({
        last_login_time: currentTime,
        last_login_ip: clientIp,
      });
    const newUserInfo = await this.model("user")
      .field("id,username,nickname, avatar")
      .where({
        id: userId,
      })
      .find();
    newUserInfo.nickname = Buffer.from(
      newUserInfo.nickname,
      "base64"
    ).toString();
    const TokenSerivce = this.service("token", "api");
    const sessionKey = await TokenSerivce.create(sessionData);
    if (think.isEmpty(newUserInfo) || think.isEmpty(sessionKey)) {
      return this.fail("登录失败4");
    }
    return this.success({
      token: sessionKey,
      userInfo: newUserInfo,
      is_new: is_new,
    });
  }
  async logoutAction() {
    return this.success();
  }
  async phoneNumberAction() {
    const code = this.post("code");
    const encryptedData = this.post("encryptedData");
    const iv = this.post("iv");
    const userId = this.getLoginUserId();
    if (!userId) {
      return this.fail(100, "未登录");
    }
    if (!code && !(encryptedData && iv)) {
      return this.fail(400, "缺少手机号授权参数");
    }
    const weixinService = this.service("weixin", "api");
    let mobile = "";
    if (code) {
      const result = await weixinService.getPhoneNumberByCode(code);
      if (result && Number(result.errcode || 0) === 0) {
        const phoneInfo = result.phone_info || {};
        mobile = phoneInfo.purePhoneNumber || phoneInfo.phoneNumber || "";
      }
    }
    if (!mobile && encryptedData && iv) {
      const token = this.ctx.header["x-hioshop-token"] || "";
      const tokenService = this.service("token", "api");
      const tokenInfo = tokenService.parse(token) || {};
      const sessionKey = tokenInfo.session_key || "";
      if (!sessionKey) {
        return this.fail(500, "登录会话失效，请重新登录");
      }
      const decryptInfo = await weixinService.decryptUserInfoData(
        sessionKey,
        encryptedData,
        iv
      );
      mobile =
        (decryptInfo && (decryptInfo.purePhoneNumber || decryptInfo.phoneNumber)) ||
        "";
    }
    if (!mobile) {
      return this.fail(500, "获取手机号失败");
    }
    await this.model("user")
      .where({ id: userId })
      .update({ mobile: mobile });
    return this.success({
      mobile: mobile,
    });
  }
};
