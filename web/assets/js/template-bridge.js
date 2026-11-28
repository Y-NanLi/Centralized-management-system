/* 三个独立单据生成器 <-> 集中管理系统 数据桥
 * 只在 iframe 中带 ?central=1 打开时生效，避免直接打开模板误写系统单据。
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.get('central') !== '1') return;
  if (window.parent === window) return; // 只允许集中系统 iframe 内回写，直接开模板页不碰系统数据

  const TYPE = /\/quote\.html$/.test(location.pathname) ? 'quote'
    : /\/contract\.html$/.test(location.pathname) ? 'contract'
      : /\/delivery\.html$/.test(location.pathname) ? 'delivery' : '';
  if (!TYPE) return;

  const DRAFT_KEY = TYPE === 'quote' ? 'ac-quote-draft-v1'
    : TYPE === 'contract' ? 'sc-contract-draft-v1' : 'shd_draft_v1';

  const META_KEY = '__central_template_meta';
  let meta = {};
  try { meta = JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch { meta = {}; }
  meta.type = TYPE;
  meta.docId = Number(meta.docId || params.get('doc') || 0) || 0;
  meta.status = meta.status || 'draft';
  meta.companyId = Number(meta.companyId || params.get('company_id') || 0) || 0;
  meta.autoPrint = meta.autoPrint === true || params.get('print') === '1';

  const KEY_CODE = { jxt: 'jxt', yzl: 'yzl', anch: 'ac' };
  const ready = () => window.parent && window.parent !== window
    && window.parent.postMessage({ source: 'central-template', type: 'ready', docType: TYPE }, location.origin);
  const notify = (type, extra) => {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage({ source: 'central-template', type, docType: TYPE, ...(extra || {}) }, location.origin);
  };
  const say = (msg) => {
    try { if (typeof window.toast === 'function') window.toast(msg); } catch { /* template toast may not exist */ }
  };
  const readDraft = () => {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}; } catch { return {}; }
  };

  const authHeaders = () => {
    const h = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  };

  let companiesPromise = null;
  async function companies() {
    if (!companiesPromise) {
      companiesPromise = fetch('/api/companies', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((j) => (j && j.ok ? (j.data || []) : []))
        .catch(() => []);
    }
    return companiesPromise;
  }

  async function resolveCompany(state) {
    const list = await companies();
    if (TYPE === 'delivery') {
      const name = String(state.company || '').trim();
      const byName = list.find((c) => c.name === name || c.short_name === name);
      if (byName) return byName;
    } else {
      const code = KEY_CODE[state.company] || '';
      if (code) {
        const byCode = list.find((c) => String(c.code || '').toLowerCase() === code);
        if (byCode) return byCode;
      }
      const selfName = (state.self && state.self.name) || '';
      const byName = list.find((c) => c.name === selfName);
      if (byName) return byName;
    }
    return list.find((c) => c.id === meta.companyId) || list[0] || null;
  }

  function quotePayload(st, company) {
    const p = { ...st };
    p.company = company ? company.code : '';
    p.showLogo = st.company !== 'none';
    p.no = st.no || '';
    p.remark = st.remark || '';
    p.items = Array.isArray(st.items) ? st.items : [];
    return p;
  }

  function contractPayload(st, company) {
    const p = { ...st };
    p.company = company ? company.code : '';
    p.showLogo = !!st.logoOn;
    p.no = st.no || '';
    p.remark = st.remark || '';
    p.items = Array.isArray(st.items) ? st.items : [];
    return p;
  }

  function deliveryPayload(st, company) {
    return {
      company: company ? company.code : '',
      date: st.date || '',
      no: st.no || '',
      dtype: st.dtype || '送货单',
      customer: st.customer || '',
      cust: { name: st.customer || '' },
      summary: st.summary || '',
      maker: st.maker || '',
      agent: st.agent || '',
      dept: st.dept || '',
      warehouse: st.warehouse || '',
      shipper: st.shipper || '',
      items: Array.isArray(st.items) ? st.items : [],
      showLogo: false,
      showSign: true,
      self: company ? {
        name: company.name, addr: company.addr || '', rep: company.rep || '',
        phone: company.phone || '', fax: company.fax || '',
      } : {},
      remark: '',
    };
  }

  function currentState() {
    if (TYPE === 'delivery') return (typeof window.collect === 'function') ? window.collect() : readDraft();
    if (typeof window.__templateOrigSave === 'function') {
      try { window.__templateOrigSave(true); } catch { /* keep last draft */ }
    }
    return readDraft();
  }

  let inFlight = null;
  let queued = null;
  let lastSavedNo = '';

  async function doSave(state, reason) {
    const company = await resolveCompany(state);
    const companyId = company ? company.id : meta.companyId;
    let payload;
    if (TYPE === 'quote') payload = quotePayload(state, company);
    else if (TYPE === 'contract') payload = contractPayload(state, company);
    else payload = deliveryPayload(state, company);

    const docNo = TYPE === 'delivery' ? (state.no || '') : (state.no || '');
    const docDate = TYPE === 'delivery' ? (state.date || '') : (state.date || '');
    const title = TYPE === 'delivery' ? (state.name || meta.title || '') : (meta.title || '');
    const body = {
      type: TYPE,
      company_id: companyId,
      status: meta.status || 'draft',
      doc_no: docNo,
      doc_date: docDate,
      title,
      remark: TYPE === 'delivery' ? '' : (state.remark || ''),
      tax_rate: TYPE === 'delivery' ? 0 : (Number(state.taxRate) || 0),
      payload,
    };

    const url = meta.docId ? '/api/documents/' + meta.docId : '/api/documents';
    const res = await fetch(url, {
      method: meta.docId ? 'PUT' : 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error((j && j.error) || ('请求失败 ' + res.status));

    const doc = j.data || {};
    meta.docId = Number(doc.id || meta.docId);
    meta.status = doc.status || meta.status;
    meta.docNo = doc.doc_no || docNo;
    meta.title = doc.title || title;
    lastSavedNo = doc.doc_no || docNo;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    notify('saved', { id: meta.docId, doc_no: meta.docNo, title: meta.title || '', reason: reason || 'save' });
    say('已保存到CRM系统：' + (meta.docNo || ''));
    return true;
  }

  async function push(state, reason) {
    queued = { state, reason };
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let ok = true;
      while (queued) {
        const task = queued;
        queued = null;
        try { await doSave(task.state, task.reason); } catch (e) { ok = false; say('系统保存失败：' + e.message); }
      }
      inFlight = null;
      return ok;
    })();
    return inFlight;
  }

  /* 包装模板自己的保存入口：只显式保存/打印时同步，输入过程中的自动保存不请求接口。 */
  if (TYPE === 'quote' || TYPE === 'contract') {
    const orig = window.saveNow;
    if (typeof orig === 'function') {
      window.__templateOrigSave = orig;
      window.saveNow = function (silent) {
        const r = orig.apply(this, arguments);
        if (!silent) {
          const state = readDraft();
          if (state && Object.keys(state).length) push(state, 'save');
        }
        return r;
      };
    }
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest && e.target.closest('button');
      if (b && (b.id === 'btnPrint' || b.id === 'btnPdf')) {
        const state = currentState();
        if (state && Object.keys(state).length) push(state, 'print');
      }
    }, true);
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'p') {
        const state = currentState();
        if (state && Object.keys(state).length) push(state, 'print');
      }
    }, true);
  } else {
    const origDoSave = window.doSaveNow;
    if (typeof origDoSave === 'function') {
      window.doSaveNow = function (data) {
        const r = origDoSave.apply(this, arguments);
        if (data && typeof data === 'object') push(data, 'save');
        return r;
      };
    }
    const origPrint = window.doPrint;
    if (typeof origPrint === 'function') {
      window.doPrint = function () {
        try {
          const data = (typeof window.collect === 'function') ? window.collect() : readDraft();
          if (data && Object.keys(data).length) push(data, 'print');
        } catch { /* 打印入口不因桥接失败而中断 */ }
        return origPrint.apply(this, arguments);
      };
    }
  }

  function hasContent(state) {
    if (!state) return false;
    if (TYPE === 'delivery') {
      return !!String(state.customer || '').trim()
        || (Array.isArray(state.items) && state.items.some((x) => String(x.name || '').trim() || String(x.spec || '').trim()));
    }
    return !!String((state.cust && state.cust.name) || '').trim()
      || (Array.isArray(state.items) && state.items.some((x) => String(x.name || '').trim() || String(x.spec || '').trim()));
  }

  /* 嵌入时的返回入口与“新建”隔离：新建统一由集中系统单据列表发起，避免覆盖当前系统单据。 */
  function arrangeTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const oldNew = bar.querySelector('#btnNew');
    if (oldNew) oldNew.style.display = 'none';
    if (bar.querySelector('#centralBackBtn')) return;
    const btn = document.createElement('button');
    btn.className = 'btn ghost';
    btn.id = 'centralBackBtn';
    btn.textContent = '返回系统';
    btn.title = '保存后返回CRM系统';
    btn.addEventListener('click', async () => {
      if (btn.dataset.busy === '1') return;
      btn.dataset.busy = '1';
      btn.textContent = '保存中…';
      const state = currentState();
      const shouldSave = meta.docId || hasContent(state);
      const ok = shouldSave ? await push(state, 'close') : true;
      btn.dataset.busy = '0';
      btn.textContent = '返回系统';
      if (!ok && !confirm('单据保存到CRM系统失败，仍要返回吗？')) return;
      notify('close', { id: meta.docId || 0 });
    });
    bar.insertBefore(btn, bar.querySelector('#btnNew') || bar.firstElementChild && bar.firstElementChild.nextSibling);
  }

  /* 测试/排查用：不通过模板 UI 也能直接触发一次系统保存。 */
  window.__templateBridge = { meta, push, currentState, save: () => push(currentState(), 'manual') };

  setTimeout(() => {
    arrangeTopbar();
    ready();
    if (meta.autoPrint) setTimeout(() => {
      const b = document.querySelector('#btnPrint');
      if (b) b.click();
    }, 700);
  }, 0);
}());
