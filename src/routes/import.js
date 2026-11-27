import { get, run } from '../db.js';
import { audit } from '../auth.js';
import { bad, str, money, num, nowISO } from '../util.js';
import { createDocument, companyByCode, ensureCustomer } from '../service.js';

function mapCompany(v) {
  const s = String(v || '').toLowerCase();
  if (s.includes('yzl') || s.includes('悦智乐')) return 'yzl';
  if (s.includes('anc') || s.includes('安驰')) return 'ac';
  if (s.includes('jxt') || s.includes('捷信通')) return 'jxt';
  return 'jxt';
}

function fixDate(v) {
  const s = String(v || '').trim();
  const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return new Date().toISOString().slice(0, 10);
}

function collectCustomers(o) {
  const out = [];
  const push = (name, extra = {}) => {
    const n = str(name, 100);
    if (n) out.push({ name: n, ...extra });
  };
  if (Array.isArray(o.clients)) {
    for (const c of o.clients) {
      if (typeof c === 'string') push(c);
      else push(c.name, { addr: c.addr || c.about || '', contact: c.contact || c.rep || '', phone: c.phone || '', fax: c.fax || '' });
    }
  } else if (o.clients && typeof o.clients === 'object') {
    for (const [name, v] of Object.entries(o.clients)) {
      push(name, { addr: (v && v.addr) || '', contact: (v && (v.rep || v.contact)) || '', phone: (v && v.phone) || '' });
    }
  }
  return out;
}

function collectProducts(o) {
  const rows = [];
  const push = (spec, name, unit, price) => {
    if (!str(name) && !str(spec)) return;
    rows.push({ spec: str(spec, 120), name: str(name, 120), unit: str(unit, 20), price: money(price) });
  };
  const list = o.prod || (o.products && (o.products.t || o.products.rows || o.products)) || null;
  if (Array.isArray(list)) {
    for (const p of list) {
      if (Array.isArray(p)) push(p[0], p[1], p[2], p[3]);
      else if (p && typeof p === 'object') push(p.spec, p.name, p.unit, p.price);
    }
  }
  if (o.library && typeof o.library === 'object' && !Array.isArray(o.library)) {
    for (const [spec, v] of Object.entries(o.library)) {
      if (v && typeof v === 'object') push(spec, v.name, v.unit, v.price);
    }
  }
  return rows;
}

function collectDocs(o) {
  const docs = [];
  if (Array.isArray(o.recs)) {
    for (const r of o.recs) {
      if (!r) continue;
      if (r.st) docs.push({ type: 'contract', data: r.st, name: r.no });
      else if (r.data) docs.push({ type: r.data.dtype ? 'delivery' : 'quote', data: r.data, name: r.name });
    }
  }
  if (Array.isArray(o.records)) {
    for (const r of o.records) {
      if (r && r.data) docs.push({ type: 'delivery', data: r.data, name: r.name });
    }
  }
  if (!docs.length && o.st && Array.isArray(o.st.items)) docs.push({ type: 'contract', data: o.st });
  if (!docs.length && Array.isArray(o.items) && (o.no || o.cust)) {
    docs.push({ type: o.dtype ? 'delivery' : 'quote', data: o });
  }
  return docs;
}

function docPayload(type, data, docNo) {
  const company = mapCompany(data.company || 'jxt');
  if (type === 'contract') {
    return {
      ...data,
      company,
      cust: Object.assign({ name: '', addr: '', rep: '', phone: '' }, data.cust || {}),
      items: (data.items || []).map((it) => ({ name: it.name || '', spec: it.spec || '', qty: it.qty == null ? '' : String(it.qty), price: it.price == null ? '' : String(it.price) })),
      no: data.no || docNo,
    };
  }
  if (type === 'delivery') {
    return {
      company,
      no: data.no || docNo,
      date: fixDate(data.date),
      dtype: data.dtype || '送货单',
      customer: data.customer || '',
      summary: data.summary || '',
      items: (data.items || []).map((it) => ({
        code: it.code || '', name: it.name || '', spec: it.spec || '', proj: it.proj || '',
        unit: it.unit || '', qty: it.qty == null ? '' : String(it.qty), pin: it.pin || '',
        contract: it.contract || '',
      })),
      showSign: true,
    };
  }
  return {
    ...data,
    company,
    no: data.no || docNo,
    cust: Object.assign({ name: '', contact: '', phone: '', fax: '', about: '' }, data.cust || {}),
    items: (data.items || []).map((it) => ({ name: it.name || '', spec: it.spec || '', qty: it.qty == null ? '' : String(it.qty), price: it.price == null ? '' : String(it.price) })),
  };
}

export function register(router) {
  router.post('/api/import/legacy', async (ctx) => {
    const ct = ctx.req.headers['content-type'] || '';
    let text = '';
    if (ct.startsWith('multipart/form-data')) {
      const form = await ctx.form();
      const f = (form || []).find((p) => p.filename);
      if (!f) throw bad('没有收到备份文件');
      text = f.data.toString('utf8');
    } else if (typeof ctx.body.data === 'string') {
      text = ctx.body.data;
    } else {
      text = JSON.stringify(ctx.body.payload || ctx.body);
    }

    let o;
    try { o = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw bad('不是有效的 JSON 备份文件'); }
    if (!o || typeof o !== 'object') throw bad('备份内容为空');

    const result = { customers: 0, products: 0, documents: 0, skipped: 0, errors: [] };

    for (const c of collectCustomers(o)) {
      try {
        if (!get('SELECT id FROM customers WHERE name=?', c.name)) {
          ensureCustomer(c.name, c);
          result.customers++;
        }
      } catch (e) { result.errors.push('客户 ' + c.name + '：' + e.message); }
    }

    for (const p of collectProducts(o)) {
      try {
        const old = get('SELECT id FROM products WHERE name=? AND spec=?', p.name, p.spec);
        if (!old) {
          run('INSERT INTO products (name,spec,unit,price,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
            p.name, p.spec, p.unit, p.price, '旧系统导入', nowISO(), nowISO());
          result.products++;
        }
      } catch (e) { result.errors.push('货品 ' + p.name + '：' + e.message); }
    }

    for (const d of collectDocs(o)) {
      const data = d.data || {};
      const docNo = str(data.no, 60);
      try {
        if (docNo && get('SELECT id FROM documents WHERE doc_no=?', docNo)) { result.skipped++; continue; }
        const payload = docPayload(d.type, data, docNo);
        const custName = (payload.cust && payload.cust.name) || payload.customer || '';
        if (custName) ensureCustomer(custName, {
          addr: payload.cust && payload.cust.addr, contact: payload.cust && (payload.cust.rep || payload.cust.contact), phone: payload.cust && payload.cust.phone,
        }, ctx.user.id);
        const doc = createDocument({
          type: d.type,
          company_id: companyByCode(payload.company).id,
          doc_date: fixDate(data.date),
          status: d.type === 'quote' ? 'sent' : d.type === 'contract' ? 'signed' : 'received',
          payload,
          doc_no: docNo,
          title: d.name || '',
          remark: data.remark || '',
          tax_rate: num(data.taxRate),
        }, ctx.user);
        result.documents++;
        if (result.documents === 1) result.first_doc = doc.doc_no;
      } catch (e) {
        result.skipped++;
        result.errors.push('单据 ' + (docNo || '(无编号)') + '：' + e.message);
      }
    }

    audit(ctx.user.id, 'import.legacy', 'backup', JSON.stringify(result), ctx.req.socket.remoteAddress);
    return result;
  }, { roles: ['admin', 'manager'] });
}
