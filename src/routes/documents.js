import { all, get, run } from '../db.js';
import { audit } from '../auth.js';
import { bad, notFound, forbidden, str, num, money } from '../util.js';
import { assertOwner, requestedOwner } from '../scope.js';
import {
  createDocument, companyById, customerName, docAmount, ensureCustomer,
  saveProducts, saveUpload, fileById, STATUSES, TYPE_LABEL, defaultPayload,
} from '../service.js';

function withPayload(row) {
  if (!row) return null;
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { payload = {}; }
  const { payload: _p, ...rest } = row;
  return { ...rest, payload };
}

function docDetail(id, user) {
  const d = get(`SELECT d.*, c.name AS customer_name, c.addr AS customer_addr, c.contact AS customer_contact,
      c.phone AS customer_phone, c.fax AS customer_fax, co.code AS company_code, co.name AS company_name,
      u.name AS owner_name, u.role AS owner_role
    FROM documents d
    LEFT JOIN customers c ON c.id=d.customer_id
    LEFT JOIN companies co ON co.id=d.company_id
    LEFT JOIN users u ON u.id=d.owner_id
    WHERE d.id=?`, id);
  if (!d) throw notFound('单据不存在');
  assertOwner(user, d);
  const out = withPayload(d);
  out.files = all(`SELECT f.id,f.name,f.mime,f.size,f.category,df.category AS link_category,df.created_at
    FROM document_files df JOIN files f ON f.id=df.file_id WHERE df.document_id=? ORDER BY df.id DESC`, id);
  out.children = all(`SELECT id,doc_no,type,status,doc_date,amount,title FROM documents WHERE parent_id=? ORDER BY id`, id);
  out.parent = d.parent_id ? get('SELECT id,doc_no,type,status FROM documents WHERE id=?', d.parent_id) : null;
  return out;
}

