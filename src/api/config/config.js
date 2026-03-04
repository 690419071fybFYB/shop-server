// default config
module.exports = {
  // 可以公开访问的Controller
  publicController: [
    // 格式为controller
    'index',
    'catalog',
    'auth',
    'goods',
    'search',
    'region'
  ],

  // 可以公开访问的Action
  publicAction: [
    // 格式为： controller+action
    'cart/index',
    'cart/add',
    'cart/checked',
    'cart/update',
    'cart/delete',
    'cart/goodscount',
    'pay/notify'
  ],

  // 需要资料完整（昵称+手机号）的控制器
  profileRequiredController: [
    'order',
    'address',
    'footprint'
  ],

  // 需要资料完整（昵称+手机号）的具体动作
  profileRequiredAction: [
    'cart/checkout'
  ]
};
