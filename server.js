import http from 'node:http';
import { PORT, HOST } from './src/config.js';
import { handleApi } from './src/api.js';
import { serveStatic } from './src/static.js';
import { purgeRecycleBin } from './src/recycle.js';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  集中管理系统已启动：http://localhost:${PORT}\n  管理员用户名：admin（免密码登录；普通用户可在登录页注册中文用户名）\n`);
});

try {
  const p = purgeRecycleBin();
  if (p.documents || p.files) console.log(`回收站已自动清理：单据 ${p.documents} 张、文件 ${p.files} 个`);
} catch (e) { console.error('回收站清理失败', e); }
setInterval(() => {
  try {
    const p = purgeRecycleBin();
    if (p.documents || p.files) console.log(`回收站已自动清理：单据 ${p.documents} 张、文件 ${p.files} 个`);
  } catch (e) { console.error('回收站清理失败', e); }
}, 6 * 60 * 60 * 1000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n正在关闭服务…');
    server.close(() => process.exit(0));
  });
}
