import crypto from 'node:crypto';
import { SECRET, TOKEN_TTL } from './config.js';
import { get, run, tx } from './db.js';
import { hashPassword } from './password.js';
import { nowISO, unauthorized, forbidden } from './util.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

const GUEST_COOKIE = 'gid';
const GUEST_MAX_AGE = 60 * 60 * 24 * 365; // 一年，浏览器重启后仍是同一个游客
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(value);
  res.setHeader('Set-Cookie', list);
}

export function guestCookieId(req) {
  const id = readCookie(req, GUEST_COOKIE);
  return UUID_RE.test(id) ? id : '';
}

export function setGuestCookie(res, id, clear = false) {
  appendSetCookie(res, `${GUEST_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : GUEST_MAX_AGE}`);
}

export function guestUser(id) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const u = get("SELECT id,username,name,role,phone,active FROM users WHERE username=? AND role='guest'", 'guest:' + id);
  return u && u.active ? u : null;
}

/** 无 token 时按持久化 cookie 分配/复用游客身份（服务端有独立用户行，数据落在库里） */
export function getOrCreateGuest(req, res) {
  const old = guestCookieId(req);
  if (old) {
    const u = guestUser(old);
    if (u) return u;
  }
  const id = old || crypto.randomUUID();
  const username = 'guest:' + id;
  let existing = get("SELECT id,username,name,role,phone,active FROM users WHERE username=?", username);
  if (!existing) {
    try {
      run('INSERT INTO users (username,name,password,role,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
        username, '游客', hashPassword(crypto.randomUUID()), 'guest', '', nowISO(), nowISO());
    } catch { /* 并发下重查 */ }
    existing = get("SELECT id,username,name,role,phone,active FROM users WHERE username=?", username);
  }
  setGuestCookie(res, id);
  return existing;
}

export function clearGuestCookie(res) {
  setGuestCookie(res, '', true);
}

/** 登录时把该浏览器游客名下的单据、文件、客户来源合并到账号 */
export function mergeGuestData(guestUserId, userId) {
  const docs = get('SELECT COUNT(*) AS c FROM documents WHERE owner_id=?', guestUserId).c;
  const files = get('SELECT COUNT(*) AS c FROM files WHERE owner_id=?', guestUserId).c;
  const customers = get('SELECT COUNT(*) AS c FROM customers WHERE created_by=?', guestUserId).c;
  if (!docs && !files && !customers) return { documents: 0, files: 0, customers: 0 };
  tx(() => {
    run('UPDATE documents SET owner_id=? WHERE owner_id=?', userId, guestUserId);
    run('UPDATE files SET owner_id=? WHERE owner_id=?', userId, guestUserId);
    run('UPDATE customers SET created_by=? WHERE created_by=?', userId, guestUserId);
    run("DELETE FROM users WHERE id=? AND role='guest'", guestUserId);
  });
  return { documents: docs, files, customers };
}

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

export function currentUser(req, res, url) {
  const p = verifyToken(tokenFrom(req, url));
  if (p) {
    const u = get('SELECT id,username,name,role,phone,active FROM users WHERE id=?', p.uid);
    if (u && u.active && u.role !== 'guest') return u;
  }
  const gid = guestCookieId(req);
  if (gid) {
    const u = guestUser(gid);
    if (u) return u;
  }
  return null;
}

export function requireUser(req, res, url) {
  const u = currentUser(req, res, url);
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
