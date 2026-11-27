import { all, get, run } from '../db.js';
import { hashPassword } from '../password.js';
import { audit } from '../auth.js';
import { bad, notFound, forbidden } from '../util.js';

const ROLES = ['admin', 'manager', 'sales'];

export function register(router) {
  router.get('/api/users', () => all(
    "SELECT id,username,name,role,phone,active,created_at,updated_at FROM users WHERE role<>'guest' ORDER BY id"
  ), { roles: ['admin'] });

  router.post('/api/users', (ctx) => {
    const username = String(ctx.body.username || '').trim();
    const name = String(ctx.body.name || '').trim();
    const role = ROLES.includes(ctx.body.role) ? ctx.body.role : 'sales';
    const password = String(ctx.body.password || '');
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) throw bad('账号只能是 2–32 位字母、数字、下划线');
    if (password.length < 6) throw bad('密码至少 6 位');
    if (get('SELECT id FROM users WHERE username=?', username)) throw bad('账号已存在');
    const id = run('INSERT INTO users (username,name,password,role,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
      username, name || username, hashPassword(password), role, String(ctx.body.phone || ''),
      new Date().toISOString(), new Date().toISOString()).lastId;
    audit(ctx.user.id, 'user.create', 'user', `${username}/${role}`, ctx.req.socket.remoteAddress);
    return get('SELECT id,username,name,role,phone,active FROM users WHERE id=?', id);
  }, { roles: ['admin'] });

  router.put('/api/users/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const u = get('SELECT * FROM users WHERE id=?', id);
    if (!u) throw notFound('用户不存在');
    const role = ROLES.includes(ctx.body.role) ? ctx.body.role : u.role;
    if (u.role === 'admin' && role !== 'admin' && all("SELECT id FROM users WHERE role='admin' AND active=1").length <= 1) {
      throw bad('至少要保留一个管理员');
    }
    run('UPDATE users SET name=?, role=?, phone=?, active=?, updated_at=? WHERE id=?',
      String(ctx.body.name || u.name), role, String(ctx.body.phone == null ? u.phone : ctx.body.phone),
      ctx.body.active == null ? u.active : (ctx.body.active ? 1 : 0), new Date().toISOString(), id);
    if (ctx.body.password) {
      if (String(ctx.body.password).length < 6) throw bad('密码至少 6 位');
      run('UPDATE users SET password=? WHERE id=?', hashPassword(String(ctx.body.password)), id);
    }
    audit(ctx.user.id, 'user.update', 'user', String(id), ctx.req.socket.remoteAddress);
    return get('SELECT id,username,name,role,phone,active FROM users WHERE id=?', id);
  }, { roles: ['admin'] });

  router.del('/api/users/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (id === ctx.user.id) throw forbidden('不能删除自己');
    const u = get('SELECT * FROM users WHERE id=?', id);
    if (!u) throw notFound('用户不存在');
    if (u.role === 'admin' && all("SELECT id FROM users WHERE role='admin' AND active=1").length <= 1) throw bad('至少要保留一个管理员');
    run('UPDATE users SET active=0, updated_at=? WHERE id=?', new Date().toISOString(), id);
    audit(ctx.user.id, 'user.disable', 'user', String(id), ctx.req.socket.remoteAddress);
    return { ok: true };
  }, { roles: ['admin'] });
}
