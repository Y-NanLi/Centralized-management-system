import { all, get, run } from '../db.js';
import { audit } from '../auth.js';
import { bad, notFound, str, num, nowISO } from '../util.js';
import { saveUpload, nextNo, STATUSES, TYPE_LABEL } from '../service.js';

export function register(router) {
  /* ---------- 游客公开信息（不含电子章与文件） ---------- */
  router.get('/api/public/bootstrap', () => ({
    companies: all('SELECT id,code,name,short_name,addr,rep,phone,fax FROM companies ORDER BY id'),
    types: Object.entries(TYPE_LABEL).map(([key, label]) => ({ key, label })),
  }), { auth: false });

  /* ---------- 元数据 ---------- */
  router.get('/api/meta', () => ({
    types: Object.entries(TYPE_LABEL).map(([key, label]) => ({ key, label })),
    statuses: Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [k, v.map(([key, label]) => ({ key, label }))])),
    roles: [
      { key: 'admin', label: '管理员' },
      { key: 'manager', label: '主管' },
      { key: 'sales', label: '业务员' },
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
    const like = `%${q}%`;
    const where = q ? 'WHERE c.name LIKE ? OR c.contact LIKE ? OR c.phone LIKE ? OR c.addr LIKE ?' : '';
    const rows = all(`SELECT c.*,
        (SELECT COUNT(*) FROM documents d WHERE d.customer_id=c.id) AS doc_count,
        (SELECT COALESCE(SUM(d.amount),0) FROM documents d WHERE d.customer_id=c.id AND d.status NOT IN ('canceled','closed')) AS total_amount,
        (SELECT MAX(d.doc_date) FROM documents d WHERE d.customer_id=c.id) AS last_date
      FROM customers c ${where}
      ORDER BY c.updated_at DESC LIMIT 500`, ...(q ? [like, like, like, like] : []));
    return rows;
  });

  router.get('/api/customers/:id', (ctx) => {
    const c = get('SELECT * FROM customers WHERE id=?', Number(ctx.params.id));
    if (!c) throw notFound('客户不存在');
    const docs = all(`SELECT d.id,d.doc_no,d.type,d.status,d.doc_date,d.amount,d.title
      FROM documents d WHERE d.customer_id=? ORDER BY d.doc_date DESC, d.id DESC LIMIT 100`, c.id);
    const stats = {
      documents: docs.length,
      contract_amount: all("SELECT COALESCE(SUM(amount),0) AS s FROM documents WHERE customer_id=? AND type='contract' AND status<>'canceled'", c.id)[0].s,
      quote_count: all("SELECT COUNT(*) AS s FROM documents WHERE customer_id=? AND type='quote'", c.id)[0].s,
      delivery_count: all("SELECT COUNT(*) AS s FROM documents WHERE customer_id=? AND type='delivery'", c.id)[0].s,
    };
    return { ...c, documents: docs, stats };
  });

  router.post('/api/customers', (ctx) => {
    const name = str(ctx.body.name, 100);
    if (!name) throw bad('客户名称不能为空');
    if (get('SELECT id FROM customers WHERE name=?', name)) throw bad('同名客户已存在');
    const id = run('INSERT INTO customers (name,addr,contact,phone,fax,tax_no,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      name, str(ctx.body.addr, 200), str(ctx.body.contact, 60), str(ctx.body.phone, 60), str(ctx.body.fax, 60),
      str(ctx.body.tax_no, 60), str(ctx.body.note, 300), ctx.user.id, new Date().toISOString(), new Date().toISOString()).lastId;
    audit(ctx.user.id, 'customer.create', 'customer', name, ctx.req.socket.remoteAddress);
    return get('SELECT * FROM customers WHERE id=?', id);
  });

  router.put('/api/customers/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const c = get('SELECT * FROM customers WHERE id=?', id);
    if (!c) throw notFound('客户不存在');
    const name = str(ctx.body.name, 100) || c.name;
    const dup = get('SELECT id FROM customers WHERE name=? AND id<>?', name, id);
    if (dup) throw bad('已有同名客户');
    run('UPDATE customers SET name=?, addr=?, contact=?, phone=?, fax=?, tax_no=?, note=?, updated_at=? WHERE id=?',
      name, str(ctx.body.addr, 200), str(ctx.body.contact, 60), str(ctx.body.phone, 60), str(ctx.body.fax, 60),
      str(ctx.body.tax_no, 60), str(ctx.body.note, 300), new Date().toISOString(), id);
    return get('SELECT * FROM customers WHERE id=?', id);
  });

  router.del('/api/customers/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const c = get('SELECT * FROM customers WHERE id=?', id);
    if (!c) throw notFound('客户不存在');
    if (get('SELECT id FROM documents WHERE customer_id=? LIMIT 1', id)) throw bad('该客户已有单据，不能删除；可改为改名称');
    run('DELETE FROM customers WHERE id=?', id);
    audit(ctx.user.id, 'customer.delete', 'customer', c.name, ctx.req.socket.remoteAddress);
    return { ok: true };
  }, { roles: ['admin', 'manager'] });

  /* ---------- 货品 ---------- */
  router.get('/api/products', (ctx) => {
    const q = String(ctx.query.get('q') || '').trim();
    const like = `%${q}%`;
    return all(`SELECT * FROM products ${q ? 'WHERE name LIKE ? OR spec LIKE ? OR note LIKE ?' : ''}
      ORDER BY updated_at DESC LIMIT 1000`, ...(q ? [like, like, like] : []));
  });

  router.post('/api/products', (ctx) => {
    const name = str(ctx.body.name, 120);
    if (!name) throw bad('品名不能为空');
    const spec = str(ctx.body.spec, 120);
    if (get('SELECT id FROM products WHERE name=? AND spec=?', name, spec)) throw bad('同品名同型号已存在');
    const id = run('INSERT INTO products (name,spec,unit,price,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      name, spec, str(ctx.body.unit, 20), num(ctx.body.price), str(ctx.body.note, 200),
      new Date().toISOString(), new Date().toISOString()).lastId;
    return get('SELECT * FROM products WHERE id=?', id);
  });

  router.put('/api/products/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const p = get('SELECT * FROM products WHERE id=?', id);
    if (!p) throw notFound('货品不存在');
    run('UPDATE products SET name=?, spec=?, unit=?, price=?, note=?, updated_at=? WHERE id=?',
      str(ctx.body.name, 120) || p.name, str(ctx.body.spec, 120), str(ctx.body.unit, 20),
      num(ctx.body.price), str(ctx.body.note, 200), new Date().toISOString(), id);
    return get('SELECT * FROM products WHERE id=?', id);
  });

  router.del('/api/products/:id', (ctx) => {
    run('DELETE FROM products WHERE id=?', Number(ctx.params.id));
    return { ok: true };
  }, { roles: ['admin', 'manager'] });

  /* ---------- 数据导出 ---------- */
  router.get('/api/export/backup', () => {
    const docs = all(`SELECT id,doc_no,type,status,company_id,customer_id,owner_id,doc_date,amount,tax_rate,
      title,remark,payload,parent_id,root_id,created_at,updated_at FROM documents ORDER BY id`);
    return {
      kind: 'jizhong-backup',
      version: 1,
      at: nowISO(),
      companies: all('SELECT * FROM companies ORDER BY id'),
      customers: all('SELECT * FROM customers ORDER BY id'),
      products: all('SELECT * FROM products ORDER BY id'),
      documents: docs.map((d) => ({ ...d, payload: JSON.parse(d.payload || '{}') })),
      note: '本文件只含结构化数据；上传的文件实体请一并备份 data/files 目录。',
    };
  }, { roles: ['admin', 'manager'] });

  /* ---------- 编号预览 ---------- */  router.get('/api/number/next', (ctx) => {
    const type = String(ctx.query.get('type') || 'quote');
    const companyId = num(ctx.query.get('company_id'));
    const company = get('SELECT * FROM companies WHERE id=?', companyId) || get('SELECT * FROM companies ORDER BY id LIMIT 1');
    // 只预览，不落序号；正式创建时由事务分配
    const now = new Date();
    const p2 = (x) => String(x).padStart(2, '0');
    const day = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`;
    const tc = type === 'quote' ? 'BJ' : type === 'contract' ? 'HT' : 'XS';
    const row = get('SELECT n FROM number_seq WHERE key=?', `${company.code.toUpperCase()}-${tc}-${day}`);
    return { doc_no: `${company.code.toUpperCase()}-${tc}-${day}-${String((row ? row.n : 0) + 1).padStart(3, '0')}` };
  });
}
