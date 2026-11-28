/* 直接调用三套独立生成器网页，通过 localStorage 注入数据、通过 bridge 回写集中系统 */
import { state, api, esc, today, typeLabel, toast } from './core.js';
import { view } from './shell.js';

function quoteState(ed, company) {
  const p = ed.payload || {};
  const key = p.showLogo === false ? 'none' : ({ jxt: 'jxt', yzl: 'yzl', ac: 'anch' }[company.code] || 'none');
  return {
    no: ed.doc_no || p.no || '',
    date: ed.doc_date || p.date || today(),
    validDays: p.validDays == null ? 7 : p.validDays,
    taxRate: p.taxRate == null ? 13 : p.taxRate,
    taxMode: p.taxMode || 'in',
    showSign: !!p.showSign,
    company: key,
    cust: p.cust || { name: '', contact: '', phone: '', fax: '', about: '' },
    self: p.self || { name: company.name, addr: company.addr, rep: company.rep, phone: company.phone, fax: company.fax },
    items: Array.isArray(p.items) && p.items.length ? p.items : [{ name: '', spec: '', qty: '', price: '' }],
    terms: p.terms || { delivery: '5个工作日', invoice: '以税率13%增值税发票', extra: [] },
    cols: p.cols || [7, 25, 28, 9, 15, 16],
    meta: p.meta || { fsTitle: 100, fsInfo: 100, fsItem: 100 },
    stamp: p.stamp || { on: false, size: 42, dx: 0, dy: 0, rot: 0 },
    remark: p.remark || ed.remark || '',
  };
}

function contractState(ed, company) {
  const p = ed.payload || {};
  const key = ({ jxt: 'jxt', yzl: 'yzl', ac: 'anch' }[company.code] || 'anch');
  return {
    no: ed.doc_no || p.no || '',
    date: ed.doc_date || p.date || today(),
    signDate: p.signDate || '',
    taxRate: p.taxRate == null ? 13 : p.taxRate,
    company: key,
    logoOn: p.showLogo === true,
    cust: p.cust || { name: '', addr: '', rep: '', phone: '' },
    self: p.self || { name: company.name, addr: company.addr, rep: company.rep, phone: company.phone, fax: company.fax },
    items: Array.isArray(p.items) && p.items.length ? p.items : [{ name: '', spec: '', qty: '', price: '' }],
    terms: p.terms,
    termNumbered: !!p.termNumbered,
    remark: p.remark || ed.remark || '',
    showSign: p.showSign !== false,
    stamp: p.stamp || { on: false, size: 40, dx: 0, dy: 0, rot: 0 },
    cols: p.cols || [26, 34, 10, 15, 15],
    meta: p.meta || { fsTitle: 100, fsInfo: 100, fsItem: 100 },
  };
}

function deliveryState(ed, company) {
  const p = ed.payload || {};
  return {
    company: company.name,
    maker: p.maker || state.user.name || state.user.username || '',
    date: ed.doc_date || p.date || today(),
    no: ed.doc_no || p.no || '',
    agent: p.agent || '',
    dept: p.dept || '',
    shipper: p.shipper || '',
    warehouse: p.warehouse || '',
    customer: p.customer || (p.cust && p.cust.name) || '',
    summary: p.summary || '',
    dtype: p.dtype || '送货单',
    items: Array.isArray(p.items) && p.items.length ? p.items : [{ code: '', name: '', spec: '', proj: '', unit: '', qty: '', pin: '', contract: '' }],
  };
}

function seedCustomersQuote(payload) {
  const list = (state.customers || []).map((c) => ({
    n: c.name || '', c: c.contact || '', p: c.phone || '', f: c.fax || '', a: c.addr || '', t: c.tax_no || '',
  }));
  if (payload.cust && payload.cust.name && !list.some((x) => x.n === payload.cust.name)) {
    list.push({ n: payload.cust.name, c: payload.cust.contact || '', p: payload.cust.phone || '', f: payload.cust.fax || '', a: payload.cust.addr || '', t: '' });
  }
  localStorage.setItem('ac-quote-clients-v1', JSON.stringify(list));
}

function seedCustomersContract(payload) {
  const obj = {};
  (state.customers || []).forEach((c) => { if (c.name) obj[c.name] = { addr: c.addr || '', rep: c.contact || '', phone: c.phone || '' }; });
  if (payload.cust && payload.cust.name) {
    obj[payload.cust.name] = { addr: payload.cust.addr || '', rep: payload.cust.rep || '', phone: payload.cust.phone || '' };
  }
  localStorage.setItem('sc-contract-clients-v1', JSON.stringify(obj));
}

