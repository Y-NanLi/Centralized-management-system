import http from 'node:http';
import { PORT, HOST } from './src/config.js';
import { handleApi } from './src/api.js';
import { serveStatic } from './src/static.js';

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
  console.log(`\n  集中管理系统已启动：http://localhost:${PORT}\n  默认管理员：admin / admin123（请登录后立即修改密码）\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n正在关闭服务…');
    server.close(() => process.exit(0));
  });
}
