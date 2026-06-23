import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const configPath = path.join(__dirname, 'server.config.js');
delete require.cache[require.resolve(configPath)];
const config = require(configPath);

const port = config.production?.port || config.port || 6866;
const hostname = config.production?.hostname || '0.0.0.0';
const outDir = path.resolve(__dirname, 'out');

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

if (!fs.existsSync(outDir)) {
  console.error(`静态目录不存在: ${outDir}`);
  console.error('请先执行 pnpm build 或 pnpm build:prod。');
  process.exit(1);
}

function resolveStaticFile(requestUrl) {
  const url = new URL(requestUrl || '/', `http://${hostname}:${port}`);
  const rawPath = decodeURIComponent(url.pathname);
  const relativePath = rawPath.replace(/^\/+/, '') || 'index.html';
  const candidates = [
    path.resolve(outDir, relativePath),
    path.resolve(outDir, `${relativePath}.html`),
    path.resolve(outDir, relativePath, 'index.html'),
  ];

  for (const candidate of candidates) {
    if (isInsideOutDir(candidate) && isReadableFile(candidate)) {
      return candidate;
    }
  }

  const notFound = path.resolve(outDir, '404.html');
  return isReadableFile(notFound) ? notFound : path.resolve(outDir, 'index.html');
}

function isInsideOutDir(filePath) {
  return filePath === outDir || filePath.startsWith(`${outDir}${path.sep}`);
}

function isReadableFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function contentTypeFor(filePath) {
  return contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const filePath = resolveStaticFile(req.url);
  const exists = isReadableFile(filePath);
  res.writeHead(exists ? 200 : 404, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': 'no-store',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, hostname, () => {
  console.log(`投递牛马静态前端已启动: http://localhost:${port}`);
  console.log(`静态目录: ${outDir}`);
});

server.on('error', (error) => {
  console.error('启动静态服务失败:', error.message);
  process.exit(1);
});
