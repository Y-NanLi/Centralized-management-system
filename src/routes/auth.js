import { get, run } from '../db.js';
import { hashPassword, verifyPassword } from '../password.js';
import { signToken, audit } from '../auth.js';
import { bad, unauthorized } from '../util.js';

export function register(router) {
  router.post('/api/auth/login', (ctx) => {
    const username = String(ctx.body.username || '').trim();
    const password = String(ctx.body.password || '');
    if (!username || !password) throw bad('请输入账号和密码');
    const u = get('SELECT * FROM users WHERE username=?', username);
    if (!u || !u.active || !verifyPassword(password, u.password)) throw unauthorized('账号或密码不正确');
    audit(u.id, 'login', 'user', username, ctx.req.socket.remoteAddress);
    return {
      token: signToken(u),
      user: { id: u.id, username: u.username, name: u.name, role: u.role, phone: u.phone },
    };
  }, { auth: false });

  router.get('/api/auth/me', (ctx) => ({ user: ctx.user }));

  router.put('/api/auth/password', (ctx) => {
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
