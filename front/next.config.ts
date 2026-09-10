import type { NextConfig } from "next";

// 读取服务器配置
const serverConfig = require('./server.config.js');
const enableDevProxy = process.env.NEXT_DEV_PROXY === 'true';

const nextConfig: NextConfig = {
  // 本地文档识别最长允许 120 秒；开发代理需留出响应序列化余量，
  // 否则 Next.js 默认 30 秒会在 Docling 完成前返回 socket hang up。
  experimental: {
    proxyTimeout: 135_000,
  },

  // 将API配置暴露给客户端
  env: {
    API_BASE_URL: serverConfig.api.baseUrl,
    APP_NAME: serverConfig.app.name,
    APP_VERSION: serverConfig.app.version,
  },

  // 禁用图片优化（静态导出不支持）
  images: {
    unoptimized: true,
  },
};

if (enableDevProxy) {
  nextConfig.rewrites = async () => [
    {
      source: '/api/:path*',
      destination: `${serverConfig.api.proxyTarget}/api/:path*`,
    },
    {
      source: '/actuator/:path*',
      destination: `${serverConfig.api.proxyTarget}/actuator/:path*`,
    },
  ];
} else {
  nextConfig.output = 'export';
}

export default nextConfig;
