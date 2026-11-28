import { all, get, run } from '../db.js';
import { audit } from '../auth.js';
import { bad, notFound, forbidden, str, num, money } from '../util.js';
import { assertDocumentAccess, assertOwner, isWarehouse, requestedOwner } from '../scope.js';
import { softDeleteDocument } from '../recycle.js';
import {
  createDocument, companyById, customerName, docAmount, ensureCustomer,
  saveProducts, saveUpload, fileById, STATUSES, TYPE_LABEL, defaultPayload, nextAvailableNoFrom,
} from '../service.js';

function withPayload(row) {
  if (!row) return null;
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { payload = {}; }
  const { payload: _p, ...rest } = row;
  return { ...rest, payload };
}

/* 已派生下游单据后，只允许改状态、备注和附件；版式类字段不锁定 */
const LOCK_EXEMPT = new Set(['remark', 'showLogo', 'showSign', 'stamp', 'cols', 'meta']);
const NUMERIC_KEYS = new Set(['qty', 'price', 'taxRate', 'validDays', 'size', 'dx', 'dy', 'rot', 'ofs', 'fsTitle', 'fsInfo', 'fsItem']);
function canonical(value, key = '') {
  if (Array.isArray(value)) return value.map((x) => canonical(x, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k], k);
    return out;
  }
  if (typeof value === 'string' && NUMERIC_KEYS.has(key) && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}
function lockFingerprint(payload) {
  const clean = {};
  for (const k of Object.keys(payload || {})) {
    if (!LOCK_EXEMPT.has(k)) clean[k] = payload[k];
  }
  return JSON.stringify(canonical(clean));
}
function hasDownstream(id) {
  return !!get('SELECT id FROM documents WHERE parent_id=? AND deleted_at IS NULL LIMIT 1', id);
}

