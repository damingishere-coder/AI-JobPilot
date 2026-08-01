/**
 * 前端应用配置文件
 * 用于配置应用的运行参数，替代 .env 文件
 */
module.exports = {
  // 服务器端口
  port: 6866,

  // 开发环境配置
  development: {
    // 是否开启 Turbopack
    turbo: true,
    // 是否自动打开浏览器
    open: true,
    // 绑定到 IPv4 避免在 Windows 上 ::1 权限问题
    hostname: '127.0.0.1',
  },

  // 生产环境配置
  production: {
    // 生产环境端口
    port: 6866,
    // 主机名
    hostname: '0.0.0.0',
  },

  // API 配置（如果需要在构建时使用）
  api: {
    // 浏览器侧默认使用同源 /api，这样本地开发只需要记住 http://localhost:6866
    baseUrl: process.env.API_BASE_URL ?? '',
    // Docker 开发容器内使用 http://backend:8888，本机开发使用 http://localhost:8888
    proxyTarget: process.env.API_PROXY_TARGET || 'http://localhost:8888',
  },

  // 其他自定义配置
  app: {
    name: '投递牛马',
    version: '1.3.0',
  }
}
