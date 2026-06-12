const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 读取服务器配置
const serverConfig = require('../server.config.js');

// 生成 .env.local 文件
const envPath = path.join(__dirname, '../.env.local');
const port = serverConfig.port;
const hostname = 'localhost';

const envContent = `# 这个文件由启动脚本自动生成，请不要手动修改
PORT=${port}
HOSTNAME=${hostname}
API_BASE_URL=${serverConfig.api.baseUrl}
APP_NAME=${serverConfig.app.name}
APP_VERSION=${serverConfig.app.version}
`;

// 写入环境变量文件
fs.writeFileSync(envPath, envContent, 'utf-8');

console.log(`🔧 已从 server.config.js 加载配置:`);
console.log(`   端口: ${port}`);
console.log(`   主机: ${hostname}`);
console.log(`   API地址: ${serverConfig.api.baseUrl}`);

// 启动 Next.js，直接传递端口参数
const nextProcess = spawn('next', ['dev', '-p', port.toString()], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    API_BASE_URL: serverConfig.api.baseUrl ?? '',
    API_PROXY_TARGET: serverConfig.api.proxyTarget || 'http://localhost:8888',
    NEXT_DEV_PROXY: 'true',
    PORT: port.toString(),
    HOSTNAME: hostname
  }
});

nextProcess.on('close', (code) => {
  console.log(`Next.js 进程退出，代码: ${code}`);
});
