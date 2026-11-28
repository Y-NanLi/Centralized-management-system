/* 直接调用三套独立生成器网页，通过 localStorage 注入数据、通过 bridge 回写集中系统 */
import { state, api, esc, today, typeLabel, toast, modal } from './core.js';
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

function seed(ed, autoPrint, draftState = null) {
  const company = state.companies.find((c) => c.id === ed.company_id) || state.companies[0];
  if (!company) throw new Error('还没有公司主体，请先在基础资料里添加公司');
  const p = ed.payload || {};

  if (ed.type === 'quote') {
    localStorage.setItem('ac-quote-draft-v1', JSON.stringify(draftState || quoteState(ed, company)));
    seedCustomersQuote((draftState && draftState.cust) || p.cust || {});
  } else if (ed.type === 'contract') {
    localStorage.setItem('sc-contract-draft-v1', JSON.stringify(draftState || contractState(ed, company)));
    seedCustomersContract((draftState && draftState.cust) || p.cust || {});
  } else {
    localStorage.setItem('shd_draft_v1', JSON.stringify(draftState || deliveryState(ed, company)));
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

const DRAFT_PREFIX = '__central_unsaved_draft_v1_';
const DRAFT_MAX_AGE = 14 * 24 * 3600 * 1000;

function draftKey(type, id) {
  const uid = (state.user && state.user.id) || 'guest';
  return `${DRAFT_PREFIX}${uid}_${type}_${Number(id) || 'new'}`;
}
function readDraft(type, id) {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(type, id)) || 'null');
    if (!d || !d.state || typeof d.state !== 'object') return null;
    if (!d.savedAt || Date.now() - Number(d.savedAt) > DRAFT_MAX_AGE) {
      localStorage.removeItem(draftKey(type, id));
      return null;
    }
    return d;
  } catch { return null; }
}
function saveDraft(type, id, state, savedAt) {
  if (!state || typeof state !== 'object') return;
  try {
    const text = JSON.stringify({ type, docId: Number(id) || 0, savedAt: Number(savedAt) || Date.now(), state });
    if (text.length > 1024 * 1024) return; // 超长单据不挤占浏览器本地空间
    localStorage.setItem(draftKey(type, id), text);
  } catch { /* 本地存储满或被禁用时不影响编辑 */ }
}
function cleanupDrafts() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(DRAFT_PREFIX)) continue;
      let d = null;
      try { d = JSON.parse(localStorage.getItem(k) || 'null'); } catch { d = null; }
      if (!d || !d.savedAt || Date.now() - Number(d.savedAt) > DRAFT_MAX_AGE) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}
function removeDraft(type, id) {
  try { localStorage.removeItem(draftKey(type, id)); } catch { /* ignore */ }
}
function draftSummary(draft) {
  const s = draft.state || {};
  const customer = (s.cust && s.cust.name) || s.customer || '未填客户';
  const no = s.no || '未编号';
  const items = Array.isArray(s.items) ? s.items.filter((x) => x && (x.name || x.spec)).length : 0;
  return { customer, no, items };
}
function askRecoverDraft(ed, draft) {
  const { customer, no, items } = draftSummary(draft);
  const when = new Date(draft.savedAt).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
  return new Promise((resolve) => {
    const m = modal({
      title: '发现未保存的本地草稿',
      body: `<p style="margin:0 0 10px;line-height:1.8">这张${typeLabel(ed.type)}在本浏览器有一份自动暂存的草稿，保存于 <b>${esc(when)}</b>。</p>
        <div class="kv" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
          <div><div class="k">客户</div><div class="v">${esc(customer)}</div></div>
          <div><div class="k">单号</div><div class="v">${esc(no)}</div></div>
          <div><div class="k">有效明细</div><div class="v">${items} 行</div></div>
        </div>
        <p class="tiny" style="margin:0;line-height:1.8">恢复后继续编辑，只有点“保存 / 打印”才会写回系统；放弃则使用系统里的最近版本。</p>`,
      footer: '<button class="btn" id="draftDiscard">放弃草稿</button><button class="btn" data-close>暂不恢复</button><button class="btn primary" id="draftRestore">恢复草稿</button>',
    });
    let done = false;
    const finish = (value) => { if (done) return; done = true; m.close(); resolve(value); };
    m.root.querySelector('#draftRestore').onclick = () => finish('restore');
    m.root.querySelector('#draftDiscard').onclick = () => finish('discard');
    m.root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => finish('skip')));
    m.root.addEventListener('click', (e) => { if (e.target === m.root) finish('skip'); });
  });
}

export async function openTemplateEditor(ed, opts = {}) {
  const type = ed.type;
  const label = typeLabel(type);
  const autoPrint = opts.autoPrint === true;

  let recovered = null;
  cleanupDrafts();
  if (ed.locked) removeDraft(type, ed.id);
  const localDraft = ed.locked ? null : readDraft(type, ed.id);
  if (localDraft) {
    if (ed.id && ed.updated_at && Number(localDraft.savedAt) <= Date.parse(ed.updated_at)) {
      removeDraft(type, ed.id);
    } else {
      const action = await askRecoverDraft(ed, localDraft);
      if (action === 'restore') recovered = localDraft.state;
      else if (action === 'discard') removeDraft(type, ed.id);
    }
  }

  try { seed(ed, autoPrint, recovered); }
  catch (e) { toast(e.message, true); return; }

  const v = view(`<div class="tpl-overlay" id="tplOverlay">
    <iframe class="tpl-frame" id="tplFrame" title="${esc(label)}生成器"
      allow="clipboard-write; clipboard-read"
      src="/templates/${type}.html?central=1&doc=${Number(ed.id) || 0}&company_id=${Number(ed.company_id) || 0}&_=${Date.now()}"></iframe>
    <div class="tpl-loading" id="tplLoading"><span class="tpl-spin"></span><span>正在打开${esc(label)}生成器…</span></div>
    <div class="draft-badge" id="draftBadge">本地草稿自动保存已开启</div>
  </div>`, 'docs', label + ' / 生成器');

  let currentId = Number(ed.id) || 0;
  let currentTitle = ed.title || '';

  const overlay = v.querySelector('#tplOverlay');
  const loading = v.querySelector('#tplLoading');
  const frame = v.querySelector('#tplFrame');
  const badge = v.querySelector('#draftBadge');
  if (recovered) {
    badge.textContent = '已恢复本地草稿，保存后写入系统';
    badge.classList.add('restored');
  }

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
    if (d.type === 'draft') {
      if (!ed.locked) saveDraft(type, d.id || currentId, d.state, d.savedAt);
      if (badge && d.savedAt) {
        badge.textContent = '本地草稿已暂存 ' + new Date(d.savedAt).toLocaleTimeString('zh-CN', { hour12: false });
        badge.classList.remove('restored', 'saved');
      }
      return;
    }
    if (d.type === 'saved') {
      const oldId = currentId;
      currentId = Number(d.id) || currentId;
      if (d.title) currentTitle = d.title;
      removeDraft(type, oldId);
      removeDraft(type, currentId);
      if (badge) {
        badge.textContent = '已保存到系统';
        badge.classList.remove('restored');
        badge.classList.add('saved');
      }
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
