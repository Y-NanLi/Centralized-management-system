import { get, run } from '../db.js';
import {
  signToken, audit, getOrCreateGuest, guestCookieId, guestUser,
  mergeGuestData, clearGuestCookie,
} from '../auth.js';
import { bad, unauthorized, str } from '../util.js';
import { normalizeUsername } from '../username.js';

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, phone: u.phone });

function consumeGuest(ctx, user) {
  const gid = guestCookieId(ctx.req);
  const guest = gid ? guestUser(gid) : null;
  if (!guest || guest.id === user.id) return { documents: 0, files: 0, customers: 0, products: 0 };
  const merged = mergeGuestData(guest.id, user.id);
  if (merged.documents || merged.files || merged.customers || merged.products) clearGuestCookie(ctx.res);
  return merged;
}

export function register(router) {
  /* 免密码登录：用户名就是身份 */
  router.post('/api/auth/login', (ctx) => {
    const username = String(ctx.body.username || '').trim();
    if (!username) throw bad('请输入用户名');
    const u = get("SELECT * FROM users WHERE username=? AND role<>'guest'", username);
    if (!u) throw unauthorized('用户名不存在，请先注册');
    if (!u.active) throw unauthorized('账号已停用，请联系管理员');
    audit(u.id, 'login', 'user', username, ctx.req.socket.remoteAddress);
    const merged = consumeGuest(ctx, u);
    return { token: signToken(u), user: publicUser(u), merged };
  }, { auth: false });

  /* 公开注册：默认业务员角色，注册后直接登录 */
  router.post('/api/auth/register', (ctx) => {
    const username = normalizeUsername(ctx.body.username);
    const name = str(ctx.body.name, 40) || username;
    const phone = str(ctx.body.phone, 60);
    if (get('SELECT id FROM users WHERE username=?', username)) throw bad('用户名已被占用，换一个');
    const now = new Date().toISOString();
    const id = run('INSERT INTO users (username,name,password,role,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
      username, name, '', 'sales', phone, now, now).lastId;
    const u = get('SELECT * FROM users WHERE id=?', id);
    audit(id, 'register', 'user', username, ctx.req.socket.remoteAddress);
    const merged = consumeGuest(ctx, u);
    return { token: signToken(u), user: publicUser(u), merged };
  }, { auth: false });

  /* 免登录游客：发/复用持久化 cookie，返回一个仅本浏览器可见的游客账号 */
  router.get('/api/auth/guest', (ctx) => {
    const u = getOrCreateGuest(ctx.req, ctx.res);
    return { user: publicUser(u), guest: true };
  }, { auth: false });

  router.get('/api/auth/me', (ctx) => ({ user: ctx.user, guest: ctx.user.role === 'guest' }));

  router.put('/api/auth/password', () => {
    throw bad('系统已改为免密码登录，不需要设置密码');
  });
}
