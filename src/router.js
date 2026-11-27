import { HttpError, json, notFound } from './util.js';
import { requireUser, requireRole } from './auth.js';

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler, opts = {}) {
    this.routes.push({
      method,
      segs: pattern.split('/').filter(Boolean),
      handler,
      auth: opts.auth !== false,
      roles: opts.roles || null,
    });
  }

  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  put(p, h, o) { this.add('PUT', p, h, o); }
  del(p, h, o) { this.add('DELETE', p, h, o); }

  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (r.segs.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < r.segs.length; i++) {
        const s = r.segs[i];
        if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(parts[i]);
        else if (s !== parts[i]) { ok = false; break; }
      }
      if (ok) return { route: r, params };
    }
    return null;
  }
}

export async function dispatch(req, res, url, body, raw) {
  const found = routerMatch(req.method, url.pathname);
  if (!found) throw notFound(`接口不存在：${req.method} ${url.pathname}`);
  const { route, params } = found;

  let user = null;
  if (route.auth) {
    user = requireUser(req, res, url);
    requireRole(user, route.roles);
  }

  const ctx = {
    req, res, url, params,
    query: url.searchParams,
    body: body || {},
    raw,
    user,
    // multipart 延迟解析，避免非上传接口白白解析
    form() {
      if (this._form) return this._form;
      const ct = req.headers['content-type'] || '';
      if (!ct.startsWith('multipart/form-data')) return null;
      // 动态导入，避免循环
      return import('./multipart.js').then((m) => {
        this._form = m.parseMultipart(raw, ct);
        return this._form;
      });
    },
  };

  const out = await route.handler(ctx);
  if (!res.headersSent) {
    json(res, 200, { ok: true, data: out === undefined ? null : out });
  }
}

let routerRef = null;
export function setRouter(r) { routerRef = r; }
function routerMatch(method, pathname) {
  if (!routerRef) throw new HttpError(500, '路由未初始化');
  return routerRef.match(method, pathname);
}
