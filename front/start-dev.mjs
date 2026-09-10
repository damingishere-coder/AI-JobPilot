import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 创建require函数来导入CommonJS模块
const require = createRequire(import.meta.url);

// 读取配置文件
const configPath = path.join(__dirname, 'server.config.js');
delete require.cache[require.resolve(configPath)];
const config = require(configPath);

// 获取开发环境配置
const port = config.port || 3000;
const hostname = config.development?.hostname || 'localhost';

// 直接使用当前项目安装的 Next.js CLI，避免 npx/shell 产生脱离托管的中间进程。
const nextCli = require.resolve('next/dist/bin/next');
const nextDev = spawn(process.execPath, [nextCli, 'dev', '-p', port.toString(), '-H', hostname], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    API_BASE_URL: config.api?.baseUrl ?? '',
    API_PROXY_TARGET: config.api?.proxyTarget || 'http://127.0.0.1:8888',
    NEXT_DEV_PROXY: 'true',
  }
});

nextDev.on('error', (error) => {
  console.error('启动失败:', error);
  process.exit(1);
});

nextDev.on('close', (code) => {
  process.exit(code);
});