function seedProducts() {
  const ps = state.products || [];
  localStorage.setItem('ac-quote-prod-v1', JSON.stringify({ v: 1, t: ps.map((p) => [p.spec || '', p.name || '']) }));
  localStorage.setItem('sc-contract-prod-v1', JSON.stringify(ps.map((p) => ({ spec: p.spec || '', name: p.name || '', t: Date.now() }))));
  localStorage.setItem('shd_prod_v1', JSON.stringify({ v: 1, t: ps.map((p) => [p.spec || '', p.name || '', p.unit || '']) }));
}

function seed(ed, autoPrint) {
  const company = state.companies.find((c) => c.id === ed.company_id) || state.companies[0];
  if (!company) throw new Error('还没有公司主体，请先在基础资料里添加公司');
  const p = ed.payload || {};

  if (ed.type === 'quote') {
    localStorage.setItem('ac-quote-draft-v1', JSON.stringify(quoteState(ed, company)));
    seedCustomersQuote(p);
  } else if (ed.type === 'contract') {
    localStorage.setItem('sc-contract-draft-v1', JSON.stringify(contractState(ed, company)));
    seedCustomersContract(p);
  } else {
    localStorage.setItem('shd_draft_v1', JSON.stringify(deliveryState(ed, company)));
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('shd_settings_v1') || '{}') || {}; } catch { settings = {}; }
    // 送货单默认三联纸；只在首次升级时纠正旧的强制 A4，之后用户手动切 A4 仍会记住
    if (settings.layoutDefaultMigrated !== 'tri') {
      settings.layout = 'tri';
      settings.layoutDefaultMigrated = 'tri';
    }
    settings.company = company.name;
    localStorage.setItem('shd_settings_v1', JSON.stringify(settings));
  }
  seedProducts();

  localStorage.setItem('__central_template_meta', JSON.stringify({
    type: ed.type,
    docId: Number(ed.id) || 0,
    status: ed.status || 'draft',
    companyId: company.id,
    title: ed.title || '',
    autoPrint: !!autoPrint,
    locked: !!ed.locked,
  }));
}

export function openTemplateEditor(ed, opts = {}) {
  const type = ed.type;
  const label = typeLabel(type);
  const autoPrint = opts.autoPrint === true;

  try { seed(ed, autoPrint); }
  catch (e) { toast(e.message, true); return; }

  const v = view(`<div class="tpl-overlay" id="tplOverlay">
    <iframe class="tpl-frame" id="tplFrame" title="${esc(label)}生成器"
      allow="clipboard-write; clipboard-read"
      src="/templates/${type}.html?central=1&doc=${Number(ed.id) || 0}&company_id=${Number(ed.company_id) || 0}&_=${Date.now()}"></iframe>
    <div class="tpl-loading" id="tplLoading"><span class="tpl-spin"></span><span>正在打开${esc(label)}生成器…</span></div>
  </div>`, 'docs', label + ' / 生成器');

  let currentId = Number(ed.id) || 0;
  let currentTitle = ed.title || '';

  const overlay = v.querySelector('#tplOverlay');
  const loading = v.querySelector('#tplLoading');
  const frame = v.querySelector('#tplFrame');

  const cleanup = () => {
    window.removeEventListener('message', onMessage);
    if (overlay && overlay.parentNode) overlay.remove();
  };

  const updateMeta = (id, title) => {
    try {
      const meta = JSON.parse(localStorage.getItem('__central_template_meta') || '{}') || {};
      meta.docId = id;
      if (title != null) meta.title = title;
      localStorage.setItem('__central_template_meta', JSON.stringify(meta));
    } catch { /* meta 只用于刷新恢复 */ }
  };

  function onMessage(ev) {
    if (!overlay.isConnected) { cleanup(); return; }
    if (ev.origin !== location.origin) return;
    const d = ev.data || {};
    if (d.source !== 'central-template' || d.docType !== type) return;
    if (d.type === 'ready') {
      if (loading) loading.classList.add('hide');
      return;
    }
    if (d.type === 'saved') {
      currentId = Number(d.id) || currentId;
      if (d.title) currentTitle = d.title;
      updateMeta(currentId, currentTitle);
      if (currentId) history.replaceState(null, '', `#/doc?id=${currentId}`);
      return;
    }
    if (d.type === 'close') {
      if (Number(d.id)) currentId = Number(d.id);
      cleanup();
      location.hash = currentId ? `#/doc?id=${currentId}&t=${Date.now()}` : '#/docs';
    }
  }

  window.addEventListener('message', onMessage);
  frame.addEventListener('load', () => {
    setTimeout(() => { if (loading) loading.classList.add('hide'); }, 900);
  });
  setTimeout(() => { if (loading) loading.classList.add('hide'); }, 12000);
}
