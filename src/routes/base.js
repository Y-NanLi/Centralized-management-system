import { all, get, run } from '../db.js';
import { audit } from '../auth.js';
import { bad, notFound, forbidden, str, num, nowISO } from '../util.js';
import { saveUpload, fileById, peekNextNo, STATUSES, TYPE_LABEL } from '../service.js';
import { assertOwner, requestedOwner } from '../scope.js';
import { APP_VERSION } from '../config.js';

export function register(router) {
  /* ---------- 游客公开信息（不含电子章与文件） ---------- */
  router.get('/api/public/bootstrap', () => ({
    companies: all('SELECT id,code,name,short_name,addr,rep,phone,fax FROM companies ORDER BY id'),
    types: Object.entries(TYPE_LABEL).map(([key, label]) => ({ key, label })),
  }), { auth: false });

  /* ---------- 元数据 ---------- */
  router.get('/api/meta', () => ({
    types: Object.entries(TYPE_LABEL).map(([key, label]) => ({ key, label })),
    version: APP_VERSION,
    statuses: Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [k, v.map(([key, label]) => ({ key, label }))])),
    roles: [
      { key: 'admin', label: '管理员' },
      { key: 'manager', label: '主管' },
      { key: 'sales', label: '业务员' },
      { key: 'warehouse', label: '仓库' },
    ],
  }));

  /* ---------- 公司主体 ---------- */
  router.get('/api/companies', () => all('SELECT * FROM companies ORDER BY id'));

  router.put('/api/companies/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const c = get('SELECT * FROM companies WHERE id=?', id);
    if (!c) throw notFound('公司主体不存在');
    run('UPDATE companies SET name=?, short_name=?, addr=?, rep=?, phone=?, fax=?, updated_at=? WHERE id=?',
      str(ctx.body.name, 120) || c.name, str(ctx.body.short_name, 40), str(ctx.body.addr, 200),
      str(ctx.body.rep, 40), str(ctx.body.phone, 60), str(ctx.body.fax, 60), new Date().toISOString(), id);
    audit(ctx.user.id, 'company.update', 'company', c.code, ctx.req.socket.remoteAddress);
    return get('SELECT * FROM companies WHERE id=?', id);
  }, { roles: ['admin', 'manager'] });

  router.post('/api/companies/:id/:kind', async (ctx) => {
    const id = Number(ctx.params.id);
    const kind = ctx.params.kind;
    if (!['logo', 'stamp'].includes(kind)) throw bad('只能上传 logo 或 stamp');
    const c = get('SELECT * FROM companies WHERE id=?', id);
    if (!c) throw notFound('公司主体不存在');
    const form = await ctx.form();
    const file = (form || []).find((p) => p.filename);
    if (!file) throw bad('没有收到文件');
    const fid = saveUpload(file, ctx.user.id, kind === 'logo' ? 'logo' : 'stamp');
    run(`UPDATE companies SET ${kind}_file_id=?, updated_at=? WHERE id=?`, fid, new Date().toISOString(), id);
    audit(ctx.user.id, `company.${kind}`, 'company', c.code, ctx.req.socket.remoteAddress);
    return get('SELECT * FROM companies WHERE id=?', id);
  }, { roles: ['admin', 'manager'] });

  /* ---------- 客户 ---------- */
  router.get('/api/customers', (ctx) => {
    const q = String(ctx.query.get('q') || '').trim();
    const owner = requestedOwner(ctx.user, ctx.query);
    const where = [];
    const params = [];
    if (owner) { where.push('c.created_by=?'); params.push(owner); }
    if (q) {
      where.push('(c.name LIKE ? OR c.contact LIKE ? OR c.phone LIKE ? OR c.addr LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = all(`SELECT c.*, u.name AS owner_name, u.username AS owner_username,
        (SELECT COUNT(*) FROM documents d WHERE d.customer_id=c.id AND d.deleted_at IS NULL) AS doc_count,
        (SELECT COALESCE(SUM(x.order_amount),0) FROM (
          SELECT COALESCE(MAX(CASE WHEN d.type='contract' AND d.status NOT IN ('canceled','closed') THEN d.amount END),
                          MAX(CASE WHEN d.type='quote' AND d.status NOT IN ('canceled','closed') THEN d.amount END), 0) AS order_amount
          FROM documents d
          WHERE d.customer_id=c.id AND d.deleted_at IS NULL
          GROUP BY COALESCE(NULLIF(d.root_id,0),d.id)
        ) x) AS total_amount,
        (SELECT MAX(d.doc_date) FROM documents d WHERE d.customer_id=c.id AND d.deleted_at IS NULL) AS last_date
      FROM customers c LEFT JOIN users u ON u.id=c.created_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.updated_at DESC LIMIT 500`, ...params);
    return rows;
  });

  router.get('/api/customers/:id', (ctx) => {
    const c = get('SELECT * FROM customers WHERE id=?', Number(ctx.params.id));
    if (!c) throw notFound('客户不存在');
    assertOwner(ctx.user, c, 'created_by');
    const docs = all(`SELECT d.id,d.doc_no,d.type,d.status,d.doc_date,d.amount,d.title,u.name AS owner_name
      FROM documents d LEFT JOIN users u ON u.id=d.owner_id
      WHERE d.customer_id=? AND d.deleted_at IS NULL ORDER BY d.doc_date DESC, d.id DESC LIMIT 100`, c.id);
    const stats = {
      documents: docs.length,
      contract_amount: all(`SELECT COALESCE(SUM(x.amount),0) AS s FROM (
        SELECT MAX(d.amount) AS amount FROM documents d
        WHERE d.customer_id=? AND d.type='contract' AND d.status<>'canceled' AND d.deleted_at IS NULL
        GROUP BY COALESCE(NULLIF(d.root_id,0),d.id)
      ) x`, c.id)[0].s,
      quote_count: all("SELECT COUNT(*) AS s FROM documents WHERE customer_id=? AND type='quote' AND deleted_at IS NULL", c.id)[0].s,
      delivery_count: all("SELECT COUNT(*) AS s FROM documents WHERE customer_id=? AND type='delivery' AND deleted_at IS NULL", c.id)[0].s,
    };
    const files = all(`SELECT f.id,f.name,f.mime,f.size,f.category,cf.created_at
      FROM customer_files cf JOIN files f ON f.id=cf.file_id
      WHERE cf.customer_id=? AND f.deleted_at IS NULL ORDER BY f.id DESC`, c.id);
    return { ...c, documents: docs, stats, files };
  });

  router.post('/api/customers/:id/files', async (ctx) => {
    const id = Number(ctx.params.id);
    const c = get('SELECT * FROM customers WHERE id=?', id);
    if (!c) throw notFound('客户不存在');
    assertOwner(ctx.user, c, 'created_by');
    const form = await ctx.form();
    const files = (form || []).filter((p) => p.filename);
    if (!files.length) throw bad('没有收到文件');
    const added = [];
    for (const f of files) {
      const fid = saveUpload(f, c.created_by || ctx.user.id, 'customer');
      run('INSERT OR IGNORE INTO customer_files (customer_id,file_id,category,created_at) VALUES (?,?,?,?)',
        id, fid, 'customer', new Date().toISOString());
      added.push(fileById(fid));
    }
    audit(ctx.user.id, 'customer.file', String(id), `${files.length} 个文件`, ctx.req.socket.remoteAddress);
    return added;
  });

  router.del('/api/customers/:id/files/:fileId', (ctx) => {
    const id = Number(ctx.params.id);
    const c = get('SELECT * FROM customers WHERE id=?', id);
    if (!c) throw notFound('客户不存在');
    assertOwner(ctx.user, c, 'created_by');
    run('DELETE FROM customer_files WHERE customer_id=? AND file_id=?', id, Number(ctx.params.fileId));
    return { ok: true };
  });

  router.post('/api/customers', (ctx) => {
    const name = str(ctx.body.name, 100);
    if (!name) throw bad('客户名称不能为空');
    if (get('SELECT id FROM customers WHERE name=? AND created_by=?', name, ctx.user.id)) throw bad('同名客户已存在');
    const id = run('INSERT INTO customers (name,addr,contact,phone,fax,tax_no,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      name, str(ctx.body.addr, 200), str(ctx.body.contact, 60), str(ctx.body.phone, 60), str(ctx.body.fax, 60),
      str(ctx.body.tax_no, 60), str(ctx.body.note, 2000), ctx.user.id, new Date().toISOString(), new Date().toISOString()).lastId;
    audit(ctx.user.id, 'customer.create', 'customer', name, ctx.req.socket.remoteAddress);
    return get('SELECT * FROM customers WHERE id=?', id);
  });

  router.put('/api/customers/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const c = get('SELECT * FROM customers WHERE id=?', id);
    if (!c) throw notFound('客户不存在');
    assertOwner(ctx.user, c, 'created_by');
    const name = str(ctx.body.name, 100) || c.name;
    const dup = get('SELECT id FROM customers WHERE name=? AND created_by=? AND id<>?', name, c.created_by, id);
    if (dup) throw bad('已有同名客户');
    run('UPDATE customers SET name=?, addr=?, contact=?, phone=?, fax=?, tax_no=?, note=?, updated_at=? WHERE id=?',
      name, str(ctx.body.addr, 200), str(ctx.body.contact, 60), str(ctx.body.phone, 60), str(ctx.body.fax, 60),
      str(ctx.body.tax_no, 60), str(ctx.body.note, 2000), new Date().toISOString(), id);
    return get('SELECT * FROM customers WHERE id=?', id);
  });

  router.del('/api/customers/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const c = get('SELECT * FROM customers WHERE id=?', id);
    if (!c) throw notFound('客户不存在');
    assertOwner(ctx.user, c, 'created_by');
    if (get('SELECT id FROM documents WHERE customer_id=? LIMIT 1', id)) throw bad('该客户已有单据，不能删除；可改为改名称');
    run('DELETE FROM customers WHERE id=?', id);
    audit(ctx.user.id, 'customer.delete', 'customer', c.name, ctx.req.socket.remoteAddress);
    return { ok: true };
  }, { roles: ['admin', 'manager'] });

  /* ---------- 货品 ---------- */
  router.get('/api/products', (ctx) => {
    const q = String(ctx.query.get('q') || '').trim();
    // 货品库全系统共享；管理员仍可按创建人筛选，普通账号始终看全量
    const owner = ctx.user.role === 'admin' ? requestedOwner(ctx.user, ctx.query) : null;
    const where = [];
    const params = [];
    if (owner) { where.push('p.owner_id=?'); params.push(owner); }
    if (q) {
      where.push('(p.name LIKE ? OR p.spec LIKE ? OR p.note LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    return all(`SELECT p.*, u.name AS owner_name, u.username AS owner_username
      FROM products p LEFT JOIN users u ON u.id=p.owner_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.updated_at DESC LIMIT 1000`, ...params);
  });

  router.post('/api/products', (ctx) => {
    const name = str(ctx.body.name, 120);
    if (!name) throw bad('品名不能为空');
    const spec = str(ctx.body.spec, 120);
    if (get('SELECT id FROM products WHERE name=? AND spec=? LIMIT 1', name, spec)) throw bad('同品名同型号已存在');
    const id = run('INSERT INTO products (name,spec,unit,price,note,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      name, spec, str(ctx.body.unit, 20), num(ctx.body.price), str(ctx.body.note, 200),
      ctx.user.id, new Date().toISOString(), new Date().toISOString()).lastId;
    return get('SELECT * FROM products WHERE id=?', id);
  });

  router.put('/api/products/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const p = get('SELECT * FROM products WHERE id=?', id);
    if (!p) throw notFound('货品不存在');
    if (Number(p.owner_id) !== Number(ctx.user.id)) throw forbidden('只能修改自己创建的货品');
    const name = str(ctx.body.name, 120) || p.name;
    const spec = str(ctx.body.spec, 120);
    const dup = get('SELECT id FROM products WHERE name=? AND spec=? AND id<>?', name, spec, id);
    if (dup) throw bad('同品名同型号已存在');
    run('UPDATE products SET name=?, spec=?, unit=?, price=?, note=?, updated_at=? WHERE id=?',
      name, spec, str(ctx.body.unit, 20), num(ctx.body.price), str(ctx.body.note, 200), new Date().toISOString(), id);
    return get('SELECT * FROM products WHERE id=?', id);
  });

  router.del('/api/products/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const p = get('SELECT * FROM products WHERE id=?', id);
    if (!p) throw notFound('货品不存在');
    if (Number(p.owner_id) !== Number(ctx.user.id)) throw forbidden('只能删除自己创建的货品');
    run('DELETE FROM products WHERE id=?', id);
    return { ok: true };
  });

  /* ---------- 数据导出 ---------- */
  router.get('/api/export/backup', (ctx) => {
    const owner = requestedOwner(ctx.user, ctx.query);
    const where = ['deleted_at IS NULL'];
    const ownerParam = [];
    if (owner) { where.push('owner_id=?'); ownerParam.push(owner); }
    const docs = all(`SELECT id,doc_no,type,status,company_id,customer_id,owner_id,doc_date,amount,tax_rate,
      title,remark,payload,parent_id,root_id,created_at,updated_at FROM documents
      WHERE ${where.join(' AND ')} ORDER BY id`, ...ownerParam);
    return {
      kind: 'jizhong-backup',
      version: 1,
      at: nowISO(),
      companies: all('SELECT * FROM companies ORDER BY id'),
      customers: all(`SELECT * FROM customers${owner ? ' WHERE created_by=?' : ''} ORDER BY id`, ...(owner ? [owner] : [])),
      products: all(`SELECT * FROM products${ownerSql} ORDER BY id`, ...ownerParam),
      documents: docs.map((d) => ({ ...d, payload: JSON.parse(d.payload || '{}') })),
      note: '本文件只含结构化数据；上传的文件实体请一并备份 data/files 目录。',
    };
  }, { roles: ['admin', 'manager'] });

  /* ---------- 编号预览 ---------- */  router.get('/api/number/next', (ctx) => {
    const companyId = num(ctx.query.get('company_id'));
    const company = get('SELECT * FROM companies WHERE id=?', companyId) || get('SELECT * FROM companies ORDER BY id LIMIT 1');
    // 只预览，不落序号；正式创建时由事务分配
    return { doc_no: peekNextNo(company.code) };
  });
}
