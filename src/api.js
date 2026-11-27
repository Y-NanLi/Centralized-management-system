import { Router, dispatch, setRouter } from './router.js';
import { HttpError, json } from './util.js';
import { MAX_UPLOAD } from './config.js';
import { register as authRoutes } from './routes/auth.js';
import { register as userRoutes } from './routes/users.js';
import { register as baseRoutes } from './routes/base.js';
import { register as docRoutes } from './routes/documents.js';
import { register as fileRoutes } from './routes/files.js';
import { register as dashRoutes } from './routes/dashboard.js';
import { register as importRoutes } from './routes/import.js';

const router = new Router();
authRoutes(router);
userRoutes(router);
baseRoutes(router);
docRoutes(router);
fileRoutes(router);
dashRoutes(router);
importRoutes(router);
setRouter(router);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD) {
      reject(new HttpError(413, `文件超过 ${Math.round(MAX_UPLOAD / 1024 / 1024)}MB 限制`, 'too_large'));
      req.destroy();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) {
        reject(new HttpError(413, `文件超过 ${Math.round(MAX_UPLOAD / 1024 / 1024)}MB 限制`, 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleApi(req, res, url) {
  try {
    const raw = await readBody(req);
    let body = {};
    const ct = String(req.headers['content-type'] || '');
    if (raw.length && ct.includes('application/json')) {
      try { body = JSON.parse(raw.toString('utf8')); } catch {
        throw new HttpError(400, 'JSON 格式错误', 'bad_json');
      }
    }
    await dispatch(req, res, url, body, raw);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[api]', e);
    if (!res.headersSent) {
      json(res, status, { ok: false, error: e.message || '服务器内部错误', code: e.code || 'error' });
    }
  }
}
