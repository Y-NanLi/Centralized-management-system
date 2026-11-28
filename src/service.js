import fs from 'node:fs';
import path from 'node:path';
import { FILES_DIR } from './config.js';
import { get, run, tx } from './db.js';
import { nowISO, num, money, sumItems, str, randomName, extOf, sha256, HttpError } from './util.js';

export const TYPE_LABEL = { quote: '报价单', contract: '销售合同', delivery: '送货单' };
export const TYPE_CODE = { quote: 'BJ', contract: 'HT' };

export const STATUSES = {
  quote: [['draft', '草稿'], ['sent', '已发出'], ['accepted', '已确认'], ['closed', '已关闭']],
  contract: [['draft', '草稿'], ['signed', '已签订'], ['delivering', '交货中'], ['completed', '已完成'], ['canceled', '已取消']],
  delivery: [['draft', '草稿'], ['sent', '已发货'], ['received', '已签收'], ['canceled', '已取消']],
};

export function companyById(id) {
  return get('SELECT * FROM companies WHERE id=?', id) || get('SELECT * FROM companies ORDER BY id LIMIT 1');
}

export function companyByCode(code) {
  return get('SELECT * FROM companies WHERE code=?', code)
    || get('SELECT * FROM companies ORDER BY id LIMIT 1');
}

