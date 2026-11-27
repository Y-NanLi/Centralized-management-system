import crypto from 'node:crypto';
import { SECRET, TOKEN_TTL } from './config.js';
import { get, run } from './db.js';
import { nowISO, unauthorized, forbidden } from './util.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(user) {
  const payload = { uid: user.id, role: user.role, exp: Date.now() + TOKEN_TTL };
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (sig.length !== expect.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

function tokenFrom(req, url) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (url && url.searchParams.get('token')) return url.searchParams.get('token');
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return '';
}

export function currentUser(req, url) {
  const p = verifyToken(tokenFrom(req, url));
  if (!p) return null;
  const u = get('SELECT id,username,name,role,phone,active FROM users WHERE id=?', p.uid);
  if (!u || !u.active) return null;
  return u;
}

export function requireUser(req, url) {
  const u = currentUser(req, url);
  if (!u) throw unauthorized();
  return u;
}

export function requireRole(user, roles) {
  if (!roles || !roles.length) return;
  if (!roles.includes(user.role)) throw forbidden();
}

export function audit(userId, action, target, detail, ip) {
  try {
    run('INSERT INTO audit (user_id,action,target,detail,ip,created_at) VALUES (?,?,?,?,?,?)',
      userId || null, action, String(target || '').slice(0, 80), String(detail || '').slice(0, 500), String(ip || '').slice(0, 60), nowISO());
  } catch { /* 审计失败不影响业务 */ }
}