export function register(router) {
  router.get('/api/documents', (ctx) => {
    const q = ctx.query;
    const type = q.get('type');
    const status = q.get('status');
    const keyword = String(q.get('q') || '').trim();
    const customerId = num(q.get('customer_id'));
    const companyId = num(q.get('company_id'));
    const from = q.get('from');
    const to = q.get('to');
    const page = Math.max(1, num(q.get('page'), 1));
    const pageSize = Math.min(100, Math.max(5, num(q.get('page_size'), 20)));
    const where = [];
    const params = [];
    const owner = requestedOwner(ctx.user, q);
    if (owner) { where.push('d.owner_id=?'); params.push(owner); }
    if (type) { where.push('d.type=?'); params.push(type); }
    if (status) { where.push('d.status=?'); params.push(status); }
    if (customerId) { where.push('d.customer_id=?'); params.push(customerId); }
    if (companyId) { where.push('d.company_id=?'); params.push(companyId); }
    if (from) { where.push('d.doc_date>=?'); params.push(from); }
    if (to) { where.push('d.doc_date<=?'); params.push(to); }
    if (keyword) {
      where.push('(d.doc_no LIKE ? OR d.title LIKE ? OR c.name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const sqlWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = get(`SELECT COUNT(*) AS c FROM documents d LEFT JOIN customers c ON c.id=d.customer_id ${sqlWhere}`, ...params).c;
    const rows = all(`SELECT d.id,d.doc_no,d.type,d.status,d.doc_date,d.amount,d.title,d.customer_id,d.company_id,
        d.parent_id,d.created_at,d.updated_at,c.name AS customer_name,co.code AS company_code,co.name AS company_name,
        u.name AS owner_name, u.username AS owner_username,
        (SELECT COUNT(*) FROM documents x WHERE x.root_id=d.root_id) AS chain_size
      FROM documents d
      LEFT JOIN customers c ON c.id=d.customer_id
      LEFT JOIN companies co ON co.id=d.company_id
      LEFT JOIN users u ON u.id=d.owner_id
      ${sqlWhere}
      ORDER BY d.doc_date DESC, d.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
    return { items: rows, total, page, page_size: pageSize };
  });

  router.get('/api/documents/:id', (ctx) => docDetail(Number(ctx.params.id), ctx.user));

  router.post('/api/documents', (ctx) => {
    const body = ctx.body || {};
    const type = ['quote', 'contract', 'delivery'].includes(body.type) ? body.type : 'quote';
    const payload = body.payload && typeof body.payload === 'object'
      ? body.payload
      : defaultPayload(type, { company: (companyById(num(body.company_id)) || {}).code });
    if (payload.cust && payload.cust.name) ensureCustomer(payload.cust.name, {
      addr: payload.cust.addr, contact: payload.cust.rep || payload.cust.contact, phone: payload.cust.phone,
    }, ctx.user.id);
    if (payload.customer) ensureCustomer(payload.customer, {}, ctx.user.id);
    const doc = createDocument({
      type, company_id: body.company_id, customer_id: body.customer_id,
      doc_date: body.doc_date, status: body.status || 'draft', tax_rate: body.tax_rate,
      title: body.title, remark: body.remark, payload, parent_id: body.parent_id, root_id: body.root_id,
      doc_no: body.doc_no,
    }, ctx.user);
    audit(ctx.user.id, 'doc.create', doc.doc_no, `${TYPE_LABEL[doc.type]} ${money(doc.amount)}`, ctx.req.socket.remoteAddress);
    return docDetail(doc.id, ctx.user);
  });

  router.put('/api/documents/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT * FROM documents WHERE id=?', id);
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    const body = ctx.body || {};
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
    const no = str(body.doc_no, 60) || d.doc_no;
    if (no !== d.doc_no && get('SELECT id FROM documents WHERE doc_no=? AND id<>?', no, id)) throw bad('单据编号已存在');
    const custName = payload ? ((payload.cust && payload.cust.name) || payload.customer || '') : '';
    const ownerId = d.owner_id || ctx.user.id;
    const customerId = payload
      ? (ensureCustomer(custName, {
        addr: payload.cust && payload.cust.addr,
        contact: payload.cust && (payload.cust.rep || payload.cust.contact),
        phone: payload.cust && payload.cust.phone,
      }, ownerId) || d.customer_id)
      : (body.customer_id == null ? d.customer_id : num(body.customer_id));
    const amount = payload ? docAmount(payload, d.type) : (body.amount == null ? d.amount : money(body.amount));
    run(`UPDATE documents SET doc_no=?, status=?, company_id=?, customer_id=?, doc_date=?, amount=?, tax_rate=?,
        title=?, remark=?, payload=?, updated_at=? WHERE id=?`,
      no,
      str(body.status, 20) || d.status,
      body.company_id == null ? d.company_id : num(body.company_id),
      customerId || null,
      str(body.doc_date, 20) || d.doc_date,
      amount,
      body.tax_rate == null ? d.tax_rate : num(body.tax_rate),
      str(body.title, 120) || d.title,
      body.remark == null ? d.remark : str(body.remark, 500),
      payload ? JSON.stringify(payload) : d.payload,
      new Date().toISOString(), id);
    if (payload) saveProducts(payload.items || [], payload.items && payload.items[0] ? payload.items[0].unit : '', ownerId);
    audit(ctx.user.id, 'doc.update', no, TYPE_LABEL[d.type], ctx.req.socket.remoteAddress);
    return docDetail(id, ctx.user);
  });

  router.del('/api/documents/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT * FROM documents WHERE id=?', id);
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    if (get('SELECT id FROM documents WHERE parent_id=? LIMIT 1', id)) throw bad('该单据已派生下游单据，不能直接删除；请先处理关联单据');
    run('DELETE FROM document_files WHERE document_id=?', id);
    run('DELETE FROM documents WHERE id=?', id);
    audit(ctx.user.id, 'doc.delete', d.doc_no, TYPE_LABEL[d.type], ctx.req.socket.remoteAddress);
    return { ok: true };
  }, { roles: ['admin', 'manager', 'guest'] });

  router.post('/api/documents/:id/status', (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT * FROM documents WHERE id=?', id);
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    const status = str(ctx.body.status, 20);
    const allowed = (STATUSES[d.type] || []).map(([k]) => k);
    if (!allowed.includes(status)) throw bad('状态不合法');
    run('UPDATE documents SET status=?, updated_at=? WHERE id=?', status, new Date().toISOString(), id);
    return docDetail(id, ctx.user);
  });

  router.post('/api/documents/:id/convert', (ctx) => {
    const id = Number(ctx.params.id);
    const src = docDetail(id, ctx.user);
    const to = ctx.body.to;
    if (to === 'contract' && src.type === 'quote') {
      const q = src.payload;
      const p = defaultPayload('contract', { company: src.company_code ? src.company_code.toLowerCase() : 'jxt' });
      p.company = q.company || p.company;
      p.date = new Date().toISOString().slice(0, 10);
      p.no = '';
      p.taxRate = q.taxRate == null ? 13 : q.taxRate;
      p.cust = {
        name: q.cust && q.cust.name || src.customer_name || '',
        addr: (q.cust && (q.cust.addr || q.cust.about)) || src.customer_addr || '',
        rep: (q.cust && (q.cust.contact || q.cust.rep)) || src.customer_contact || '',
        phone: (q.cust && q.cust.phone) || src.customer_phone || '',
      };
      p.self = Object.assign(p.self, q.self || {});
      p.items = (q.items || []).filter((it) => str(it.name) || str(it.spec));
      p.remark = q.remark || '';
      const doc = createDocument({
        type: 'contract', company_id: src.company_id, customer_id: src.customer_id,
        doc_date: p.date, status: 'draft', payload: p, parent_id: src.id, root_id: src.root_id || src.id,
        title: `${p.cust.name} 销售合同`, remark: p.remark, owner_id: src.owner_id,
      }, ctx.user);
      audit(ctx.user.id, 'doc.convert', `${src.doc_no} → ${doc.doc_no}`, '报价单转合同', ctx.req.socket.remoteAddress);
      return docDetail(doc.id, ctx.user);
    }
    if (to === 'delivery' && ['contract', 'quote'].includes(src.type)) {
      const q = src.payload;
      const name = (q.cust && q.cust.name) || q.customer || src.customer_name || '';
      const p = defaultPayload('delivery', { company: src.company_code ? src.company_code.toLowerCase() : 'jxt' });
      p.company = q.company || p.company;
      p.date = new Date().toISOString().slice(0, 10);
      p.no = '';
      p.dtype = '送货单';
      p.customer = name;
      p.items = (q.items || []).filter((it) => str(it.name) || str(it.spec)).map((it) => ({
        code: '', name: it.name || '', spec: it.spec || '', proj: '', unit: it.unit || '',
        qty: it.qty == null ? '' : String(it.qty), pin: '',
        contract: src.type === 'contract' ? src.doc_no : '',
      }));
      p.cust = {
        name: name,
        contact: (q.cust && (q.cust.contact || q.cust.rep)) || src.customer_contact || '',
        phone: (q.cust && q.cust.phone) || src.customer_phone || '',
        addr: (q.cust && (q.cust.addr || q.cust.about)) || src.customer_addr || '',
      };
      p.summary = '';
      const doc = createDocument({
        type: 'delivery', company_id: src.company_id, customer_id: src.customer_id,
        doc_date: p.date, status: 'draft', payload: p, parent_id: src.id, root_id: src.root_id || src.id,
        title: `${name} 送货单`, owner_id: src.owner_id,
      }, ctx.user);
      audit(ctx.user.id, 'doc.convert', `${src.doc_no} → ${doc.doc_no}`, '转送货单', ctx.req.socket.remoteAddress);
      return docDetail(doc.id, ctx.user);
    }
    throw bad('不支持这种转换');
  });

  router.get('/api/documents/:id/chain', (ctx) => {
    const d = get('SELECT * FROM documents WHERE id=?', Number(ctx.params.id));
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    const root = d.root_id || d.id;
    const rows = all(`SELECT id,doc_no,type,status,doc_date,amount,title,parent_id,root_id
      FROM documents WHERE id=? OR root_id=? ORDER BY id`, root, root);
    return { root_id: root, nodes: rows };
  });

  router.get('/api/documents/:id/files', (ctx) => {
    const d = get('SELECT id,owner_id FROM documents WHERE id=?', Number(ctx.params.id));
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    return all(
      `SELECT f.id,f.name,f.mime,f.size,f.category,df.category AS link_category,df.created_at
       FROM document_files df JOIN files f ON f.id=df.file_id WHERE df.document_id=? ORDER BY df.id DESC`,
      Number(ctx.params.id));
  });

  router.post('/api/documents/:id/files', async (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT id,owner_id FROM documents WHERE id=?', id);
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    const form = await ctx.form();
    const category = str(ctx.query.get('category'), 30) || 'attachment';
    const files = (form || []).filter((p) => p.filename);
    if (!files.length) throw bad('没有收到文件');
    const added = [];
    for (const f of files) {
      const fid = saveUpload(f, d.owner_id || ctx.user.id, category);
      run('INSERT OR IGNORE INTO document_files (document_id,file_id,category,created_at) VALUES (?,?,?,?)',
        id, fid, category, new Date().toISOString());
      added.push(fileById(fid));
    }
    audit(ctx.user.id, 'doc.file', String(id), `${files.length} 个文件`, ctx.req.socket.remoteAddress);
    return added;
  });

  router.del('/api/documents/:id/files/:fileId', (ctx) => {
    const docId = Number(ctx.params.id);
    const d = get('SELECT id,owner_id FROM documents WHERE id=?', docId);
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    const fileId = Number(ctx.params.fileId);
    run('DELETE FROM document_files WHERE document_id=? AND file_id=?', docId, fileId);
    return { ok: true };
  }, { roles: ['admin', 'manager', 'guest'] });
}