/** 单据编号：公司代码 + 日期 + 三位流水，如 JXT-20261128001；同一公司同一天跨单据类型共用流水 */
function noKey(companyCode) {
  const code = String(companyCode || 'jxt').toUpperCase();
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, '0');
  return `${code}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
}

function nextNoValue(key) {
  const row = get('SELECT n FROM number_seq WHERE key=?', key);
  const last = get(`SELECT MAX(CAST(substr(doc_no, ?) AS INTEGER)) AS n FROM documents
    WHERE doc_no LIKE ?`, key.length + 1, `${key}%`);
  return Math.max(row ? row.n : 0, last && Number.isFinite(Number(last.n)) ? Number(last.n) : 0) + 1;
}

function formatNo(key, n) {
  return `${key}${String(n).padStart(3, '0')}`;
}

export function peekNextNo(companyCode) {
  const key = noKey(companyCode);
  return formatNo(key, nextNoValue(key));
}

/** 从指定单号往后找第一个没有被占用的编号，如 JXT-20261128001 → 002、003… */
export function nextAvailableNoFrom(docNo, companyCode) {
  const m = /^(.+?)(\d{3})$/.exec(String(docNo || '').trim());
  if (!m) return peekNextNo(companyCode);
  const key = m[1];
  let n = Number(m[2]) + 1;
  let candidate = formatNo(key, n);
  while (get('SELECT id FROM documents WHERE doc_no=? LIMIT 1', candidate)) {
    n += 1;
    candidate = formatNo(key, n);
  }
  return candidate;
}

export function nextNo(_type, companyCode, _subtype) {
  const key = noKey(companyCode);
  const n = nextNoValue(key);
  run('INSERT INTO number_seq (key,n) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET n=excluded.n', key, n);
  return formatNo(key, n);
}

export function ensureCustomer(name, extra = {}, userId) {
  const clean = str(name, 100);
  if (!clean) return null;
  const ownerId = num(userId) || null;
  const old = get('SELECT * FROM customers WHERE name=? AND created_by=?', clean, ownerId);
  if (old) {
    const patch = {};
    for (const k of ['addr', 'contact', 'phone', 'fax', 'tax_no']) {
      if (extra[k] && !old[k]) patch[k] = str(extra[k], 200);
    }
    if (Object.keys(patch).length) {
      run(`UPDATE customers SET ${Object.keys(patch).map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`,
        ...Object.values(patch), nowISO(), old.id);
    }
    return old.id;
  }
  return run('INSERT INTO customers (name,addr,contact,phone,fax,tax_no,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    clean, str(extra.addr, 200), str(extra.contact, 60), str(extra.phone, 60), str(extra.fax, 60), str(extra.tax_no, 60),
    ownerId, nowISO(), nowISO()).lastId;
}

export function saveProducts(items = [], unitDefault = '', ownerId = null) {
  const owner = num(ownerId) || null;
  const list = (items || []).filter((it) => str(it.name) && (str(it.spec) || str(it.unit)));
  for (const it of list) {
    const name = str(it.name, 120);
    const spec = str(it.spec, 120);
    const unit = str(it.unit, 20) || str(unitDefault, 20);
    const price = money(it.price);
    // 货品库全系统共享：同品名同型号只保留一条；别人的货品不自动改价，只有本人创建的才更新
    const own = owner ? get('SELECT id, owner_id FROM products WHERE name=? AND spec=? AND owner_id=? LIMIT 1', name, spec, owner) : null;
    const any = own || get('SELECT id, owner_id FROM products WHERE name=? AND spec=? ORDER BY id LIMIT 1', name, spec);
    if (own) {
      if (price > 0 || unit) {
        run('UPDATE products SET price=CASE WHEN ?>0 THEN ? ELSE price END, unit=CASE WHEN length(?)>0 THEN ? ELSE unit END, updated_at=? WHERE id=?',
          price, price, unit, unit, nowISO(), own.id);
      }
    } else if (!any && (price > 0 || unit)) {
      run('INSERT INTO products (name,spec,unit,price,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        name, spec, unit, price, owner, nowISO(), nowISO());
    }
  }
}

export function docAmount(payload = {}, type) {
  if (type === 'delivery') {
    return money((payload.items || []).reduce((s, it) => {
      const qty = Number(it.qty), price = Number(it.price);
      return s + (Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0);
    }, 0));
  }
  return sumItems(payload.items || []);
}

/** 保存上传文件到磁盘，返回文件记录 */
export function saveUpload(file, userId, category = 'other') {
  const original = str(file.filename || 'file', 200).replace(/[\\/]/g, '_');
  const ext = extOf(original);
  const sub = new Date().toISOString().slice(0, 7);
  const dir = path.join(FILES_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  const stored = randomName(ext.toLowerCase());
  const full = path.join(dir, stored);
  fs.writeFileSync(full, file.data);
  return run('INSERT INTO files (name,stored,mime,size,sha256,category,owner_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
    original, `${sub}/${stored}`, file.contentType || 'application/octet-stream', file.data.length,
    sha256(file.data), str(category, 30) || 'other', userId || null, nowISO()).lastId;
}

export function fileById(id) {
  return get('SELECT * FROM files WHERE id=?', id);
}

export function absFile(row) {
  return path.join(FILES_DIR, row.stored);
}

export function defaultPayload(type, opts = {}) {
  const company = opts.company || 'jxt';
  const base = { company, date: opts.date, no: opts.no, remark: '' };
  if (type === 'quote') {
    return {
      ...base, validDays: 1, taxRate: 13, taxMode: 'in',
      cust: { name: '', contact: '', phone: '', fax: '', about: '' },
      self: { name: '', phone: '', fax: '' },
      items: [{ name: '', spec: '', qty: '', price: '' }],
      terms: { delivery: '5个工作日', invoice: '以税率13%增值税发票', extra: [] },
      showSign: false, stamp: { on: false, size: 42, dx: 0, dy: 0, rot: 0 },
      cols: [7, 25, 28, 9, 15, 16],
      meta: { ofs: 0, fsTitle: 100, fsInfo: 100, fsItem: 100 },
    };
  }
  if (type === 'contract') {
    return {
      ...base, signDate: '', taxRate: 13,
      cust: { name: '', addr: '', rep: '', phone: '' },
      self: { name: '', addr: '', rep: '', phone: '' },
      items: [{ name: '', spec: '', qty: '', price: '' }],
      terms: [
        { id: 'effect', label: '', text: '本购销合同具有法律效力，签约双方必须全面履行，任何一方不得擅自变动或解除。若因不可预计因素变动或解除，应双方友好协商依法另立协议。', on: true },
        { id: 'delivery', label: '交货时间：', text: '款到发货', on: true },
        { id: 'pay', label: '付款方式：', text: '现结', on: true },
        { id: 'warranty', label: '保修期限：', text: '质保三年', on: true },
        { id: 'accept', label: '验收标准及提出异议期限：', text: '购货方收到货物后即可开箱验收，如有产品型号不符或质量问题，购货方在验货后一周内可提出异议并要求供货方更换。', on: true },
      ],
      termNumbered: false, showSign: true,
      stamp: { on: true, size: 40, dx: 18, dy: 0, rot: 0 },
      cols: [26, 34, 10, 15, 15],
      meta: { fsTitle: 100, fsInfo: 100, fsItem: 100, ofs: 0 },
    };
  }
  return {
    ...base, dtype: opts.dtype || '送货单', customer: '', summary: '',
    items: [{ code: '', name: '', spec: '', proj: '', unit: '', qty: '', pin: '', contract: '' }],
    showSign: true,
  };
}

export function createDocument(input, user) {
  return tx(() => {
    const type = ['quote', 'contract', 'delivery'].includes(input.type) ? input.type : 'quote';
    const company = companyById(num(input.company_id));
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : defaultPayload(type);
    // 主体信息兜底：客户从接口直接建单时也要有供货方抬头
    if (type === 'quote' || type === 'contract') {
      payload.self = payload.self || {};
      if (!payload.self.name) {
        payload.self.name = company.name;
        payload.self.addr = payload.self.addr || company.addr;
        payload.self.rep = payload.self.rep || company.rep;
        payload.self.phone = payload.self.phone || company.phone;
        payload.self.fax = payload.self.fax || company.fax;
      }
    }
    const custName = (payload.cust && payload.cust.name) || payload.customer || '';
    const ownerId = num(input.owner_id) || (user ? user.id : null);
    const customerId = num(input.customer_id) || ensureCustomer(custName, {
      addr: payload.cust && payload.cust.addr,
      contact: payload.cust && (payload.cust.rep || payload.cust.contact),
      phone: payload.cust && payload.cust.phone,
    }, ownerId);
    const no = str(input.doc_no, 60) || nextNo(type, company.code, payload.dtype);
    if (!input.allow_duplicate_no && get('SELECT id FROM documents WHERE doc_no=?', no)) {
      throw new HttpError(400, '单据编号已存在：' + no, 'duplicate_no');
    }
    payload.no = payload.no || no;
    const amount = input.amount != null ? money(input.amount) : docAmount(payload, type);
    const id = run(`INSERT INTO documents (doc_no,type,status,company_id,customer_id,owner_id,doc_date,amount,tax_rate,title,remark,payload,parent_id,root_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, type, str(input.status, 20) || 'draft', company.id, customerId || null, ownerId,
      str(input.doc_date, 20) || new Date().toISOString().slice(0, 10), amount, num(input.tax_rate),
      str(input.title, 120) || `${customerName(customerId)} ${TYPE_LABEL[type]}`.trim(),
      str(input.remark, 500), JSON.stringify(payload), num(input.parent_id) || null, num(input.root_id) || null,
      nowISO(), nowISO()).lastId;
    if (!get('SELECT root_id FROM documents WHERE id=?', id).root_id) {
      run('UPDATE documents SET root_id=? WHERE id=?', id, id);
    }
    saveProducts(payload.items || [], payload.items && payload.items[0] ? payload.items[0].unit : '', ownerId);
    return get('SELECT * FROM documents WHERE id=?', id);
  });
}

export function customerName(id) {
  if (!id) return '';
  const c = get('SELECT name FROM customers WHERE id=?', id);
  return c ? c.name : '';
}