function docDetail(id, user) {
  const d = get(`SELECT d.*, c.name AS customer_name, c.addr AS customer_addr, c.contact AS customer_contact,
      c.phone AS customer_phone, c.fax AS customer_fax, co.code AS company_code, co.name AS company_name,
      u.name AS owner_name, u.role AS owner_role,
      wu.name AS warehouse_by_name, wu.username AS warehouse_by_username,
      ru.name AS warehouse_received_by_name, ru.username AS warehouse_received_by_username
    FROM documents d
    LEFT JOIN customers c ON c.id=d.customer_id
    LEFT JOIN companies co ON co.id=d.company_id
    LEFT JOIN users u ON u.id=d.owner_id
    LEFT JOIN users wu ON wu.id=d.warehouse_by
    LEFT JOIN users ru ON ru.id=d.warehouse_received_by
    WHERE d.id=? AND d.deleted_at IS NULL`, id);
  if (!d) throw notFound('单据不存在');
  assertDocumentAccess(user, d);
  const out = withPayload(d);
  // 送货单：未交仓库时制单人是自己；交仓库后显示“仓库”，仓库接收后显示接收人姓名；经办人是交单人
  if (out.type === 'delivery') {
    const p = out.payload;
    const owner = out.owner_name || out.owner_username || '';
    const w = out.warehouse_status || 'none';
    if (w === 'none') {
      p.maker = owner;
    } else if (w === 'pending') {
      p.maker = '仓库';
    } else {
      p.maker = out.warehouse_received_by_name || out.warehouse_received_by_username || '仓库';
    }
    const sender = out.warehouse_by_name || out.warehouse_by_username;
    if (sender) p.agent = sender;
  }
  out.files = all(`SELECT f.id,f.name,f.mime,f.size,f.category,df.category AS link_category,df.created_at
    FROM document_files df JOIN files f ON f.id=df.file_id
    WHERE df.document_id=? AND f.deleted_at IS NULL ORDER BY df.id DESC`, id);
  out.children = all(`SELECT id,doc_no,type,status,doc_date,amount,title FROM documents
    WHERE parent_id=? AND deleted_at IS NULL${isWarehouse(user) ? " AND type='delivery'" : ''} ORDER BY id`, id);
  out.downstream_count = out.children.length;
  out.locked = out.downstream_count > 0;
  out.parent = (d.parent_id && !isWarehouse(user)) ? get(`SELECT id,doc_no,type,status FROM documents
    WHERE id=? AND deleted_at IS NULL`, d.parent_id) : null;
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
    const quick = String(q.get('quick') || '');
    const pageSize = Math.min(100, Math.max(5, Number(q.get('page_size')) || 20));
    const where = ['d.deleted_at IS NULL'];
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
    if (quick === 'quote_no_contract') {
      where.push(`d.type='quote' AND d.status<>'closed' AND NOT EXISTS (SELECT 1 FROM documents x
        WHERE x.parent_id=d.id AND x.type='contract' AND x.deleted_at IS NULL)`);
    } else if (quick === 'contract_no_delivery') {
      where.push(`d.type='contract' AND d.status<>'canceled' AND NOT EXISTS (SELECT 1 FROM documents x
        WHERE x.parent_id=d.id AND x.type='delivery' AND x.deleted_at IS NULL)`);
    } else if (quick === 'delivery_pending') {
      where.push(`d.type='delivery' AND d.warehouse_status='pending'`);
    } else if (quick === 'delivery_received') {
      where.push(`d.type='delivery' AND d.warehouse_status='received'`);
    }
    const sqlWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';

    /* 先按业务链分组，再按“每组尽量整链放进同一页”的规则分页，保证同一链不跨页 */
    const groups = all(`SELECT COALESCE(NULLIF(d.root_id,0),d.id) AS gid, COUNT(*) AS c,
        MAX(d.doc_date) AS last_date, MAX(d.id) AS last_id
      FROM documents d
      LEFT JOIN customers c ON c.id=d.customer_id
      ${sqlWhere}
      GROUP BY gid
      ORDER BY last_date DESC, last_id DESC`, ...params);
    const pageGroups = [];
    let current = [];
    let used = 0;
    for (const g of groups) {
      if (current.length && used + Number(g.c) > pageSize) {
        pageGroups.push(current);
        current = [];
        used = 0;
      }
      current.push(g);
      used += Number(g.c);
    }
    if (current.length) pageGroups.push(current);
    const pages = Math.max(1, pageGroups.length);
    const page = Math.min(Math.max(1, num(q.get('page'), 1)), pages);
    const selected = pageGroups[page - 1] || [];
    const total = groups.reduce((s, g) => s + Number(g.c), 0);
    const gids = selected.map((g) => g.gid);
    const rows = gids.length ? all(`SELECT d.id,d.doc_no,d.type,d.status,d.warehouse_status,d.warehouse_at,
        d.doc_date,d.amount,d.title,d.customer_id,d.company_id,
        d.parent_id,d.root_id,d.created_at,d.updated_at,c.name AS customer_name,co.code AS company_code,co.name AS company_name,
        rd.doc_no AS root_doc_no, rd.type AS root_type,
        u.name AS owner_name, u.username AS owner_username,
        (SELECT COUNT(*) FROM documents x WHERE x.root_id=d.root_id AND x.deleted_at IS NULL) AS chain_size
      FROM documents d
      LEFT JOIN customers c ON c.id=d.customer_id
      LEFT JOIN companies co ON co.id=d.company_id
      LEFT JOIN users u ON u.id=d.owner_id
      LEFT JOIN documents rd ON rd.id=d.root_id
      ${sqlWhere} AND COALESCE(NULLIF(d.root_id,0),d.id) IN (${gids.map(() => '?').join(',')})
      ORDER BY d.doc_date DESC, d.id DESC`, ...params, ...gids) : [];
    return { items: rows, total, page, pages, page_size: pageSize };
  });

  router.get('/api/documents/:id', (ctx) => docDetail(Number(ctx.params.id), ctx.user));

  router.post('/api/documents', (ctx) => {
    const body = ctx.body || {};
    const type = ['quote', 'contract', 'delivery'].includes(body.type) ? body.type : 'quote';
    if (isWarehouse(ctx.user) && type !== 'delivery') throw forbidden('仓库账号不能新建报价单或合同');
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
    // 仓库自建送货单不需要等业务员提交或自己“接收”，创建后直接进入处理中
    if (isWarehouse(ctx.user) && type === 'delivery') {
      const now = new Date().toISOString();
      run(`UPDATE documents SET warehouse_status='received', warehouse_received_at=?, warehouse_received_by=?,
        updated_at=? WHERE id=?`, now, ctx.user.id, now, doc.id);
    }
    audit(ctx.user.id, 'doc.create', doc.doc_no, `${TYPE_LABEL[doc.type]} ${money(doc.amount)}`, ctx.req.socket.remoteAddress);
    return docDetail(doc.id, ctx.user);
  });

  router.put('/api/documents/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL', id);
    if (!d) throw notFound('单据不存在');
    assertDocumentAccess(ctx.user, d);
    const w = d.warehouse_status || 'none';
    if (d.type === 'delivery') {
      if (w === 'pending') throw bad('送货单已提交仓库，接收前只能撤回，不能编辑');
      if ((w === 'received' || w === 'done') && !isWarehouse(ctx.user)) throw forbidden('仓库流程中的送货单只能由仓库账号编辑');
    }
    const body = ctx.body || {};
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
    const no = str(body.doc_no, 60) || d.doc_no;
    const oldPayload = (() => {
      try { return JSON.parse(d.payload || '{}'); } catch { return {}; }
    })();

    /* 已生成下游单据：编号、日期、主体、客户、金额、明细、条款锁定，只允许改状态、备注和附件 */
    if (hasDownstream(id)) {
      const nextCompany = body.company_id == null ? d.company_id : num(body.company_id);
      const nextDate = str(body.doc_date, 20) || d.doc_date;
      const nextTax = body.tax_rate == null ? d.tax_rate : num(body.tax_rate);
      const nextAmount = payload ? docAmount(payload, d.type) : (body.amount == null ? d.amount : money(body.amount));
      const nextCustomer = body.customer_id == null ? d.customer_id : num(body.customer_id);
      const changed = [];
      if (payload && lockFingerprint(payload) !== lockFingerprint(oldPayload)) changed.push('客户/明细');
      if (nextCustomer !== d.customer_id) changed.push('客户');
      if (no !== d.doc_no) changed.push('编号');
      if (Number(nextCompany) !== Number(d.company_id)) changed.push('供货主体');
      if (nextDate !== d.doc_date) changed.push('日期');
      if (Number(nextTax) !== Number(d.tax_rate)) changed.push('税率');
      if (Number(nextAmount) !== Number(d.amount)) changed.push('金额');
      if (changed.length) {
        throw bad(`该单据已生成下游单据，${changed.join('、')}已锁定；只能修改状态、备注和附件。如需改价请先处理下游单据`);
      }
    }
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
    let storedPayload = d.payload;
    if (payload) storedPayload = JSON.stringify(payload);
    else if (body.remark != null && oldPayload && typeof oldPayload === 'object') {
      try {
        oldPayload.remark = str(body.remark, 500);
        storedPayload = JSON.stringify(oldPayload);
      } catch { /* 保持原 payload */ }
    }
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
      storedPayload,
      new Date().toISOString(), id);
    if (payload) saveProducts(payload.items || [], payload.items && payload.items[0] ? payload.items[0].unit : '', ownerId);
    audit(ctx.user.id, 'doc.update', no, TYPE_LABEL[d.type], ctx.req.socket.remoteAddress);
    return docDetail(id, ctx.user);
  });

  router.del('/api/documents/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL', id);
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    if (get('SELECT id FROM documents WHERE parent_id=? AND deleted_at IS NULL LIMIT 1', id)) throw bad('该单据已派生下游单据，不能删除；请先处理关联单据');
    softDeleteDocument(id, ctx.user.id);
    audit(ctx.user.id, 'doc.delete', d.doc_no, '移入回收站', ctx.req.socket.remoteAddress);
    return { ok: true, recycled: true };
  });

  router.post('/api/documents/:id/status', (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL', id);
    if (!d) throw notFound('单据不存在');
    assertOwner(ctx.user, d);
    const status = str(ctx.body.status, 20);
    const allowed = (STATUSES[d.type] || []).map(([k]) => k);
    if (!allowed.includes(status)) throw bad('状态不合法');
    run('UPDATE documents SET status=?, updated_at=? WHERE id=?', status, new Date().toISOString(), id);
    return docDetail(id, ctx.user);
  });

  router.post('/api/documents/:id/convert', (ctx) => {
    if (isWarehouse(ctx.user)) throw forbidden('仓库账号不能生成合同或报价单');
    const id = Number(ctx.params.id);
    const src = docDetail(id, ctx.user);
    assertOwner(ctx.user, src);
    const to = ctx.body.to;
    const mode = ctx.body.mode === 'overwrite' ? 'overwrite' : 'new';

    if (to === 'contract' && src.type === 'quote') {
      const existing = get(`SELECT * FROM documents WHERE parent_id=? AND type='contract' AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`, src.id);
      if (existing && mode === 'overwrite') {
        const delivery = get(`SELECT id,doc_no,warehouse_status FROM documents
          WHERE parent_id=? AND type='delivery' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`, existing.id);
        if (delivery) throw bad(`该销售合同已生成送货单 ${delivery.doc_no}，不能覆盖；请选择另存新合同`);
      }
      const q = src.payload;
      const p = defaultPayload('contract', { company: src.company_code ? src.company_code.toLowerCase() : 'jxt' });
      p.company = q.company || p.company;
      p.date = existing && mode === 'overwrite' ? String(existing.doc_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
      p.no = existing && mode === 'overwrite' ? existing.doc_no : (existing ? nextAvailableNoFrom(src.doc_no, src.company_code) : src.doc_no);
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

      if (mode === 'overwrite') {
        if (!existing) throw bad('没有可覆盖的销售合同，请选择另存新合同');
        run(`UPDATE documents SET company_id=?, customer_id=?, amount=?, tax_rate=?, title=?, remark=?, payload=?, updated_at=? WHERE id=?`,
          src.company_id, src.customer_id, docAmount(p, 'contract'), num(p.taxRate), `${p.cust.name} 销售合同`, p.remark,
          JSON.stringify(p), new Date().toISOString(), existing.id);
        audit(ctx.user.id, 'doc.convert.overwrite', `${src.doc_no} → ${existing.doc_no}`, '覆盖销售合同', ctx.req.socket.remoteAddress);
        return docDetail(existing.id, ctx.user);
      }

      const doc = createDocument({
        type: 'contract', company_id: src.company_id, customer_id: src.customer_id,
        doc_date: p.date, status: 'draft', payload: p, parent_id: src.id, root_id: src.root_id || src.id,
        title: `${p.cust.name} 销售合同`, remark: p.remark, owner_id: src.owner_id,
        doc_no: p.no, allow_duplicate_no: !existing,
      }, ctx.user);
      audit(ctx.user.id, 'doc.convert', `${src.doc_no} → ${doc.doc_no}`, existing ? '另存销售合同' : '报价单转合同', ctx.req.socket.remoteAddress);
      return docDetail(doc.id, ctx.user);
    }

    if (to === 'delivery' && ['contract', 'quote'].includes(src.type)) {
      const existing = get(`SELECT * FROM documents WHERE parent_id=? AND type='delivery' AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`, src.id);
      const linked = src.type === 'quote' ? get(`SELECT * FROM documents WHERE root_id=? AND type='delivery' AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`, src.root_id || src.id) : null;
      const hasAny = !!existing || !!linked;
      if (mode === 'overwrite' && existing && existing.warehouse_status && existing.warehouse_status !== 'none') {
        throw bad('已有送货单已进入仓库流程，不能覆盖，请选择另存新单');
      }
      const q = src.payload;
      const name = (q.cust && q.cust.name) || q.customer || src.customer_name || '';
      const p = defaultPayload('delivery', { company: src.company_code ? src.company_code.toLowerCase() : 'jxt' });
      p.company = q.company || p.company;
      p.date = existing && mode === 'overwrite' ? String(existing.doc_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
      p.no = existing && mode === 'overwrite' ? existing.doc_no : (hasAny ? nextAvailableNoFrom(src.doc_no, src.company_code) : src.doc_no);
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

      if (mode === 'overwrite') {
        if (!existing) throw bad('没有可覆盖的送货单，请选择另存新单');
        run(`UPDATE documents SET company_id=?, customer_id=?, amount=?, tax_rate=?, title=?, remark=?, payload=?, updated_at=? WHERE id=?`,
          src.company_id, src.customer_id, docAmount(p, 'delivery'), 0, `${name} 送货单`, '',
          JSON.stringify(p), new Date().toISOString(), existing.id);
        audit(ctx.user.id, 'doc.convert.overwrite', `${src.doc_no} → ${existing.doc_no}`, '覆盖送货单', ctx.req.socket.remoteAddress);
        return docDetail(existing.id, ctx.user);
      }

      const doc = createDocument({
        type: 'delivery', company_id: src.company_id, customer_id: src.customer_id,
        doc_date: p.date, status: 'draft', payload: p, parent_id: src.id, root_id: src.root_id || src.id,
        title: `${name} 送货单`, owner_id: src.owner_id,
        doc_no: p.no, allow_duplicate_no: !hasAny,
      }, ctx.user);
      audit(ctx.user.id, 'doc.convert', `${src.doc_no} → ${doc.doc_no}`, hasAny ? '另存送货单' : '转送货单', ctx.req.socket.remoteAddress);
      return docDetail(doc.id, ctx.user);
    }
    throw bad('不支持这种转换');
  });

  router.get('/api/documents/:id/chain', (ctx) => {
    const d = get('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL', Number(ctx.params.id));
    if (!d) throw notFound('单据不存在');
    assertDocumentAccess(ctx.user, d);
    const root = d.root_id || d.id;
    const rows = isWarehouse(ctx.user)
      ? all(`SELECT id,doc_no,type,status,doc_date,amount,title,parent_id,root_id
          FROM documents WHERE (id=? OR root_id=?) AND type='delivery' AND deleted_at IS NULL ORDER BY id`, root, root)
      : all(`SELECT id,doc_no,type,status,doc_date,amount,title,parent_id,root_id
          FROM documents WHERE (id=? OR root_id=?) AND deleted_at IS NULL ORDER BY id`, root, root);
    return { root_id: root, nodes: rows };
  });

  router.get('/api/documents/:id/files', (ctx) => {
    const d = get('SELECT id,owner_id,type,warehouse_status FROM documents WHERE id=? AND deleted_at IS NULL', Number(ctx.params.id));
    if (!d) throw notFound('单据不存在');
    assertDocumentAccess(ctx.user, d);
    return all(
      `SELECT f.id,f.name,f.mime,f.size,f.category,df.category AS link_category,df.created_at
       FROM document_files df JOIN files f ON f.id=df.file_id
       WHERE df.document_id=? AND f.deleted_at IS NULL ORDER BY df.id DESC`,
      Number(ctx.params.id));
  });

  router.post('/api/documents/:id/files', async (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT id,owner_id,type,warehouse_status FROM documents WHERE id=? AND deleted_at IS NULL', id);
    if (!d) throw notFound('单据不存在');
    assertDocumentAccess(ctx.user, d);
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
    const d = get('SELECT id,owner_id,type,warehouse_status FROM documents WHERE id=? AND deleted_at IS NULL', docId);
    if (!d) throw notFound('单据不存在');
    assertDocumentAccess(ctx.user, d);
    const fileId = Number(ctx.params.fileId);
    run('DELETE FROM document_files WHERE document_id=? AND file_id=?', docId, fileId);
    return { ok: true };
  });
}
