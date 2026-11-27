import { get, run } from '../db.js';
import { hashPassword, verifyPassword } from '../password.js';
import {
  signToken, audit, getOrCreateGuest, guestCookieId, guestUser,
  mergeGuestData, clearGuestCookie,
} from '../auth.js';
import { bad, unauthorized } from '../util.js';

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, phone: u.phone });

export function register(router) {
  router.post('/api/auth/login', (ctx) => {
    const username = String(ctx.body.username || '').trim();
    const password = String(ctx.body.password || '');
    if (!username || !password) throw bad('请输入账号和密码');
    const u = get('SELECT * FROM users WHERE username=? AND role<>?', username, 'guest');
    if (!u || !u.active || !verifyPassword(password, u.password)) throw unauthorized('账号或密码不正确');
    audit(u.id, 'login', 'user', username, ctx.req.socket.remoteAddress);

    const gid = guestCookieId(ctx.req);
    const guest = gid ? guestUser(gid) : null;
    let merged = { documents: 0, files: 0, customers: 0 };
    if (guest) {
      merged = mergeGuestData(guest.id, u.id);
      if (merged.documents || merged.files || merged.customers) clearGuestCookie(ctx.res);
    }
    return { token: signToken(u), user: publicUser(u), merged };
  }, { auth: false });

  /* 免登录游客：发/复用持久化 cookie，返回一个仅本浏览器可见的游客账号 */
  router.get('/api/auth/guest', (ctx) => {
    const u = getOrCreateGuest(ctx.req, ctx.res);
    return { user: publicUser(u), guest: true };
  }, { auth: false });

  router.get('/api/auth/me', (ctx) => ({ user: ctx.user, guest: ctx.user.role === 'guest' }));

  router.put('/api/auth/password', (ctx) => {
    if (ctx.user.role === 'guest') throw bad('游客模式没有账号密码，请先登录');
    const oldPwd = String(ctx.body.old_password || '');
    const newPwd = String(ctx.body.password || '');
    if (newPwd.length < 6) throw bad('新密码至少 6 位');
    const u = get('SELECT * FROM users WHERE id=?', ctx.user.id);
    if (!verifyPassword(oldPwd, u.password)) throw bad('原密码不正确');
    run('UPDATE users SET password=?, updated_at=? WHERE id=?', hashPassword(newPwd), new Date().toISOString(), u.id);
    audit(u.id, 'password', 'user', '修改本人密码', ctx.req.socket.remoteAddress);
    return { ok: true };
  });
}
