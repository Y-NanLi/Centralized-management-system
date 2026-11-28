import { all, get, run } from '../db.js';
import { audit } from '../auth.js';
import { bad, notFound, forbidden, str } from '../util.js';
import { normalizeUsername } from '../username.js';

const ROLES = ['admin', 'manager', 'sales'];

export function register(router) {
  router.get('/api/users', () => all(
    "SELECT id,username,name,role,phone,active,created_at,updated_at FROM users WHERE role<>'guest' ORDER BY id"
  ), { roles: ['admin'] });

  /* 管理员查看“所有人工作台”的成员选择器：含已有数据的游客 */
  router.get('/api/owners', () => all(`
    SELECT u.id,u.username,u.name,u.role,u.active,
      (SELECT COUNT(*) FROM documents d WHERE d.owner_id=u.id) AS doc_count,
      (SELECT COUNT(*) FROM customers c WHERE c.created_by=u.id) AS customer_count,
      (SELECT COUNT(*) FROM products p WHERE p.owner_id=u.id) AS product_count,
      (SELECT COUNT(*) FROM files f WHERE f.owner_id=u.id) AS file_count
    FROM users u
    WHERE u.role<>'guest'
       OR EXISTS (SELECT 1 FROM documents d WHERE d.owner_id=u.id)
       OR EXISTS (SELECT 1 FROM customers c WHERE c.created_by=u.id)
       OR EXISTS (SELECT 1 FROM products p WHERE p.owner_id=u.id)
       OR EXISTS (SELECT 1 FROM files f WHERE f.owner_id=u.id)
    ORDER BY CASE WHEN u.role='guest' THEN 1 ELSE 0 END, u.id
  `).map((u) => ({ ...u, display_name: u.role === 'guest' ? '游客 #' + u.id : (u.name || u.username) })), { roles: ['admin'] });

  router.post('/api/users', (ctx) => {
    const username = normalizeUsername(ctx.body.username);
    const name = str(ctx.body.name, 40) || username;
    const role = ROLES.includes(ctx.body.role) ? ctx.body.role : 'sales';
    if (get('SELECT id FROM users WHERE username=?', username)) throw bad('用户名已存在');
    const now = new Date().toISOString();
    const id = run('INSERT INTO users (username,name,password,role,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
      username, name, '', role, str(ctx.body.phone, 60), now, now).lastId;
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
      str(ctx.body.name, 40) || u.name, role, str(ctx.body.phone == null ? u.phone : ctx.body.phone, 60),
      ctx.body.active == null ? u.active : (ctx.body.active ? 1 : 0), new Date().toISOString(), id);
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
