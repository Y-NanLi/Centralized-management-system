/* 集中管理系统 前端（零构建，原生 ES Module） */
const state = {
  token: localStorage.getItem('token') || '',
  user: null,
  meta: null,
  companies: [],
  customers: [],
  products: [],
};

const app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('zh-CN') : esc(n));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const typeLabel = (t) => ({ quote: '报价单', contract: '销售合同', delivery: '送货单' }[t] || t);
const statusLabel = (t, s) => {
  const list = (state.meta && state.meta.statuses && state.meta.statuses[t]) || [];
  return (list.find((x) => x.key === s) || {}).label || s;
};
const roleLabel = (r) => ({ admin: '管理员', manager: '主管', sales: '业务员', guest: '游客' }[r] || r);

function fileUrl(id) {
  return `/api/files/${id}/raw${state.token ? '?token=' + encodeURIComponent(state.token) : ''}`;
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new Error('请求失败 ' + res.status);
    return res;
  }
  const j = await res.json();
  if (!j.ok) {
    if (res.status === 401) { logout(); }
    throw new Error(j.error || '请求失败');
  }
  return j.data;
}

/* ---------------- 基础 UI ---------------- */
let toastTimer = null;
function toast(msg, isErr) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function modal({ title, body, footer, wide }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">
      <div class="m-head"><h3>${esc(title)}</h3><div class="x" data-close>×</div></div>
      <div class="m-body">${body}</div>
      <div class="m-foot">${footer || '<button class="btn" data-close>关闭</button>'}</div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.hasAttribute('data-close')) close(); });
  return { root: ov, close };
}

function confirmBox(text, okText = '确定') {
  return new Promise((resolve) => {
    const m = modal({
      title: '请确认',
      body: `<p style="margin:6px 0 10px">${esc(text)}</p>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn danger" id="okBtn">${esc(okText)}</button>`,
    });
    m.root.querySelector('#okBtn').onclick = () => { m.close(); resolve(true); };
    m.root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
  });
}

function logout() {
  localStorage.removeItem('token');
  state.token = '';
  state.user = null;
  guestMode = true;
  history.replaceState(null, '', '#/dashboard');
  startGuest();
}
/* ---------------- 登录 ---------------- */
function renderLogin(msg) {
  document.body.classList.remove('printing');
  app.innerHTML = `<div class="login-wrap"><form class="login-card" id="loginForm">
      <div class="login-brand"><div class="login-logo">集</div><div><h1>集中管理系统</h1></div></div>
      <div class="sub">报价单 · 销售合同 · 送货单 一体化管理</div>
      ${msg ? `<div class="login-err">${esc(msg)}</div>` : ''}
      <div class="field"><label>账号</label><input class="input" name="username" autocomplete="username" placeholder="请输入账号" autofocus></div>
      <div class="field"><label>密码</label><input class="input" type="password" name="password" autocomplete="current-password" placeholder="请输入密码"></div>
      <button class="btn primary" style="width:100%;justify-content:center;padding:10px" type="submit">登 录</button>
      <div class="login-note">首次使用：管理员 admin / admin123，登录后请到「系统设置」修改密码。<br>
      当前浏览器的游客单据会归属到登录账号；同一份游客数据只会合并一次，之后换账号登录不会再合并。</div>
      <div style="text-align:center;margin-top:14px"><a href="#/" id="toGuest" style="font-size:12.5px;color:#6b7688">← 不登录，继续用游客模式</a></div>
    </form></div>`;
  const form = document.getElementById('loginForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
      state.token = r.token;
      state.user = r.user;
      guestMode = false;
      localStorage.setItem('token', r.token);
      await loadBase();
      if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard';
      renderShell();
      route();
      const m = r.merged;
      if (m && (m.documents || m.files || m.customers)) {
        toast(`登录成功，已合并游客数据：${m.documents} 张单据、${m.files} 个文件、${m.customers} 个客户`);
      } else {
        toast('登录成功');
      }
    } catch (err) {
      renderLogin(err.message);
    }
  };
  form.username && form.username.focus();
}

async function loadBase() {
  if (!state.meta) state.meta = await api('/meta');
  state.companies = await api('/companies');
  state.customers = await api('/customers');
  state.products = await api('/products');
}

/* ---------------- 外壳 ---------------- */
const NAV = [
  { key: 'dashboard', label: '工作台', icon: '◪', href: '#/dashboard' },
  { key: 'docs', label: '单据中心', icon: '▤', href: '#/docs' },
  { key: 'customers', label: '客户档案', icon: '◎', href: '#/customers' },
  { key: 'products', label: '货品库', icon: '▦', href: '#/products' },
  { key: 'files', label: '文件库', icon: '▧', href: '#/files' },
  { key: 'users', label: '用户管理', icon: '◍', href: '#/users', admin: true },
  { key: 'settings', label: '系统设置', icon: '⚙', href: '#/settings' },
];

function renderShell() {
  const isGuest = state.user.role === 'guest';
  const nav = NAV.filter((n) => (!n.admin || state.user.role === 'admin') && (!isGuest || n.key !== 'settings')).map((n) => `
    <a class="nav-item" data-nav="${n.key}" href="${n.href}"><span class="ic">${n.icon}</span>${n.label}</a>`).join('');
  app.innerHTML = `<div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">集</div><div class="brand-text"><b>集中管理系统</b><span>报价 · 合同 · 送货单</span></div></div>
        <nav class="nav">${nav}</nav>
        <div class="userbox">
          <div class="avatar">${esc((state.user.name || state.user.username).slice(0, 1))}</div>
          <div class="who"><b>${esc(state.user.name || state.user.username)}</b><span>${esc(roleLabel(state.user.role))}${isGuest ? ' · 免登录' : ''}</span></div>
          ${isGuest ? '<a class="out" id="btnLogin" href="#/login">登录</a>' : '<div class="out" id="btnLogout">退出</div>'}
        </div>
      </aside>
      <div class="main">
        <div class="topbar"><div class="crumb" id="crumb">工作台</div><div class="spacer"></div>
          <div class="tiny" id="topInfo">${isGuest ? '游客模式：数据保存在服务器共享库；登录后本浏览器的游客单据归属到你的账号（只合并一次）' : ''}</div></div>
        <div class="content" id="view"></div>
      </div>
    </div>`;
  if (isGuest) {
    const b = document.getElementById('btnLogin');
    if (b) b.onclick = () => { location.hash = '#/login'; };
  } else {
    document.getElementById('btnLogout').onclick = logout;
  }
}

function setNav(key, crumb) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  const c = document.getElementById('crumb');
  if (c) c.textContent = crumb || '';
}

/* ---------------- 路由 ---------------- */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const [path, qs] = raw.split('?');
  return { path, q: new URLSearchParams(qs || '') };
}

const routes = {
  '/dashboard': pageDashboard,
  '/docs': pageDocs,
  '/doc/new': pageDocNew,
  '/doc': pageDocDetail,
  '/doc/edit': pageDocEdit,
  '/print': pagePrint,
  '/customers': pageCustomers,
  '/customer': pageCustomer,
  '/products': pageProducts,
  '/files': pageFiles,
  '/users': pageUsers,
  '/settings': pageSettings,
};

let seq = 0;
async function route() {
  if (!state.user) return;
  const r = parseHash();
  if (r.path === '/login' && state.user.role === 'guest') { renderLogin(); return; }
  if (!document.getElementById('view')) renderShell();
  const my = ++seq;
  try {
    const fn = routes[r.path] || pageDashboard;
    await fn(r.q, my);
  } catch (err) {
    const v = document.getElementById('view');
    if (v) v.innerHTML = `<div class="card"><div class="empty"><b>加载失败</b>${esc(err.message)}</div></div>`;
  }
}

window.addEventListener('hashchange', () => {
  if (state.user) route();
  else guestRoute();
});

function view(html, navKey, crumb) {
  const v = document.getElementById('view');
  if (v) v.innerHTML = html;
  setNav(navKey, crumb);
  window.scrollTo({ top: 0 });
  return v;
}

/* ---------------- 工作台 ---------------- */
async function pageDashboard(q, my) {
  const d = await api('/dashboard');
  if (my !== seq) return;
  const maxAmt = Math.max(...d.trend.map((t) => t.contract_amount), 1);
  const trend = d.trend.map((t) => {
    const h = Math.max(3, Math.round((t.contract_amount / maxAmt) * 118));
    return `<div class="col"><div class="amt">${t.contract_amount ? Math.round(t.contract_amount / 10000 * 10) / 10 + '万' : ''}</div>
      <div class="b" style="height:${h}px"></div><div class="m">${t.month.slice(5)}月</div></div>`;
  }).join('');

  const taskHtml = (list, empty) => list.length ? list.map((x) => `
    <div class="task" data-go="#/doc?id=${x.id}">
      <span class="type-tag">${esc(x.doc_no.split('-')[1] || '')}</span>
      <div class="t"><b>${esc(x.customer_name || '未填客户')}</b><span>${esc(x.doc_no)} · ${esc(x.doc_date)} · ￥${fmt(x.amount)}</span></div>
      <span class="tiny">查看 →</span>
    </div>`).join('') : `<div class="empty" style="padding:18px">${esc(empty)}</div>`;

  const recent = d.recent.map((x) => `<tr class="clickable" data-go="#/doc?id=${x.id}">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td>
      <td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.customer_name || '—')}</td>
      <td class="right">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span></td>
      <td class="tiny">${esc(x.doc_date)}</td></tr>`).join('');

  const v = view(`
    <div class="page-head"><div><h2>工作台</h2><div class="desc">${esc(d.month)} 业务概览 · ${state.user.role === 'guest' ? '游客与账号共用服务器数据，登录后游客单据归属到账号' : '数据存在服务器，任何电脑登录都看到同一套'}</div></div>
      <div class="actions"><button class="btn primary" data-new="quote">+ 报价单</button><button class="btn" data-new="contract">+ 合同</button><button class="btn" data-new="delivery">+ 送货单</button></div></div>

    <div class="stat-grid">
      <div class="stat"><div class="k">本月单据</div><div class="v">${d.counts.quote + d.counts.contract + d.counts.delivery}</div><div class="s">报价 ${d.counts.quote} · 合同 ${d.counts.contract} · 送货 ${d.counts.delivery}</div><div class="bar"></div></div>
      <div class="stat alt"><div class="k">合同金额（累计）</div><div class="v">￥${fmt(d.amount.contract)}</div><div class="s">报价累计 ￥${fmt(d.amount.quote)}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">客户 / 货品</div><div class="v">${d.customers} / ${d.products}</div><div class="s">客户档案与货品库共用</div><div class="bar"></div></div>
      <div class="stat"><div class="k">待跟进</div><div class="v">${d.tasks.quote_no_contract.length + d.tasks.contract_no_delivery.length}</div><div class="s">报价未转合同 ${d.tasks.quote_no_contract.length} · 合同未送货 ${d.tasks.contract_no_delivery.length}</div><div class="bar"></div></div>
    </div>

    <div class="dash-grid">
      <div class="card"><h3>近 6 个月合同金额</h3><div class="card-sub">按合同日期统计，已取消的不计</div><div class="trend">${trend}</div></div>
      <div class="card"><h3>待跟进</h3><div class="card-sub">报价还没转合同、合同签了还没送货</div>
        <div class="task-list">${taskHtml(d.tasks.quote_no_contract, '没有待转合同的报价单')}</div>
        <div class="task-list" style="margin-top:8px">${taskHtml(d.tasks.contract_no_delivery, '没有待送货的合同')}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px"><h3>最近单据</h3>
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>客户</th><th class="right">金额</th><th>状态</th><th>日期</th></tr></thead>
      <tbody>${recent || '<tr><td colspan="6"><div class="empty">还没有单据，点右上角新建一张</div></td></tr>'}</tbody></table>
    </div>`, 'dashboard', '工作台');

  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });
  v.querySelectorAll('[data-go]').forEach((el) => el.onclick = () => { location.hash = el.dataset.go; });
}

/* ---------------- 单据列表 ---------------- */
async function pageDocs(q, my) {
  const type = q.get('type') || '';
  const status = q.get('status') || '';
  const kw = q.get('q') || '';
  const page = Number(q.get('page') || 1);
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (kw) params.set('q', kw);
  params.set('page', page);
  const data = await api('/documents?' + params.toString());
  if (my !== seq) return;

  const statusOpts = type
    ? state.meta.statuses[type].map((s) => `<option value="${s.key}" ${s.key === status ? 'selected' : ''}>${s.label}</option>`).join('')
    : Object.values(state.meta.statuses).flat().filter((s, i, arr) => arr.findIndex((x) => x.key === s.key) === i)
      .map((s) => `<option value="${s.key}" ${s.key === status ? 'selected' : ''}>${s.label}</option>`).join('');

  const rows = data.items.map((x) => `<tr class="clickable" data-id="${x.id}">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td>
      <td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.customer_name || '—')}</td>
      <td class="tiny">${x.chain_size > 1 ? '链路 ' + x.chain_size + ' 张' : '—'}</td>
      <td class="right nowrap">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span></td>
      <td class="tiny nowrap">${esc(x.doc_date)}</td>
      <td class="tiny nowrap">${esc(x.owner_name || '')}</td>
    </tr>`).join('');

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const v = view(`
    <div class="page-head"><div><h2>单据中心</h2><div class="desc">共 ${data.total} 张 · 报价 → 合同 → 送货单 可逐级派生，客户与明细自动带过去</div></div>
      <div class="actions"><button class="btn" data-new="quote">+ 报价单</button><button class="btn" data-new="contract">+ 合同</button><button class="btn primary" data-new="delivery">+ 送货单</button></div></div>
    <div class="card">
      <div class="toolbar">
        <div style="display:flex;gap:4px;background:#f3f6fb;border-radius:9px;padding:3px">
          ${['', 'quote', 'contract', 'delivery'].map((t) => `<a class="btn ghost ${t === type ? 'primary' : ''}" style="border:0;padding:5px 12px" href="#/docs${t ? '?type=' + t : ''}">${t ? typeLabel(t) : '全部'}</a>`).join('')}
        </div>
        <form id="fDoc" style="display:flex;gap:8px;align-items:center">
          <div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="单号 / 客户 / 标题"></div>
          <select class="input" name="status" style="width:130px"><option value="">全部状态</option>${statusOpts}</select>
          <button class="btn">筛选</button>
        </form>
        <div class="spacer"></div>
        <div class="tiny">第 ${data.page} / ${pages} 页</div>
        ${page > 1 ? `<a class="btn sm" href="${hashWith(q, { page: page - 1 })}">上一页</a>` : ''}
        ${page < pages ? `<a class="btn sm" href="${hashWith(q, { page: page + 1 })}">下一页</a>` : ''}
      </div>
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>客户</th><th>关联</th><th class="right">金额</th><th>状态</th><th>日期</th><th>制单</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8"><div class="empty"><b>暂无单据</b>点右上角新建，或从旧系统导入备份</div></td></tr>'}</tbody></table>
    </div>`, 'docs', '单据中心 / ' + (type ? typeLabel(type) : '全部'));

  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });
  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `#/doc?id=${tr.dataset.id}`; });
  v.querySelector('#fDoc').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const np = new URLSearchParams();
    if (type) np.set('type', type);
    if (fd.get('q')) np.set('q', fd.get('q'));
    if (fd.get('status')) np.set('status', fd.get('status'));
    location.hash = '#/docs' + (np.toString() ? '?' + np.toString() : '');
  };
}

function hashWith(q, patch) {
  const p = new URLSearchParams(q.toString());
  for (const [k, v] of Object.entries(patch)) p.set(k, v);
  return '#/docs?' + p.toString();
}

/* ---------------- 单据详情 ---------------- */
async function pageDocDetail(q, my) {
  const id = q.get('id');
  if (!id) { location.hash = '#/docs'; return; }
  const d = await api('/documents/' + id);
  if (my !== seq) return;
  const p = d.payload || {};
  const items = p.items || [];
  const amount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

  const itemRows = items.filter((it) => it.name || it.spec).map((it, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td>
      <td class="c">${esc(it.qty)}</td>${d.type === 'delivery' ? `<td class="c">${esc(it.unit || '')}</td>` : `<td class="right">￥${fmt(it.price)}</td><td class="right">￥${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>`}
    </tr>`).join('');

  const chainNodes = [];
  if (d.parent) chainNodes.push(d.parent);
  chainNodes.push({ id: d.id, doc_no: d.doc_no, type: d.type, status: d.status, on: true });
  d.children.forEach((c) => chainNodes.push(c));
  const chain = chainNodes.map((n, i) => `${i ? '<span class="arrow">→</span>' : ''}
      <div class="node ${n.on ? 'on' : ''}" data-go="${n.id}">${typeLabel(n.type)}<span class="n">${esc(n.doc_no)}</span></div>`).join('')
    || '<span class="tiny">此单据还没有上下游关联</span>';

  const statusOpts = state.meta.statuses[d.type].map((s) => `<option value="${s.key}" ${s.key === d.status ? 'selected' : ''}>${s.label}</option>`).join('');
  const files = d.files.map((f) => fileRow(f)).join('');
  const canConvertContract = d.type === 'quote';
  const canConvertDelivery = d.type === 'quote' || d.type === 'contract';

  const v = view(`
    <div class="doc-hero">
      <div style="flex:1">
        <div class="no">${esc(d.doc_no)}</div>
        <div class="doc-meta">
          <span>${typeLabel(d.type)} · <b>${esc(d.customer_name || p.customer || '未填客户')}</b></span>
          <span>日期 <b>${esc(d.doc_date)}</b></span>
          <span>金额 <b>￥${fmt(amount)}</b></span>
          <span>主体 <b>${esc(d.company_name)}</b></span>
          <span>制单 <b>${esc(d.owner_name || '')}</b></span>
        </div>
      </div>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <select class="input" id="selStatus" style="width:112px">${statusOpts}</select>
        <button class="btn" id="btnEdit">编辑</button>
        <button class="btn primary" id="btnPrint">打印 / PDF</button>
        ${canConvertContract ? '<button class="btn" id="btnToContract">转合同</button>' : ''}
        ${canConvertDelivery ? '<button class="btn" id="btnToDelivery">转送货单</button>' : ''}
        ${['admin', 'manager'].includes(state.user.role) ? '<button class="btn danger" id="btnDel">删除</button>' : ''}
      </div>
    </div>
    <div class="chain">${chain}</div>

    <div class="card">
      <div class="kv">
        <div><div class="k">${d.type === 'delivery' ? '收货单位' : '客户'}</div><div class="v">${esc(d.customer_name || p.customer || '—')}</div></div>
        <div><div class="k">联系人</div><div class="v">${esc((p.cust && (p.cust.contact || p.cust.rep)) || d.customer_contact || '—')}</div></div>
        <div><div class="k">电话</div><div class="v">${esc((p.cust && p.cust.phone) || d.customer_phone || '—')}</div></div>
        <div><div class="k">地址</div><div class="v">${esc((p.cust && p.cust.addr) || p.customer_addr || d.customer_addr || '—')}</div></div>
        <div><div class="k">交货 / 有效期</div><div class="v">${esc((p.terms && (p.terms.delivery || p.terms.validDays)) || (p.validDays ? p.validDays + ' 天' : '—'))}</div></div>
        <div><div class="k">税率</div><div class="v">${esc(p.taxRate != null ? p.taxRate + '%' : '—')}</div></div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>明细（${items.filter((x) => x.name || x.spec).length} 行）</h3>
      <table class="tb"><thead><tr><th style="width:44px">#</th><th>品名</th><th>规格型号</th><th style="width:70px">数量</th>
        ${d.type === 'delivery' ? '<th style="width:60px">单位</th>' : '<th class="right" style="width:100px">单价</th><th class="right" style="width:110px">金额</th>'}</tr></thead>
      <tbody>${itemRows || '<tr><td colspan="6"><div class="empty">没有明细</div></td></tr>'}</tbody></table>
      ${d.type !== 'delivery' ? `<div class="total-line"><span class="upper">大写：${esc(cnyUpper(amount))}</span><span>合计 <span class="sum">￥${fmt(amount)}</span></span></div>` : ''}
      ${p.remark ? `<p class="tiny" style="margin-top:10px">备注：${esc(p.remark)}</p>` : ''}
    </div>

    <div class="card" style="margin-top:14px">
      <h3>附件 <span class="tiny">合同扫描件 / 发票 / 送货回单</span></h3>
      <div class="files" id="fileList">${files || '<div class="empty" style="padding:14px">还没有附件</div>'}</div>
      <div class="drop" id="dropZone" style="margin-top:12px">点击或拖入文件上传（单个 ≤ 100MB）</div>
      <input type="file" id="fileInput" multiple hidden>
    </div>`, 'docs', typeLabel(d.type) + ' / ' + d.doc_no);

  const go = (h) => { location.hash = h; };
  v.querySelectorAll('[data-go]').forEach((n) => n.onclick = () => go('#/doc?id=' + n.dataset.go));
  v.querySelector('#btnEdit').onclick = () => go(`#/doc/edit?id=${d.id}`);
  v.querySelector('#btnPrint').onclick = () => go(`#/print?id=${d.id}`);
  if (v.querySelector('#btnToContract')) v.querySelector('#btnToContract').onclick = () => convert(d.id, 'contract');
  if (v.querySelector('#btnToDelivery')) v.querySelector('#btnToDelivery').onclick = () => convert(d.id, 'delivery');
  if (v.querySelector('#btnDel')) v.querySelector('#btnDel').onclick = async () => {
    if (!await confirmBox('确定删除 ' + d.doc_no + '？删除后不可恢复。', '删除')) return;
    try { await api('/documents/' + d.id, { method: 'DELETE' }); toast('已删除'); go('#/docs'); } catch (e) { toast(e.message, true); }
  };
  v.querySelector('#selStatus').onchange = async (e) => {
    try {
      await api(`/documents/${d.id}/status`, { method: 'POST', body: { status: e.target.value } });
      toast('状态已更新'); route();
    } catch (err) { toast(err.message, true); }
  };

  const input = v.querySelector('#fileInput');
  const drop = v.querySelector('#dropZone');
  drop.onclick = () => input.click();
  v.querySelectorAll('[data-unlink]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('从本单据移除该附件？文件仍保留在文件库。')) return;
    try { await api(`/documents/${d.id}/files/${b.dataset.unlink}`, { method: 'DELETE' }); toast('已移除'); route(); } catch (e) { toast(e.message, true); }
  });
  input.onchange = async () => {
    if (!input.files.length) return;
    await uploadDocs(d.id, input.files);
    route();
  };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = async (e) => {
    e.preventDefault(); drop.classList.remove('on');
    if (e.dataTransfer.files.length) { await uploadDocs(d.id, e.dataTransfer.files); route(); }
  };
}

async function uploadDocs(docId, files) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append('file', f));
  try {
    await api('/documents/' + docId + '/files?category=attachment', { method: 'POST', body: fd });
    toast('已上传 ' + files.length + ' 个文件');
  } catch (e) { toast(e.message, true); }
}

function fileRow(f) {
  const isImg = /^image\//.test(f.mime || '');
  return `<div class="file-row" data-fid="${f.id}">
      <div class="fi">${isImg ? 'IMG' : (f.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</div>
      <div class="t"><b>${esc(f.name)}</b><span>${(Number(f.size) / 1024).toFixed(0)} KB · ${esc(f.created_at.slice(0, 16).replace('T', ' '))}</span></div>
      <a class="btn sm" href="/api/files/${f.id}/raw?token=${encodeURIComponent(state.token)}" target="_blank">查看</a>
      <a class="btn sm" href="/api/files/${f.id}/download?token=${encodeURIComponent(state.token)}">下载</a>
      ${['admin', 'manager'].includes(state.user.role) ? `<button class="btn sm danger" data-unlink="${f.id}">移除</button>` : ''}
    </div>`;
}

async function convert(id, to) {
  try {
    const nd = await api(`/documents/${id}/convert`, { method: 'POST', body: { to } });
    toast('已生成 ' + nd.doc_no);
    location.hash = '#/doc?id=' + nd.id;
  } catch (e) { toast(e.message, true); }
}

/* ---------------- 单据编辑 ---------------- */
function blankPayload(type, company) {
  const base = { company: company.code, date: today(), no: '', remark: '' };
  const self = { name: company.name, addr: company.addr, rep: company.rep, phone: company.phone, fax: company.fax };
  if (type === 'quote') {
    return { ...base, validDays: 7, taxRate: 13, taxMode: 'in', cust: { name: '', contact: '', phone: '', fax: '', about: '' },
      self, items: [blankItem(type)], terms: { delivery: '5个工作日', invoice: '以税率13%增值税发票', extra: [] },
      showSign: false, stamp: { on: false, size: 42, dx: 0, dy: 0, rot: 0 }, cols: [7, 25, 28, 9, 15, 16], meta: { fsTitle: 100, fsInfo: 100, fsItem: 100 } };
  }
  if (type === 'contract') {
    return { ...base, signDate: '', taxRate: 13, cust: { name: '', addr: '', rep: '', phone: '' }, self,
      items: [blankItem(type)],
      terms: [
        { id: 'effect', label: '', text: '本购销合同具有法律效力，签约双方必须全面履行，任何一方不得擅自变动或解除。若因不可预计因素变动或解除，应双方友好协商依法另立协议。', on: true },
        { id: 'delivery', label: '交货时间：', text: '款到发货', on: true },
        { id: 'pay', label: '付款方式：', text: '现结', on: true },
        { id: 'warranty', label: '保修期限：', text: '质保三年', on: true },
        { id: 'accept', label: '验收标准及提出异议期限：', text: '购货方收到货物后即可开箱验收，如有产品型号不符或质量问题，购货方在验货后一周内可提出异议并要求供货方更换。', on: true },
      ],
      termNumbered: true, showSign: true, stamp: { on: true, size: 40, dx: 18, dy: 0, rot: 0 }, cols: [26, 34, 10, 15, 15], meta: { fsTitle: 100, fsInfo: 100, fsItem: 100 } };
  }
  return { ...base, dtype: '送货单', customer: '', summary: '', items: [blankItem('delivery')], showSign: true };
}

function blankItem(type) {
  if (type === 'delivery') return { code: '', name: '', spec: '', proj: '', unit: '', qty: '', pin: '', contract: '' };
  return { name: '', spec: '', qty: '', price: '' };
}

async function pageDocNew(q, my) {
  const type = q.get('type') || 'quote';
  const company = state.companies[0];
  const payload = blankPayload(type, company);
  const noPreview = await api(`/number/next?type=${type}&company_id=${company.id}`);
  if (my !== seq) return;
  payload.no = noPreview.doc_no;
  openEditor({ id: 0, type, payload, status: 'draft', doc_date: today(), doc_no: noPreview.doc_no, title: '', remark: '', company_id: company.id });
}

async function pageDocEdit(q, my) {
  const id = q.get('id');
  const d = await api('/documents/' + id);
  if (my !== seq) return;
  openEditor({
    id: d.id, type: d.type, payload: d.payload, status: d.status, doc_date: d.doc_date,
    doc_no: d.doc_no, title: d.title, remark: d.remark, company_id: d.company_id,
  });
}

function openEditor(ed) {
  const type = ed.type;
  const p = ed.payload;
  const company = state.companies.find((c) => c.id === ed.company_id) || state.companies[0];
  // 兼容旧数据
  if (!p.cust) p.cust = { name: '', contact: '', phone: '', addr: '', rep: '', fax: '', about: '' };
  if (!Array.isArray(p.items) || !p.items.length) p.items = [blankItem(type)];
  if (type === 'contract' && !Array.isArray(p.terms)) p.terms = blankPayload('contract', company).terms;
  if (type === 'quote' && (!p.terms || Array.isArray(p.terms))) p.terms = { delivery: '', invoice: '', extra: [] };

  const itemCols = type === 'delivery'
    ? [['name', '品名'], ['spec', '规格型号'], ['proj', '项目'], ['unit', '单位'], ['qty', '数量'], ['pin', '批号/备注']]
    : [['name', '品名'], ['spec', '规格型号'], ['qty', '数量'], ['price', '单价']];

  const itemsHtml = () => p.items.map((it, i) => `<tr data-row="${i}">
      <td class="c" style="width:34px">${i + 1}</td>
      ${itemCols.map(([k, label]) => `<td><input data-idx="${i}" data-f="${k}" value="${esc(it[k] == null ? '' : it[k])}" placeholder="${label}"></td>`).join('')}
      ${type === 'delivery' ? '' : `<td class="amt">￥${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>`}
      <td style="width:30px"><button class="del" data-del="${i}" title="删除本行">×</button></td>
    </tr>`).join('');

  const statusOpts = state.meta.statuses[type].map((s) => `<option value="${s.key}" ${s.key === ed.status ? 'selected' : ''}>${s.label}</option>`).join('');
  const companyOpts = state.companies.map((c) => `<option value="${c.id}" ${c.id === ed.company_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  const termsHtml = () => type === 'contract' && Array.isArray(p.terms)
    ? p.terms.map((t, i) => `<div class="term-row" data-term="${i}">
        <input type="checkbox" data-tf="on" ${t.on !== false ? 'checked' : ''}>
        <input class="input" data-tf="label" value="${esc(t.label || '')}" placeholder="条目标签，可空">
        <input class="input" data-tf="text" value="${esc(t.text || '')}" placeholder="条款内容">
        <button class="del" data-tdel="${i}" style="border:0;background:none;cursor:pointer;color:#b9c3d3">×</button>
      </div>`).join('')
    : `<div class="grid3">
        <div class="field"><label>交货期</label><input class="input" data-tk="delivery" value="${esc((p.terms && p.terms.delivery) || '')}"></div>
        <div class="field"><label>发票</label><input class="input" data-tk="invoice" value="${esc((p.terms && p.terms.invoice) || '')}"></div>
        <div class="field"><label>报价有效期（天）</label><input class="input" type="number" data-tk="validDays" value="${esc(p.validDays || 7)}"></div>
      </div>
      <div class="field"><label>其他条款（每行一条）</label><textarea class="input" rows="2" data-tk="extra">${esc(((p.terms && p.terms.extra) || []).join('\n'))}</textarea></div>`;

  const v = view(`
    <div class="page-head"><div><h2>${ed.id ? '编辑单据' : '新建' + typeLabel(type)}</h2>
      <div class="desc">保存后自动写入客户档案与货品库；需要派生下游单据时，在详情页点「转合同 / 转送货单」</div></div>
      <div class="actions"><button class="btn" id="btnCancel">取消</button><button class="btn primary" id="btnSave">保存</button><button class="btn" id="btnSavePrint">保存并打印</button></div></div>

    <div class="card">
      <h3>基本信息</h3>
      <div class="grid4">
        <div class="field"><label>单据类型</label><input class="input" value="${typeLabel(type)}" disabled></div>
        <div class="field"><label>公司主体</label><select class="input" id="companySel">${companyOpts}</select></div>
        <div class="field"><label>单据编号</label><input class="input mono" id="noInput" value="${esc(ed.doc_no)}"></div>
        <div class="field"><label>单据日期</label><input class="input" type="date" id="dateInput" value="${esc(ed.doc_date)}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>${type === 'delivery' ? '收货单位' : '客户名称'}</label>
          <input class="input" id="custName" list="custList" value="${esc(type === 'delivery' ? (p.customer || '') : (p.cust.name || ''))}" placeholder="输入或从客户档案选择">
          <datalist id="custList">${state.customers.map((c) => `<option value="${esc(c.name)}">${esc([c.contact, c.phone].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
        </div>
        <div class="field"><label>联系人 / 代表人</label><input class="input" id="custContact" value="${esc((p.cust && (p.cust.contact || p.cust.rep)) || '')}"></div>
        <div class="field"><label>电话</label><input class="input" id="custPhone" value="${esc((p.cust && p.cust.phone) || '')}"></div>
        <div class="field"><label>地址</label><input class="input" id="custAddr" value="${esc((p.cust && p.cust.addr) || '')}"></div>
        ${type === 'delivery' ? `<div class="field"><label>单据类型（送货单/样品单/提前送货单）</label><select class="input" id="dtypeSel">${['送货单', '样品单', '提前送货单'].map((x) => `<option ${p.dtype === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label>状态</label><select class="input" id="statusSel">${statusOpts}</select></div>
        ${type === 'delivery' ? `<div class="field"><label>关联合同号</label><input class="input" id="contractNo" value="${esc((p.items[0] && p.items[0].contract) || '')}" placeholder="可空"></div>` : `<div class="field"><label>税率</label><select class="input" id="taxSel">${[13, 9, 6, 3, 0].map((x) => `<option value="${x}" ${Number(p.taxRate) === x ? 'selected' : ''}>${x}%</option>`).join('')}</select></div>`}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>明细 <span class="tiny">在「规格型号」输入可从货品库带出品名与单价；填齐后自动入库</span></h3>
      <div class="databar">
        <button class="btn sm" id="btnAddRow">+ 加一行</button>
        <button class="btn sm" id="btnPaste">从 Excel 粘贴</button>
        <span class="tiny">支持 Tab / 逗号分隔，一次多行</span>
        <div class="spacer"></div>
        <span class="tiny">合计 <b id="totalText" style="color:#1e4b8f;font-size:16px">￥0.00</b></span>
      </div>
      <table class="items-table"><thead><tr><th style="width:34px">#</th>
        ${itemCols.map(([k, l]) => `<th>${l}</th>`).join('')}
        ${type === 'delivery' ? '' : '<th style="width:100px">金额</th>'}<th style="width:30px"></th></tr></thead>
        <tbody id="itemBody">${itemsHtml()}</tbody></table>
      ${type !== 'delivery' ? `<div class="total-line"><span class="upper" id="upperText">${esc(cnyUpper(0))}</span><span>合计 <span class="sum" id="sumText">￥0.00</span></span></div>` : ''}
      <div class="field" style="margin-top:12px"><label>备注</label><textarea class="input" id="remark" rows="2">${esc(p.remark || ed.remark || '')}</textarea></div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>条款</h3>
      <div id="termsBox">${termsHtml()}</div>
      ${type === 'contract' ? '<button class="btn sm" id="btnAddTerm" style="margin-top:6px">+ 加一条条款</button>' : ''}
      <datalist id="prodList">${state.products.map((x) => `<option value="${esc(x.spec)}">${esc(x.name)}${x.price ? ' ￥' + x.price : ''}</option>`).join('')}</datalist>
    </div>`, 'docs', (ed.id ? '编辑 / ' : '新建 / ') + typeLabel(type));

  /* ---------- 交互 ---------- */
  const recalc = () => {
    if (type === 'delivery') return;
    let total = 0;
    p.items.forEach((it) => { total += (Number(it.qty) || 0) * (Number(it.price) || 0); });
    const sum = v.querySelector('#sumText'); if (sum) sum.textContent = '￥' + fmt(total);
    const up = v.querySelector('#upperText'); if (up) up.textContent = cnyUpper(total);
    const tt = v.querySelector('#totalText'); if (tt) tt.textContent = '￥' + fmt(total);
    v.querySelectorAll('tr[data-row]').forEach((tr) => {
      const i = Number(tr.dataset.row); const it = p.items[i];
      const amt = tr.querySelector('.amt'); if (amt) amt.textContent = '￥' + fmt((Number(it.qty) || 0) * (Number(it.price) || 0));
    });
  };

  const bindRows = () => {
    v.querySelectorAll('#itemBody input').forEach((inp) => {
      inp.oninput = () => { p.items[Number(inp.dataset.idx)][inp.dataset.f] = inp.value; recalc(); };
      if (inp.dataset.f === 'spec') {
        inp.setAttribute('list', 'prodList');
        inp.onchange = () => {
          const hit = state.products.find((x) => x.spec === inp.value);
          const row = p.items[Number(inp.dataset.idx)];
          const tr = inp.closest('tr');
          if (hit) {
            if (!row.name) { row.name = hit.name; tr.querySelector('[data-f="name"]').value = hit.name; }
            if (!row.price && hit.price) { row.price = hit.price; const pi = tr.querySelector('[data-f="price"]'); if (pi) pi.value = hit.price; }
            if (!row.unit && hit.unit) { row.unit = hit.unit; const ui = tr.querySelector('[data-f="unit"]'); if (ui) ui.value = hit.unit; }
            recalc();
          }
        };
      }
    });
    v.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      p.items.splice(Number(b.dataset.del), 1);
      if (!p.items.length) p.items.push(blankItem(type));
      refreshRows();
    });
  };
  const refreshRows = () => { v.querySelector('#itemBody').innerHTML = itemsHtml(); bindRows(); recalc(); };
  bindRows(); recalc();

  v.querySelector('#btnAddRow').onclick = () => { p.items.push(blankItem(type)); refreshRows(); };
  v.querySelector('#btnPaste').onclick = () => openPaste(p, type, () => refreshRows());

  // 表头字段
  v.querySelector('#custName').onchange = (e) => {
    const name = e.target.value.trim();
    p.cust.name = name;
    if (type === 'delivery') p.customer = name;
    const hit = state.customers.find((x) => x.name === name);
    if (hit) {
      if (!p.cust.contact && (hit.contact || hit.rep)) { p.cust.contact = hit.contact || hit.rep; v.querySelector('#custContact').value = p.cust.contact; }
      if (!p.cust.phone && hit.phone) { p.cust.phone = hit.phone; v.querySelector('#custPhone').value = hit.phone; }
      if (!p.cust.addr && hit.addr) { p.cust.addr = hit.addr; v.querySelector('#custAddr').value = hit.addr; }
    }
  };
  v.querySelector('#custContact').oninput = (e) => { p.cust.contact = e.target.value; };
  v.querySelector('#custPhone').oninput = (e) => { p.cust.phone = e.target.value; };
  v.querySelector('#custAddr').oninput = (e) => { p.cust.addr = e.target.value; };
  v.querySelector('#remark').oninput = (e) => { p.remark = e.target.value; };
  v.querySelector('#dateInput').onchange = (e) => { ed.doc_date = e.target.value; p.date = e.target.value; };
  v.querySelector('#noInput').oninput = (e) => { ed.doc_no = e.target.value; p.no = e.target.value; };
  v.querySelector('#statusSel').onchange = (e) => { ed.status = e.target.value; };
  if (v.querySelector('#dtypeSel')) v.querySelector('#dtypeSel').onchange = (e) => { p.dtype = e.target.value; };
  if (v.querySelector('#taxSel')) v.querySelector('#taxSel').onchange = (e) => { p.taxRate = Number(e.target.value); };
  if (v.querySelector('#contractNo')) v.querySelector('#contractNo').oninput = (e) => { p.items.forEach((it) => { it.contract = e.target.value; }); };

  v.querySelector('#companySel').onchange = async (e) => {
    ed.company_id = Number(e.target.value);
    const co = state.companies.find((c) => c.id === ed.company_id);
    p.company = co.code;
    if (!p.self || !p.self.name || /捷信通|悦智乐|安驰/.test(p.self.name)) {
      p.self = { name: co.name, addr: co.addr, rep: co.rep, phone: co.phone, fax: co.fax };
    }
    if (!ed.id) {
      try {
        const r = await api(`/number/next?type=${type}&company_id=${co.id}`);
        ed.doc_no = r.doc_no; p.no = r.doc_no;
        v.querySelector('#noInput').value = r.doc_no;
        toast('编号已按新主体重排：' + r.doc_no);
      } catch { /* 忽略 */ }
    }
  };

  // 条款
  const bindTerms = () => {
    v.querySelectorAll('[data-tf]').forEach((inp) => {
      const i = Number(inp.closest('[data-term]').dataset.term);
      inp.oninput = inp.onchange = () => {
        if (inp.dataset.tf === 'on') p.terms[i].on = inp.checked;
        else p.terms[i][inp.dataset.tf] = inp.value;
      };
    });
    v.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = (e) => {
      e.preventDefault();
      p.terms.splice(Number(b.dataset.tdel), 1);
      drawTerms();
    });
  };
  const drawTerms = () => {
    if (type !== 'contract') return;
    v.querySelector('#termsBox').innerHTML = termsHtml();
    bindTerms();
  };
  bindTerms();
  if (v.querySelector('#btnAddTerm')) v.querySelector('#btnAddTerm').onclick = () => {
    p.terms.push({ id: 'custom' + Date.now(), label: '', text: '', on: true });
    drawTerms();
  };
  v.querySelectorAll('[data-tk]').forEach((inp) => {
    inp.oninput = () => {
      const k = inp.dataset.tk;
      if (k === 'validDays') p.validDays = Number(inp.value) || 0;
      else if (k === 'extra') p.terms.extra = inp.value.split('\n').filter(Boolean);
      else { p.terms = p.terms || {}; p.terms[k] = inp.value; }
    };
  });

  const save = async (thenPrint) => {
    const body = {
      type, company_id: ed.company_id, doc_no: ed.doc_no, doc_date: ed.doc_date, status: ed.status,
      title: ed.title, remark: p.remark || '', tax_rate: p.taxRate, payload: p,
    };
    try {
      const doc = ed.id
        ? await api('/documents/' + ed.id, { method: 'PUT', body })
        : await api('/documents', { method: 'POST', body });
      toast('已保存 ' + doc.doc_no);
      if (thenPrint) location.hash = '#/print?id=' + doc.id;
      else location.hash = '#/doc?id=' + doc.id;
    } catch (e) { toast(e.message, true); }
  };
  v.querySelector('#btnSave').onclick = () => save(false);
  v.querySelector('#btnSavePrint').onclick = () => save(true);
  v.querySelector('#btnCancel').onclick = () => history.length > 1 ? history.back() : (location.hash = '#/docs');
}

function openPaste(p, type, done) {
  const m = modal({
    title: '从 Excel 粘贴明细',
    wide: true,
    body: `<p class="tiny">直接从 Excel 选中几行粘贴（列顺序：${type === 'delivery' ? '品名、规格、项目、单位、数量、备注' : '品名、规格、数量、单价'}），Tab 或逗号分隔。</p>
      <textarea class="input" id="pasteBox" rows="10" placeholder="工控机\tIPC-610\t2\t5200"></textarea>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="pasteOk">导入</button>',
  });
  m.root.querySelector('#pasteOk').onclick = () => {
    const text = m.root.querySelector('#pasteBox').value.trim();
    if (!text) return;
    const rows = text.split(/\r?\n/).filter(Boolean).map((line) => line.includes('\t') ? line.split('\t') : line.split(','));
    const map = type === 'delivery' ? ['name', 'spec', 'proj', 'unit', 'qty', 'pin'] : ['name', 'spec', 'qty', 'price'];
    for (const r of rows) {
      const it = blankItem(type);
      map.forEach((k, i) => { if (k && r[i] != null) it[k] = String(r[i]).trim(); });
      if (it.name || it.spec) p.items.push(it);
    }
    p.items = p.items.filter((it) => it.name || it.spec || it.price);
    m.close(); done();
  };
}

/* ---------------- 打印 ---------------- */
async function pagePrint(q, my) {
  const id = q.get('id');
  const d = await api('/documents/' + id);
  if (my !== seq) return;
  const co = state.companies.find((c) => c.id === d.company_id) || state.companies[0];
  const html = d.type === 'quote' ? quoteSheet(d, co) : d.type === 'contract' ? contractSheet(d, co) : deliverySheet(d, co);
  const v = view(`<div class="print-wrap">
      <div class="print-bar no-print"><button class="btn primary" id="btnDoPrint">打印 / 另存为 PDF</button>
        <button class="btn" id="btnBack">返回</button><div class="spacer"></div>
        <span class="tiny">纸张 A4 · 纵向 · 缩放 100% · 页边距「无」· 关闭页眉页脚</span></div>
      ${html}</div>`, 'docs', typeLabel(d.type) + ' / 打印');
  v.querySelector('#btnDoPrint').onclick = () => window.print();
  v.querySelector('#btnBack').onclick = () => { location.hash = '#/doc?id=' + d.id; };
}

function stampImg(co, p, style) {
  if (!p.stamp || p.stamp.on === false) return '';
  const size = Number(p.stamp.size) || 40;
  if (p.stamp.data) {
    return `<img class="stamp" src="${p.stamp.data}" style="width:${size}mm;${style || ''}">`;
  }
  if (!co || !co.stamp_file_id) return '';
  return `<img class="stamp" src="${fileUrl(co.stamp_file_id)}" style="width:${size}mm;${style || ''}">`;
}

function quoteSheet(d, co) {
  const p = d.payload || {};
  const items = (p.items || []).filter((x) => x.name || x.spec || x.price);
  const self = Object.assign({ name: co.name, phone: co.phone, fax: co.fax }, p.self || {});
  if (!self.name) self.name = co.name;
  const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const rows = items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td>
      <td class="c">${esc(it.qty)}</td><td class="r">${fmt(it.price)}</td><td class="r">${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td></tr>`).join('')
    || '<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>';
  const terms = p.terms || {};
  return `<div class="a4">
    ${co.logo_file_id ? `<img src="${fileUrl(co.logo_file_id)}" style="height:12mm;margin-bottom:1mm">` : ''}
    <div class="doc-title">报 价 单</div>
    <div class="doc-no">单号：${esc(d.doc_no)}</div>
    <table class="sheet" style="margin-bottom:2mm">
      <tr><td style="width:52%">致：<b>${esc(p.cust && p.cust.name || d.customer_name || '')}</b></td><td>报价日期：${esc(d.doc_date)}</td></tr>
      <tr><td>联系人：${esc(p.cust && (p.cust.contact || p.cust.rep) || '')}</td><td>电话：${esc(p.cust && p.cust.phone || '')}</td></tr>
      <tr><td>地址：${esc(p.cust && (p.cust.addr || p.cust.about) || '')}</td><td>报价有效期：${esc(p.validDays || 7)} 天</td></tr>
    </table>
    <div class="lead">现将以下产品报价如下（人民币）：</div>
    <table class="sheet">
      <colgroup><col style="width:8%"><col style="width:30%"><col style="width:28%"><col style="width:10%"><col style="width:12%"><col style="width:12%"></colgroup>
      <thead><tr><th>序号</th><th>品名</th><th>规格型号</th><th>数量</th><th>单价（元）</th><th>金额（元）</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total">合计金额（${p.taxMode === 'ex' ? '未税' : '含 ' + (p.taxRate || 13) + '% 税'}）：￥${fmt(total)}<br>
      <span class="up">大写：${esc(cnyUpper(total))}</span></div>
    <div class="terms">
      ${terms.delivery ? `<div class="t">交货期：${esc(terms.delivery)}</div>` : ''}
      ${terms.invoice ? `<div class="t">发票：${esc(terms.invoice)}</div>` : ''}
      ${(terms.extra || []).map((t, i) => `<div class="t">${i + 1}. ${esc(t)}</div>`).join('')}
      ${p.remark ? `<div class="t">备注：${esc(p.remark)}</div>` : ''}
    </div>
    <div class="sign" style="grid-template-columns:1fr;margin-top:10mm">
      <div style="min-height:26mm;position:relative">
        <div class="line">报价单位（盖章）：<b>${esc(self.name)}</b></div>
        <div class="line">代表人：${esc(self.rep || co.rep || '')}　　电话：${esc(self.phone || co.phone || '')}</div>
        <div class="line">日期：${esc(d.doc_date)}</div>
        ${stampImg(co, p, 'right:16mm;bottom:2mm;')}
      </div>
    </div>
  </div>`;
}

function contractSheet(d, co) {
  const p = d.payload || {};
  const items = (p.items || []).filter((x) => x.name || x.spec || x.price);
  const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const self = Object.assign({ name: co.name, addr: co.addr, rep: co.rep, phone: co.phone }, p.self || {});
  if (!self.name) self.name = co.name;
  const rows = items.map((it, i) => `<tr><td>${esc(it.name)}</td><td>${esc(it.spec)}</td><td class="c">${esc(it.qty)}</td>
      <td class="r">${fmt(it.price)}</td><td class="r">${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td></tr>`).join('');
  const terms = (p.terms || []).filter((t) => t.on !== false && (t.text || t.label));
  return `<div class="a4">
    <div class="doc-title">产 品 销 售 合 同</div>
    <div class="doc-no">合同编号：${esc(d.doc_no)}</div>
    <div class="info-line">购货方：<b>${esc(p.cust && p.cust.name || d.customer_name || '')}</b></div>
    <div class="info-line">供货方：<b>${esc(self.name)}</b></div>
    <div class="lead">经双方协商一致，就下列产品达成购销条款：</div>
    <table class="sheet">
      <colgroup><col style="width:26%"><col style="width:34%"><col style="width:10%"><col style="width:15%"><col style="width:15%"></colgroup>
      <thead><tr><th>产品名称</th><th>规格型号</th><th>数量</th><th>单价（RMB）</th><th>总价（RMB）</th></tr></thead>
      <tbody>${rows}
      <tr><td colspan="3" class="r"><b>总计</b></td><td class="r"><b>${fmt(total)}</b></td><td class="r"><b>${fmt(total)}</b></td></tr></tbody>
    </table>
    <div class="total">总金额大写（RMB）：<span class="up">${esc(cnyUpper(total))}</span>（含 ${esc(p.taxRate || 0)}% 税）</div>
    <div class="terms">备注：${esc(p.remark || '')}</div>
    <div class="terms">${terms.map((t, i) => `<div class="t">${p.termNumbered ? (i + 1) + '、' : ''}${esc(t.label || '')}${esc(t.text || '')}</div>`).join('')}</div>
    <div class="sign">
      <div style="position:relative">
        <div class="line"><b>供货方：（盖章）</b>${esc(self.name)}</div>
        <div class="line">地址：${esc(self.addr || co.addr || '')}</div>
        <div class="line">代表人：${esc(self.rep || co.rep || '')}</div>
        <div class="line">电话：${esc(self.phone || co.phone || '')}</div>
        <div class="line">签订日期：${esc(p.signDate || d.doc_date)}</div>
        ${stampImg(co, p, 'left:26mm;top:4mm;')}
      </div>
      <div>
        <div class="line"><b>购货方：（盖章）</b>${esc(p.cust && p.cust.name || '')}</div>
        <div class="line">地址：${esc(p.cust && p.cust.addr || '')}</div>
        <div class="line">代表人：${esc(p.cust && p.cust.rep || '')}</div>
        <div class="line">电话：${esc(p.cust && p.cust.phone || '')}</div>
        <div class="line">签订日期：${esc(p.signDate || d.doc_date)}</div>
      </div>
    </div>
  </div>`;
}

function deliverySheet(d, co) {
  const p = d.payload || {};
  const cust = p.cust || {};
  const items = (p.items || []).filter((x) => x.name || x.spec || x.qty);
  const rows = items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td>
      <td>${esc(it.proj || '')}</td><td class="c">${esc(it.unit || '')}</td><td class="c">${esc(it.qty)}</td><td>${esc(it.pin || '')}</td></tr>`).join('')
    || '<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const contact = cust.contact || d.customer_contact || '';
  const phone = cust.phone || d.customer_phone || '';
  const addr = cust.addr || d.customer_addr || '';
  return `<div class="a4">
    ${co.logo_file_id ? `<img src="${fileUrl(co.logo_file_id)}" style="height:11mm">` : ''}
    <div style="font-size:9pt;color:#333">供货单位：${esc(co.name)}</div>
    <div class="doc-title">送 货 单</div>
    <div class="doc-no">单号：${esc(d.doc_no)}　　日期：${esc(d.doc_date)}</div>
    <div class="info-line">收货单位：<b>${esc(p.customer || d.customer_name || '')}</b>　　联系人：${esc(contact)}　　电话：${esc(phone)}</div>
    <div class="info-line">送货地址：${esc(addr)}</div>
    <table class="sheet" style="margin-top:2mm">
      <colgroup><col style="width:7%"><col style="width:26%"><col style="width:24%"><col style="width:13%"><col style="width:8%"><col style="width:10%"><col style="width:12%"></colgroup>
      <thead><tr><th>序号</th><th>品名</th><th>规格型号</th><th>项目/用途</th><th>单位</th><th>数量</th><th>备注</th></tr></thead>
      <tbody>${rows}
      <tr><td colspan="5" class="r"><b>合计数量</b></td><td class="c"><b>${qtyFmt(totalQty)}</b></td><td></td></tr></tbody>
    </table>
    <div class="delivery-note">备注：${esc(p.remark || p.summary || '')}</div>
    <div class="delivery-note" style="margin-top:8mm">送货人：________________　　收货人（签字）：________________　　收货日期：________________</div>
    <div class="delivery-note" style="margin-top:6mm;color:#666">本单为「${esc(p.dtype || '送货单')}」，一式三联：存根 / 客户 / 财务。</div>
    ${p.items && p.items[0] && p.items[0].contract ? `<div class="delivery-note">关联合同：${esc(p.items[0].contract)}</div>` : ''}
  </div>`;
}

/* ---------------- 客户 ---------------- */
async function pageCustomers(q, my) {
  const kw = q.get('q') || '';
  const list = await api('/customers' + (kw ? '?q=' + encodeURIComponent(kw) : ''));
  if (my !== seq) return;
  const rows = list.map((c) => `<tr class="clickable" data-id="${c.id}">
      <td><b>${esc(c.name)}</b><div class="tiny">${esc(c.addr || '')}</div></td>
      <td>${esc(c.contact || '—')}</td><td class="mono">${esc(c.phone || '—')}</td>
      <td class="right">${c.doc_count}</td><td class="right">￥${fmt(c.total_amount)}</td>
      <td class="tiny">${esc(c.last_date || '—')}</td>
      <td class="tiny"><a href="#/customer?id=${c.id}" onclick="event.stopPropagation()">详情</a></td>
    </tr>`).join('');
  const v = view(`<div class="page-head"><div><h2>客户档案</h2><div class="desc">共 ${list.length} 家 · 三套单据共用同一份客户资料，保存单据时自动建档</div></div>
      <div class="actions"><button class="btn primary" id="btnAddCust">+ 新增客户</button></div></div>
    <div class="card"><div class="toolbar"><form id="fCust" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="名称 / 联系人 / 电话 / 地址"></div><button class="btn">搜索</button></form></div>
      <table class="tb"><thead><tr><th>客户名称</th><th>联系人</th><th>电话</th><th class="right">单据数</th><th class="right">累计金额</th><th>最近单据</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7"><div class="empty"><b>还没有客户</b>新建单据时填客户名会自动建档</div></td></tr>'}</tbody></table></div>`, 'customers', '客户档案');

  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/customer?id=' + tr.dataset.id; });
  v.querySelector('#fCust').onsubmit = (e) => {
    e.preventDefault();
    const kwv = new FormData(e.target).get('q');
    location.hash = '#/customers' + (kwv ? '?q=' + encodeURIComponent(kwv) : '');
  };
  v.querySelector('#btnAddCust').onclick = () => customerForm();
}

function customerForm(c, onSaved) {
  const m = modal({
    title: c ? '编辑客户' : '新增客户',
    wide: true,
    body: `<div class="grid2">
      <div class="field"><label>客户名称 *</label><input class="input" id="cfName" value="${esc(c && c.name || '')}"></div>
      <div class="field"><label>联系人</label><input class="input" id="cfContact" value="${esc(c && c.contact || '')}"></div>
      <div class="field"><label>电话</label><input class="input" id="cfPhone" value="${esc(c && c.phone || '')}"></div>
      <div class="field"><label>传真</label><input class="input" id="cfFax" value="${esc(c && c.fax || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>地址</label><input class="input" id="cfAddr" value="${esc(c && c.addr || '')}"></div>
      <div class="field"><label>税号</label><input class="input" id="cfTax" value="${esc(c && c.tax_no || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>备注</label><input class="input" id="cfNote" value="${esc(c && c.note || '')}"></div>
    </div>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="cfSave">保存</button>',
  });
  m.root.querySelector('#cfSave').onclick = async () => {
    const body = {
      name: m.root.querySelector('#cfName').value, contact: m.root.querySelector('#cfContact').value,
      phone: m.root.querySelector('#cfPhone').value, fax: m.root.querySelector('#cfFax').value,
      addr: m.root.querySelector('#cfAddr').value, tax_no: m.root.querySelector('#cfTax').value, note: m.root.querySelector('#cfNote').value,
    };
    try {
      if (c) await api('/customers/' + c.id, { method: 'PUT', body });
      else await api('/customers', { method: 'POST', body });
      state.customers = await api('/customers');
      m.close(); toast('已保存');
      if (onSaved) onSaved(); else route();
    } catch (e) { toast(e.message, true); }
  };
}

async function pageCustomer(q, my) {
  const d = await api('/customers/' + q.get('id'));
  if (my !== seq) return;
  const rows = d.documents.map((x) => `<tr class="clickable" data-id="${x.id}">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td><td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.title)}</td><td class="right">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span></td><td class="tiny">${esc(x.doc_date)}</td></tr>`).join('');
  const v = view(`<div class="page-head"><div><h2>${esc(d.name)}</h2><div class="desc">${esc([d.addr, d.contact, d.phone].filter(Boolean).join(' · '))}</div></div>
      <div class="actions"><button class="btn" id="btnEditCust">编辑资料</button><button class="btn primary" data-new="quote">给该客户报价</button>
      <button class="btn" data-new="contract">新建合同</button></div></div>
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat"><div class="k">单据总数</div><div class="v">${d.stats.documents}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">合同金额</div><div class="v">￥${fmt(d.stats.contract_amount)}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">报价单</div><div class="v">${d.stats.quote_count}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">送货单</div><div class="v">${d.stats.delivery_count}</div><div class="bar"></div></div>
    </div>
    <div class="card"><h3>往来单据</h3>
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>标题</th><th class="right">金额</th><th>状态</th><th>日期</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><div class="empty">还没有单据</div></td></tr>'}</tbody></table></div>`, 'customers', '客户档案 / ' + d.name);
  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/doc?id=' + tr.dataset.id; });
  v.querySelector('#btnEditCust').onclick = () => customerForm(d, () => route());
  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });
}

/* ---------------- 货品 ---------------- */
async function pageProducts(q, my) {
  const kw = q.get('q') || '';
  const list = await api('/products' + (kw ? '?q=' + encodeURIComponent(kw) : ''));
  if (my !== seq) return;
  const rows = list.map((p) => `<tr>
      <td><b>${esc(p.name)}</b></td><td class="mono">${esc(p.spec || '—')}</td><td>${esc(p.unit || '—')}</td>
      <td class="right">￥${fmt(p.price)}</td><td class="tiny">${esc(p.note || '')}</td>
      <td class="tiny nowrap"><a href="#" data-edit="${p.id}">编辑</a></td></tr>`).join('');
  const v = view(`<div class="page-head"><div><h2>货品库</h2><div class="desc">共 ${list.length} 条 · 报价 / 合同 / 送货单共用；开单时输规格即可带出品名与单价</div></div>
      <div class="actions"><button class="btn primary" id="btnAddProd">+ 新增货品</button></div></div>
    <div class="card"><div class="toolbar"><form id="fProd" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="品名 / 规格"></div><button class="btn">搜索</button></form></div>
      <table class="tb"><thead><tr><th>品名</th><th>规格型号</th><th>单位</th><th class="right">参考单价</th><th>备注</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><div class="empty"><b>货品库是空的</b>开单时明细填齐会自动入库，也可以在这里手动添加</div></td></tr>'}</tbody></table></div>`, 'products', '货品库');
  v.querySelector('#fProd').onsubmit = (e) => {
    e.preventDefault();
    const kwv = new FormData(e.target).get('q');
    location.hash = '#/products' + (kwv ? '?q=' + encodeURIComponent(kwv) : '');
  };
  v.querySelector('#btnAddProd').onclick = () => productForm();
  v.querySelectorAll('[data-edit]').forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    productForm(list.find((x) => String(x.id) === a.dataset.edit));
  });
}

function productForm(p, after) {
  const m = modal({
    title: p ? '编辑货品' : '新增货品',
    body: `<div class="grid2">
      <div class="field"><label>品名 *</label><input class="input" id="pfName" value="${esc(p && p.name || '')}"></div>
      <div class="field"><label>规格型号</label><input class="input" id="pfSpec" value="${esc(p && p.spec || '')}"></div>
      <div class="field"><label>单位</label><input class="input" id="pfUnit" value="${esc(p && p.unit || '')}"></div>
      <div class="field"><label>参考单价</label><input class="input" type="number" step="0.01" id="pfPrice" value="${esc(p && p.price || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>备注</label><input class="input" id="pfNote" value="${esc(p && p.note || '')}"></div>
    </div>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="pfSave">保存</button>',
  });
  m.root.querySelector('#pfSave').onclick = async () => {
    const body = {
      name: m.root.querySelector('#pfName').value, spec: m.root.querySelector('#pfSpec').value,
      unit: m.root.querySelector('#pfUnit').value, price: Number(m.root.querySelector('#pfPrice').value) || 0,
      note: m.root.querySelector('#pfNote').value,
    };
    try {
      if (p) await api('/products/' + p.id, { method: 'PUT', body });
      else await api('/products', { method: 'POST', body });
      state.products = await api('/products');
      m.close(); toast('已保存'); if (after) after(); else route();
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------------- 文件库 ---------------- */
async function pageFiles(q, my) {
  const cat = q.get('cat') || '';
  const kw = q.get('q') || '';
  const list = await api('/files?' + new URLSearchParams({ ...(cat ? { category: cat } : {}), ...(kw ? { q: kw } : {}) }).toString());
  if (my !== seq) return;
  const cats = [['', '全部'], ['attachment', '单据附件'], ['contract', '合同扫描件'], ['invoice', '发票'], ['receipt', '送货回单'], ['stamp', '电子章'], ['logo', 'Logo'], ['other', '其他']];
  const cards = list.map((f) => {
    const isImg = /^image\//.test(f.mime || '');
    return `<div class="file-card">
      <div class="thumb">${isImg ? `<img src="${fileUrl(f.id)}" loading="lazy">` : `<span class="ft">${esc((f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 5))}</span>`}</div>
      <div class="info"><b title="${esc(f.name)}">${esc(f.name)}</b><span>${(f.size / 1024).toFixed(0)} KB · ${esc(f.created_at.slice(0, 10))}${f.doc_count ? ' · 关联 ' + f.doc_count : ''}</span></div>
      <div class="acts"><a class="btn sm" href="/api/files/${f.id}/raw?token=${encodeURIComponent(state.token)}" target="_blank">查看</a>
        <a class="btn sm" href="/api/files/${f.id}/download?token=${encodeURIComponent(state.token)}">下载</a>
        ${['admin', 'manager'].includes(state.user.role) ? `<button class="btn sm danger" data-del="${f.id}">删除</button>` : ''}</div>
    </div>`;
  }).join('');
  const v = view(`<div class="page-head"><div><h2>文件库</h2><div class="desc">合同扫描件、发票、送货回单、电子章等集中存放；也可在单据详情里直接上传</div></div>
      <div class="actions"><button class="btn primary" id="btnUpload">+ 上传文件</button></div></div>
    <div class="card"><div class="toolbar">
      ${cats.map(([k, l]) => `<a class="btn sm ${k === cat ? 'primary' : ''}" href="#/files${k ? '?cat=' + k : ''}">${l}</a>`).join('')}
      <div class="spacer"></div>
      <form id="fFile" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="文件名"></div><button class="btn">搜索</button></form>
    </div></div>
    <div style="margin-top:14px">${cards ? `<div class="file-grid">${cards}</div>` : '<div class="card"><div class="empty"><b>没有文件</b>点右上角上传，或到单据详情里添加附件</div></div>'}</div>`, 'files', '文件库');
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.hidden = true;
  document.body.appendChild(input);
  v.querySelector('#btnUpload').onclick = () => input.click();
  input.onchange = async () => {
    if (!input.files.length) return;
    const fd = new FormData();
    [...input.files].forEach((f) => fd.append('file', f));
    try { await api('/files?category=' + (cat || 'other'), { method: 'POST', body: fd }); toast('已上传'); route(); } catch (e) { toast(e.message, true); }
    input.remove();
  };
  v.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('删除这个文件？')) return;
    try { await api('/files/' + b.dataset.del, { method: 'DELETE' }); toast('已删除'); route(); } catch (e) { toast(e.message, true); }
  });
  v.querySelector('#fFile').onsubmit = (e) => {
    e.preventDefault();
    const kwv = new FormData(e.target).get('q');
    location.hash = '#/files?' + new URLSearchParams({ ...(cat ? { cat } : {}), ...(kwv ? { q: kwv } : {}) }).toString();
  };
}

/* ---------------- 用户 ---------------- */
async function pageUsers(q, my) {
  if (state.user.role !== 'admin') { location.hash = '#/dashboard'; return; }
  const list = await api('/users');
  if (my !== seq) return;
  const rows = list.map((u) => `<tr>
      <td><b>${esc(u.name)}</b><div class="tiny">${esc(u.username)}</div></td>
      <td>${esc(roleLabel(u.role))}</td><td class="mono">${esc(u.phone || '—')}</td>
      <td><span class="badge ${u.active ? 'accepted' : 'closed'}">${u.active ? '启用' : '停用'}</span></td>
      <td class="tiny">${esc(u.created_at.slice(0, 10))}</td>
      <td><a href="#" data-edit="${u.id}">编辑</a> ${u.active ? `<a href="#" data-del="${u.id}" style="color:#c0392b">停用</a>` : ''}</td></tr>`).join('');
  const v = view(`<div class="page-head"><div><h2>用户管理</h2><div class="desc">账号、角色与权限；业务员可开单，主管可删除与导入，管理员可管账号与主体</div></div>
      <div class="actions"><button class="btn primary" id="btnAddUser">+ 新增用户</button></div></div>
    <div class="card"><table class="tb"><thead><tr><th>姓名 / 账号</th><th>角色</th><th>电话</th><th>状态</th><th>创建</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`, 'users', '用户管理');
  v.querySelector('#btnAddUser').onclick = () => userForm();
  v.querySelectorAll('[data-edit]').forEach((a) => a.onclick = (e) => { e.preventDefault(); userForm(list.find((x) => String(x.id) === a.dataset.edit)); });
  v.querySelectorAll('[data-del]').forEach((a) => a.onclick = async (e) => {
    e.preventDefault();
    if (!await confirmBox('停用该账号？停用后不能登录，数据保留。')) return;
    try { await api('/users/' + a.dataset.del, { method: 'DELETE' }); toast('已停用'); route(); } catch (err) { toast(err.message, true); }
  });
}

function userForm(u) {
  const m = modal({
    title: u ? '编辑用户' : '新增用户',
    body: `<div class="grid2">
      <div class="field"><label>账号 ${u ? '（不可改）' : '*'}</label><input class="input" id="ufUser" value="${esc(u && u.username || '')}" ${u ? 'disabled' : ''}></div>
      <div class="field"><label>姓名</label><input class="input" id="ufName" value="${esc(u && u.name || '')}"></div>
      <div class="field"><label>角色</label><select class="input" id="ufRole">${state.meta.roles.map((r) => `<option value="${r.key}" ${u && u.role === r.key ? 'selected' : ''}>${r.label}</option>`).join('')}</select></div>
      <div class="field"><label>电话</label><input class="input" id="ufPhone" value="${esc(u && u.phone || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>密码 ${u ? '（留空不改）' : '*'}</label><input class="input" type="password" id="ufPwd" placeholder="至少 6 位"></div>
      ${u ? `<div class="field"><label>状态</label><select class="input" id="ufActive"><option value="1" ${u.active ? 'selected' : ''}>启用</option><option value="0" ${!u.active ? 'selected' : ''}>停用</option></select></div>` : ''}
    </div>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="ufSave">保存</button>',
  });
  m.root.querySelector('#ufSave').onclick = async () => {
    const body = {
      username: m.root.querySelector('#ufUser').value, name: m.root.querySelector('#ufName').value,
      role: m.root.querySelector('#ufRole').value, phone: m.root.querySelector('#ufPhone').value,
      password: m.root.querySelector('#ufPwd').value,
    };
    if (u && m.root.querySelector('#ufActive')) body.active = Number(m.root.querySelector('#ufActive').value);
    try {
      if (u) await api('/users/' + u.id, { method: 'PUT', body });
      else await api('/users', { method: 'POST', body });
      m.close(); toast('已保存'); route();
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------------- 设置 ---------------- */
async function pageSettings(q, my) {
  const v = view(`<div class="page-head"><div><h2>系统设置</h2><div class="desc">公司主体与电子章、账号密码、旧数据导入</div></div></div>
    <div class="card"><h3>公司主体</h3><div class="card-sub">报价单、合同、送货单可分别选择主体；编号前缀取主体代码</div>
      <div id="coBox" class="grid3"></div></div>

    <div class="card" style="margin-top:14px"><h3>从旧工具导入数据</h3>
      <div class="card-sub">支持三个单文件工具「导出全部 / 导出备份」的 JSON：报价单（ac-quote-all）、合同（sale-contract）、送货单（records + products）。客户、货品、单据会去重导入，已有的不覆盖。</div>
      <div class="drop" id="impBox">点击选择备份 JSON 文件</div>
      <input type="file" id="impInput" accept=".json,application/json" hidden>
      <div id="impResult" class="tiny" style="margin-top:10px"></div>
    </div>

    <div class="card" style="margin-top:14px"><h3>账号</h3>
      <div class="kv"><div><div class="k">当前账号</div><div class="v">${esc(state.user.username)}（${esc(roleLabel(state.user.role))}）</div></div></div>
      <button class="btn" id="btnPwd" style="margin-top:12px">修改我的密码</button>
    </div>

    <div class="card" style="margin-top:14px"><h3>数据备份</h3>
      <div class="card-sub">导出客户、货品、单据与公司主体为 JSON；上传的文件实体在服务器 data/files 目录，请一并复制备份。</div>
      <button class="btn" id="btnExportData">导出数据 JSON</button>
    </div>

    <div class="card" style="margin-top:14px"><h3>关于</h3>
      <div class="tiny" style="line-height:2">集中管理系统 v1.2 · Node.js 22 + SQLite · 数据目录 data/（app.db 与 files/）<br>
      建议每天备份 data 目录；部署到 NAS 用 Docker 挂载 /app/data 即可。</div>
    </div>`, 'settings', '系统设置');

  const coBox = v.querySelector('#coBox');
  coBox.innerHTML = state.companies.map((c) => `<div class="card" style="box-shadow:none">
      <div style="display:flex;gap:12px;align-items:center">
        <div style="width:46px;height:46px;border-radius:9px;background:#eef4ff;display:flex;align-items:center;justify-content:center;font-weight:700;color:#1e4b8f">${esc(c.code.toUpperCase())}</div>
        <div style="flex:1"><b>${esc(c.short_name || c.name)}</b><div class="tiny">${esc(c.name)}</div></div>
      </div>
      <div class="field" style="margin-top:12px"><label>公司全称</label><input class="input" data-co="${c.id}" data-k="name" value="${esc(c.name)}"></div>
      <div class="grid2">
        <div class="field"><label>简称</label><input class="input" data-co="${c.id}" data-k="short_name" value="${esc(c.short_name)}"></div>
        <div class="field"><label>代表人</label><input class="input" data-co="${c.id}" data-k="rep" value="${esc(c.rep)}"></div>
        <div class="field"><label>电话</label><input class="input" data-co="${c.id}" data-k="phone" value="${esc(c.phone)}"></div>
        <div class="field"><label>传真</label><input class="input" data-co="${c.id}" data-k="fax" value="${esc(c.fax)}"></div>
        <div class="field" style="grid-column:1/-1"><label>地址</label><input class="input" data-co="${c.id}" data-k="addr" value="${esc(c.addr)}"></div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:4px">
        <div style="flex:1"><div class="tiny">Logo</div>${c.logo_file_id ? `<img src="${fileUrl(c.logo_file_id)}" style="height:34px;margin-top:4px">` : '<div class="tiny">未上传</div>'}</div>
        <div style="flex:1"><div class="tiny">电子章</div>${c.stamp_file_id ? `<img src="${fileUrl(c.stamp_file_id)}" style="height:44px;margin-top:4px">` : '<div class="tiny">未上传</div>'}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn sm" data-up="${c.id}" data-kind="logo">上传 Logo</button>
        <button class="btn sm" data-up="${c.id}" data-kind="stamp">上传电子章</button>
        <button class="btn sm primary" data-save="${c.id}">保存</button>
      </div>
    </div>`).join('');

  coBox.querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
    const id = Number(b.dataset.save);
    const body = {};
    coBox.querySelectorAll(`[data-co="${id}"]`).forEach((inp) => { body[inp.dataset.k] = inp.value; });
    try { await api('/companies/' + id, { method: 'PUT', body }); state.companies = await api('/companies'); toast('已保存'); route(); } catch (e) { toast(e.message, true); }
  });
  coBox.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    document.body.appendChild(input);
    input.onchange = async () => {
      if (!input.files[0]) return;
      const fd = new FormData(); fd.append('file', input.files[0]);
      try { await api(`/companies/${b.dataset.up}/${b.dataset.kind}`, { method: 'POST', body: fd }); state.companies = await api('/companies'); toast('已上传'); route(); } catch (e) { toast(e.message, true); }
      input.remove();
    };
    input.click();
  });

  const impInput = v.querySelector('#impInput');
  v.querySelector('#impBox').onclick = () => impInput.click();
  impInput.onchange = async () => {
    if (!impInput.files[0]) return;
    const fd = new FormData(); fd.append('file', impInput.files[0]);
    const box = v.querySelector('#impResult');
    box.textContent = '正在导入…';
    try {
      const r = await api('/import/legacy', { method: 'POST', body: fd });
      box.innerHTML = `<b>导入完成</b>：客户 ${r.customers} 家，货品 ${r.products} 条，单据 ${r.documents} 张，跳过 ${r.skipped} 张。
        ${r.errors && r.errors.length ? '<br>提示：' + r.errors.slice(0, 5).map(esc).join('；') : ''}`;
      state.customers = await api('/customers'); state.products = await api('/products');
      toast('导入完成');
    } catch (e) { box.textContent = ''; toast(e.message, true); }
  };

  v.querySelector('#btnPwd').onclick = () => passwordForm();
  v.querySelector('#btnExportData').onclick = async () => {
    try {
      const data = await api('/export/backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '集中管理系统备份_' + today() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('已导出备份');
    } catch (e) { toast(e.message, true); }
  };
}

function passwordForm() {
  const m = modal({
    title: '修改密码',
    body: `<div class="field"><label>原密码</label><input class="input" type="password" id="pwOld"></div>
      <div class="field"><label>新密码（至少 6 位）</label><input class="input" type="password" id="pwNew"></div>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="pwSave">保存</button>',
  });
  m.root.querySelector('#pwSave').onclick = async () => {
    try {
      await api('/auth/password', { method: 'PUT', body: { old_password: m.root.querySelector('#pwOld').value, password: m.root.querySelector('#pwNew').value } });
      m.close(); toast('密码已修改');
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------------- 人民币大写（与后端一致） ---------------- */
function cnyUpper(n) {
  const amount = Math.round((Number(n) || 0) * 100) / 100;
  if (!amount) return '零元整';
  const negative = amount < 0;
  let abs = Math.abs(amount);
  const fraction = ['角', '分'];
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const unit = [['元', '万', '亿', '兆'], ['', '拾', '佰', '仟']];
  let s = '';
  for (let i = 0; i < fraction.length; i++) s += (digit[Math.floor(abs * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, '');
  s = s || '整';
  abs = Math.floor(abs);
  for (let i = 0; i < unit[0].length && abs > 0; i++) {
    let p = '';
    for (let j = 0; j < unit[1].length && abs > 0; j++) { p = digit[abs % 10] + unit[1][j] + p; abs = Math.floor(abs / 10); }
    s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s;
  }
  return (negative ? '负' : '') + s.replace(/(零.)*零元/, '元').replace(/(零.)+/g, '零').replace(/^整$/, '零元整');
}

/* ---------------- 游客模式 ---------------- */
let guestMode = false;
let GE = null;              // 当前游客编辑状态
let guestTimer = null;
const GUEST_STAMP = 'guest-stamp-v1';
const GUEST_CUST = 'guest-customers-v1';
const GUEST_PROD = 'guest-products-v1';
const GUEST_SEQ = 'guest-seq-v1';

const FALLBACK_COMPANIES = [
  { id: 1, code: 'jxt', name: '苏州捷信通信息技术有限公司', short_name: '捷信通', addr: '', rep: '司婷婷', phone: '18915588129', fax: '0512-38138215' },
  { id: 2, code: 'yzl', name: '苏州悦智乐智能科技有限公司', short_name: '悦智乐', addr: '', rep: '', phone: '', fax: '' },
  { id: 3, code: 'ac', name: '苏州安驰电子科技有限公司', short_name: '安驰', addr: '', rep: '', phone: '0512-68128072', fax: '' },
];

function localGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function localSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function guestCompanies() { return (state.guestCompanies && state.guestCompanies.length) ? state.guestCompanies : FALLBACK_COMPANIES; }
function guestCompany(id) { return guestCompanies().find((c) => c.id === Number(id)) || guestCompanies()[0]; }

function guestNo(type, co, subtype) {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const tc = type === 'quote' ? 'BJ' : type === 'contract' ? 'HT' : (subtype === '样品单' ? 'DB' : subtype === '提前送货单' ? 'TQ' : 'XS');
  const seq = localGet(GUEST_SEQ, {});
  const key = `${co.code.toUpperCase()}-${tc}-${day}`;
  seq[key] = (seq[key] || 0) + 1;
  localSet(GUEST_SEQ, seq);
  return `${co.code.toUpperCase()}-${tc}-${day}-${String(seq[key]).padStart(3, '0')}`;
}

function guestLoad(type) {
  const saved = localGet('guest-draft-' + type, null);
  if (saved && saved.payload) {
    const co = guestCompany(saved.company_id);
    saved.type = type;
    saved.company_id = co.id;
    saved.payload.company = saved.payload.company || co.code;
    return saved;
  }
  const co = guestCompanies()[0];
  const payload = blankPayload(type, co);
  const no = guestNo(type, co, payload.dtype);
  payload.no = no;
  return { type, payload, doc_no: no, doc_date: payload.date, company_id: co.id };
}

function rememberGuestCustomer(p) {
  const name = (p.cust && p.cust.name) || p.customer || '';
  if (!name) return;
  const list = localGet(GUEST_CUST, []);
  const item = {
    name,
    contact: (p.cust && (p.cust.contact || p.cust.rep)) || '',
    phone: (p.cust && p.cust.phone) || '',
    addr: (p.cust && p.cust.addr) || '',
  };
  const i = list.findIndex((x) => x.name === name);
  if (i >= 0) list[i] = Object.assign(list[i], item);
  else list.unshift(item);
  localSet(GUEST_CUST, list.slice(0, 50));
}

function rememberGuestProducts(items) {
  const list = localGet(GUEST_PROD, []);
  for (const it of items || []) {
    const spec = String(it.spec || '').trim();
    const name = String(it.name || '').trim();
    if (!spec || !name) continue;
    const i = list.findIndex((x) => x.spec === spec);
    const item = { spec, name, price: Number(it.price) || 0, unit: it.unit || '' };
    if (i >= 0) list[i] = Object.assign(list[i], item);
    else list.unshift(item);
  }
  localSet(GUEST_PROD, list.slice(0, 300));
}

function guestSave() {
  if (!GE) return;
  const p = JSON.parse(JSON.stringify(GE.payload));
  if (p.stamp) delete p.stamp.data;
  const ok = localSet('guest-draft-' + GE.type, {
    payload: p, doc_no: GE.doc_no, doc_date: GE.doc_date, company_id: GE.company_id, updated: Date.now(),
  });
  if (!ok) toast('本机存储空间不足，草稿未保存；请清理浏览器数据或改用登录保存', true);
  rememberGuestCustomer(p);
  rememberGuestProducts(p.items);
}
function guestSaveDebounced() { clearTimeout(guestTimer); guestTimer = setTimeout(guestSave, 500); }

function renderGuestShell() {
  app.innerHTML = `<div class="guest-wrap">
      <header class="guest-head">
        <div class="brand"><div class="brand-mark">集</div><div class="brand-text"><b>集中管理系统</b><span>报价 · 合同 · 送货单</span></div></div>
        <span class="guest-tag">游客模式</span>
        <div class="spacer"></div>
        <span class="guest-hint">草稿只存本浏览器，不上传服务器</span>
        <a class="btn primary" href="#/login">登录 / 完整功能</a>
      </header>
      <main class="guest-main" id="guestView"></main>
    </div>`;
}

function gview(html) {
  const v = document.getElementById('guestView');
  if (v) v.innerHTML = html;
  window.scrollTo({ top: 0 });
  return v;
}

function guestHome() {
  const drafts = ['quote', 'contract', 'delivery'].map((t) => {
    const d = localGet('guest-draft-' + t, null);
    if (!d || !d.payload) return null;
    const p = d.payload;
    const amount = (p.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    return { type: t, no: d.doc_no, date: d.doc_date, name: (p.cust && p.cust.name) || p.customer || '未填客户', amount };
  }).filter(Boolean);

  const cards = [
    { type: 'quote', title: '报价单', desc: '给客户的产品报价，含税价、明细、条款、大写金额' },
    { type: 'contract', title: '销售合同', desc: '成交后签的购销合同，可盖你自己上传的章' },
    { type: 'delivery', title: '送货单', desc: '发货清单，A4 打印，可另存 PDF 后按三联纸缩放' },
  ].map((c) => `<div class="type-card">
      <div class="tc-ic">${c.type === 'quote' ? '￥' : c.type === 'contract' ? '✎' : '⇥'}</div>
      <h3>${c.title}</h3><p>${c.desc}</p>
      <a class="btn primary" href="#/new?type=${c.type}">开始填写</a>
    </div>`).join('');

  const draftRows = drafts.length ? drafts.map((d) => `<div class="task" data-edit="${d.type}">
      <span class="type-tag ${d.type}">${typeLabel(d.type)}</span>
      <div class="t"><b>${esc(d.name)}</b><span>${esc(d.no)} · ${esc(d.date)} · ￥${fmt(d.amount)}</span></div>
      <button class="btn sm" data-del="${d.type}">删除</button>
    </div>`).join('') : '<div class="empty" style="padding:18px">还没有本地草稿，从上面选一种开始</div>';

  const v = gview(`
    <section class="guest-hero">
      <h1>不登录，也能直接开单</h1>
      <p>报价单、销售合同、送货单三张单子随便填、随便打，数据只留在你这台电脑的浏览器里。<br>
      系统内置的公司电子章需要登录后才能用；游客可以用自己上传的章。</p>
      <div class="guest-badges"><span>✓ 三套 A4 版式</span><span>✓ 打印 / 另存 PDF</span><span>✓ 自己上传电子章</span><span>✕ 不含系统内置章</span></div>
    </section>
    <div class="type-cards">${cards}</div>
    <div class="card" style="margin-top:18px"><h3>我的本地草稿</h3><div class="card-sub">每类单据保留最近一份，可继续编辑</div>
      <div class="task-list">${draftRows}</div>
    </div>
    <div class="card" style="margin-top:14px"><h3>登录后多什么</h3>
      <div class="kv">
        <div><div class="k">电子章</div><div class="v">系统内置三家公司的章，一键加盖</div></div>
        <div><div class="k">客户 / 货品</div><div class="v">共用档案，输入即联想，自动建档</div></div>
        <div><div class="k">云端保存</div><div class="v">单据存在服务器，换电脑也在，多人协作</div></div>
        <div><div class="k">文件与统计</div><div class="v">扫描件 / 发票 / 回单归档，工作台看板</div></div>
      </div>
      <a class="btn" href="#/login" style="margin-top:12px">去登录</a>
    </div>
    <div class="guest-foot">
      <button class="btn sm" id="gWipe">清除本机游客数据</button>
      <span class="tiny">清掉草稿、上传的章和本机客户记忆，服务器数据不受影响</span>
    </div>`);

  v.querySelectorAll('[data-edit]').forEach((el) => el.onclick = (e) => {
    if (e.target.dataset.del) return;
    location.hash = '#/new?type=' + el.dataset.edit;
  });
  v.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    localStorage.removeItem('guest-draft-' + b.dataset.del);
    toast('已删除该草稿');
    guestHome();
  });
  v.querySelector('#gWipe').onclick = async () => {
    if (!await confirmBox('清除本机保存的游客草稿、章图和客户记忆？服务器上的数据不受影响。', '清除')) return;
    ['quote', 'contract', 'delivery'].forEach((t) => localStorage.removeItem('guest-draft-' + t));
    [GUEST_STAMP, GUEST_CUST, GUEST_PROD, GUEST_SEQ].forEach((k) => localStorage.removeItem(k));
    toast('已清除本机游客数据');
    guestHome();
  };
}

function guestEditor(type) {
  if (!GE || GE.type !== type) GE = guestLoad(type);
  const co = guestCompany(GE.company_id);
  GE.company_id = co.id;
  const p = GE.payload;
  p.company = p.company || co.code;
  if (!p.cust) p.cust = { name: '', contact: '', phone: '', addr: '', rep: '', fax: '', about: '' };
  if (!Array.isArray(p.items) || !p.items.length) p.items = [blankItem(type)];
  if (type === 'contract' && !Array.isArray(p.terms)) p.terms = blankPayload('contract', co).terms;
  if (type === 'quote' && (!p.terms || Array.isArray(p.terms))) p.terms = { delivery: '', invoice: '', extra: [] };
  if (!p.stamp) p.stamp = { on: type === 'contract', size: type === 'contract' ? 40 : 42 };

  const stampData = localGet(GUEST_STAMP, '');
  if (!stampData && p.stamp) p.stamp.on = false;
  const custList = localGet(GUEST_CUST, []);
  const prodList = localGet(GUEST_PROD, []);
  const itemCols = type === 'delivery'
    ? [['name', '品名'], ['spec', '规格型号'], ['proj', '项目'], ['unit', '单位'], ['qty', '数量'], ['pin', '批号/备注']]
    : [['name', '品名'], ['spec', '规格型号'], ['qty', '数量'], ['price', '单价']];

  const itemsHtml = () => p.items.map((it, i) => `<tr data-row="${i}">
      <td class="c" style="width:34px">${i + 1}</td>
      ${itemCols.map(([k, label]) => `<td><input data-idx="${i}" data-f="${k}" value="${esc(it[k] == null ? '' : it[k])}" placeholder="${label}"></td>`).join('')}
      ${type === 'delivery' ? '' : `<td class="amt">￥${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>`}
      <td style="width:30px"><button class="del" data-del="${i}" title="删除本行">×</button></td>
    </tr>`).join('');

  const termsHtml = () => type === 'contract'
    ? p.terms.map((t, i) => `<div class="term-row" data-term="${i}">
        <input type="checkbox" data-tf="on" ${t.on !== false ? 'checked' : ''}>
        <input class="input" data-tf="label" value="${esc(t.label || '')}" placeholder="条目标签，可空">
        <input class="input" data-tf="text" value="${esc(t.text || '')}" placeholder="条款内容">
        <button class="del" data-tdel="${i}" style="border:0;background:none;cursor:pointer;color:#b9c3d3">×</button>
      </div>`).join('')
    : `<div class="grid3">
        <div class="field"><label>交货期</label><input class="input" data-tk="delivery" value="${esc((p.terms && p.terms.delivery) || '')}"></div>
        <div class="field"><label>发票</label><input class="input" data-tk="invoice" value="${esc((p.terms && p.terms.invoice) || '')}"></div>
        <div class="field"><label>报价有效期（天）</label><input class="input" type="number" data-tk="validDays" value="${esc(p.validDays || 7)}"></div>
      </div>
      <div class="field"><label>其他条款（每行一条）</label><textarea class="input" rows="2" data-tk="extra">${esc(((p.terms && p.terms.extra) || []).join('\n'))}</textarea></div>`;

  const stampCard = type === 'delivery' ? '' : `<div class="card" style="margin-top:14px">
      <h3>电子章 <span class="tiny">游客只能用自己上传的章；系统内置章需登录</span></h3>
      <div class="databar">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="gStampOn" ${p.stamp.on ? 'checked' : ''}> 加盖我上传的章</label>
        <span class="tiny" id="gStampState">${stampData ? '已上传' : '未上传'}</span>
        <button class="btn sm" id="gStampUpload">上传章图</button>
        <button class="btn sm" id="gStampClear">清除</button>
        <span class="tiny">直径</span><input class="input" type="number" id="gStampSize" value="${esc(p.stamp.size || 40)}" min="20" max="70" style="width:76px">
        <span class="tiny">mm</span>
        <div class="spacer"></div>
        <img id="gStampPrev" src="${stampData || ''}" style="height:44px;${stampData ? '' : 'display:none'}">
      </div>
      <input type="file" id="gStampInput" accept="image/png,image/jpeg" hidden>
    </div>`;

  const v = gview(`
    <div class="page-head">
      <div><h2>${typeLabel(type)}<span class="guest-tag" style="margin-left:10px">游客</span></h2>
        <div class="desc">填完直接打印或另存 PDF；草稿只保存在本浏览器，登录后可存到服务器</div></div>
      <div class="actions">
        <button class="btn" id="gSave">保存草稿</button>
        <button class="btn" id="gNew">新建一张</button>
        <button class="btn primary" id="gPrint">打印 / PDF</button>
        <a class="btn" href="#/login">登录</a>
      </div>
    </div>

    <div class="card">
      <h3>基本信息</h3>
      <div class="grid4">
        <div class="field"><label>公司主体</label><select class="input" id="gCompany">${guestCompanies().map((c) => `<option value="${c.id}" ${c.id === co.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>单据编号</label><input class="input mono" id="gNo" value="${esc(GE.doc_no)}"></div>
        <div class="field"><label>单据日期</label><input class="input" type="date" id="gDate" value="${esc(GE.doc_date)}"></div>
        ${type === 'delivery'
    ? `<div class="field"><label>单据类型</label><select class="input" id="gDtype">${['送货单', '样品单', '提前送货单'].map((x) => `<option ${p.dtype === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`
    : `<div class="field"><label>税率</label><select class="input" id="gTax">${[13, 9, 6, 3, 0].map((x) => `<option value="${x}" ${Number(p.taxRate) === x ? 'selected' : ''}>${x}%</option>`).join('')}</select></div>`}
      </div>
      <div class="grid3">
        <div class="field"><label>${type === 'delivery' ? '收货单位' : '客户名称'}</label>
          <input class="input" id="gCust" list="gCustList" value="${esc(type === 'delivery' ? (p.customer || '') : (p.cust.name || ''))}" placeholder="填写客户名称">
          <datalist id="gCustList">${custList.map((c) => `<option value="${esc(c.name)}">${esc([c.contact, c.phone].filter(Boolean).join(' · '))}</option>`).join('')}</datalist></div>
        <div class="field"><label>联系人 / 代表人</label><input class="input" id="gContact" value="${esc(p.cust.contact || '')}"></div>
        <div class="field"><label>电话</label><input class="input" id="gPhone" value="${esc(p.cust.phone || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>地址</label><input class="input" id="gAddr" value="${esc(p.cust.addr || '')}"></div>
        ${type === 'delivery' ? `<div class="field"><label>关联合同号</label><input class="input" id="gContract" value="${esc((p.items[0] && p.items[0].contract) || '')}" placeholder="可空"></div>` : ''}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>明细 <span class="tiny">在「规格型号」输入可带出本机记住的品名与单价</span></h3>
      <div class="databar">
        <button class="btn sm" id="gAddRow">+ 加一行</button>
        <button class="btn sm" id="gPaste">从 Excel 粘贴</button>
        <div class="spacer"></div>
        ${type === 'delivery' ? '' : '<span class="tiny">合计 <b id="gTotal" style="color:#1e4b8f;font-size:16px">￥0.00</b></span>'}
      </div>
      <table class="items-table"><thead><tr><th style="width:34px">#</th>
        ${itemCols.map(([, l]) => `<th>${l}</th>`).join('')}
        ${type === 'delivery' ? '' : '<th style="width:100px">金额</th>'}<th style="width:30px"></th></tr></thead>
        <tbody id="gItemBody">${itemsHtml()}</tbody></table>
      ${type === 'delivery' ? '' : `<div class="total-line"><span class="upper" id="gUpper">${esc(cnyUpper(0))}</span><span>合计 <span class="sum" id="gSum">￥0.00</span></span></div>`}
      <div class="field" style="margin-top:12px"><label>备注</label><textarea class="input" id="gRemark" rows="2">${esc(p.remark || '')}</textarea></div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>条款</h3>
      <div id="gTermsBox">${termsHtml()}</div>
      ${type === 'contract' ? '<button class="btn sm" id="gAddTerm" style="margin-top:6px">+ 加一条条款</button>' : ''}
      <datalist id="gProdList">${prodList.map((x) => `<option value="${esc(x.spec)}">${esc(x.name)}${x.price ? ' ￥' + x.price : ''}</option>`).join('')}</datalist>
    </div>
    ${stampCard}`);

  /* 合计 */
  const recalc = () => {
    if (type === 'delivery') return;
    let total = 0;
    p.items.forEach((it) => { total += (Number(it.qty) || 0) * (Number(it.price) || 0); });
    v.querySelector('#gSum').textContent = '￥' + fmt(total);
    v.querySelector('#gUpper').textContent = cnyUpper(total);
    v.querySelector('#gTotal').textContent = '￥' + fmt(total);
    v.querySelectorAll('tr[data-row]').forEach((tr) => {
      const it = p.items[Number(tr.dataset.row)];
      const amt = tr.querySelector('.amt');
      if (amt) amt.textContent = '￥' + fmt((Number(it.qty) || 0) * (Number(it.price) || 0));
    });
  };

  const bindRows = () => {
    v.querySelectorAll('#gItemBody input').forEach((inp) => {
      inp.oninput = () => { p.items[Number(inp.dataset.idx)][inp.dataset.f] = inp.value; recalc(); guestSaveDebounced(); };
      if (inp.dataset.f === 'spec') {
        inp.setAttribute('list', 'gProdList');
        inp.onchange = () => {
          const hit = localGet(GUEST_PROD, []).find((x) => x.spec === inp.value);
          const row = p.items[Number(inp.dataset.idx)];
          const tr = inp.closest('tr');
          if (hit) {
            if (!row.name) { row.name = hit.name; tr.querySelector('[data-f="name"]').value = hit.name; }
            if (!row.price && hit.price) { row.price = hit.price; const pi = tr.querySelector('[data-f="price"]'); if (pi) pi.value = hit.price; }
            if (!row.unit && hit.unit) { row.unit = hit.unit; const ui = tr.querySelector('[data-f="unit"]'); if (ui) ui.value = hit.unit; }
            recalc(); guestSaveDebounced();
          }
        };
      }
    });
    v.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => {
      e.preventDefault();
      p.items.splice(Number(b.dataset.del), 1);
      if (!p.items.length) p.items.push(blankItem(type));
      drawRows();
    });
  };
  const drawRows = () => { v.querySelector('#gItemBody').innerHTML = itemsHtml(); bindRows(); recalc(); };
  bindRows(); recalc();

  v.querySelector('#gAddRow').onclick = () => { p.items.push(blankItem(type)); drawRows(); guestSaveDebounced(); };
  v.querySelector('#gPaste').onclick = () => openPaste(p, type, () => { drawRows(); guestSaveDebounced(); });

  v.querySelector('#gCust').onchange = (e) => {
    const name = e.target.value.trim();
    p.cust.name = name;
    if (type === 'delivery') p.customer = name;
    const hit = localGet(GUEST_CUST, []).find((x) => x.name === name);
    if (hit) {
      if (!p.cust.contact && hit.contact) { p.cust.contact = hit.contact; v.querySelector('#gContact').value = hit.contact; }
      if (!p.cust.phone && hit.phone) { p.cust.phone = hit.phone; v.querySelector('#gPhone').value = hit.phone; }
      if (!p.cust.addr && hit.addr) { p.cust.addr = hit.addr; v.querySelector('#gAddr').value = hit.addr; }
    }
    guestSaveDebounced();
  };
  v.querySelector('#gContact').oninput = (e) => { p.cust.contact = e.target.value; guestSaveDebounced(); };
  v.querySelector('#gPhone').oninput = (e) => { p.cust.phone = e.target.value; guestSaveDebounced(); };
  v.querySelector('#gAddr').oninput = (e) => { p.cust.addr = e.target.value; guestSaveDebounced(); };
  v.querySelector('#gRemark').oninput = (e) => { p.remark = e.target.value; guestSaveDebounced(); };
  v.querySelector('#gNo').oninput = (e) => { GE.doc_no = e.target.value; p.no = e.target.value; guestSaveDebounced(); };
  v.querySelector('#gDate').onchange = (e) => { GE.doc_date = e.target.value; p.date = e.target.value; guestSaveDebounced(); };
  if (v.querySelector('#gTax')) v.querySelector('#gTax').onchange = (e) => { p.taxRate = Number(e.target.value); guestSaveDebounced(); };
  if (v.querySelector('#gDtype')) v.querySelector('#gDtype').onchange = (e) => { p.dtype = e.target.value; guestSaveDebounced(); };
  if (v.querySelector('#gContract')) v.querySelector('#gContract').oninput = (e) => { p.items.forEach((it) => { it.contract = e.target.value; }); guestSaveDebounced(); };

  v.querySelector('#gCompany').onchange = (e) => {
    const next = guestCompany(e.target.value);
    GE.company_id = next.id;
    p.company = next.code;
    if (type !== 'delivery') p.self = { name: next.name, addr: next.addr, rep: next.rep, phone: next.phone, fax: next.fax };
    if (!localGet('guest-draft-' + type, null)) {
      const no = guestNo(type, next, p.dtype);
      GE.doc_no = no; p.no = no; v.querySelector('#gNo').value = no;
    }
    guestSaveDebounced();
  };

  // 条款
  const bindTerms = () => {
    v.querySelectorAll('[data-tf]').forEach((inp) => {
      const i = Number(inp.closest('[data-term]').dataset.term);
      inp.oninput = inp.onchange = () => {
        if (inp.dataset.tf === 'on') p.terms[i].on = inp.checked;
        else p.terms[i][inp.dataset.tf] = inp.value;
        guestSaveDebounced();
      };
    });
    v.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = (e) => {
      e.preventDefault(); p.terms.splice(Number(b.dataset.tdel), 1); drawTerms();
    });
  };
  const drawTerms = () => { v.querySelector('#gTermsBox').innerHTML = termsHtml(); bindTerms(); };
  bindTerms();
  if (v.querySelector('#gAddTerm')) v.querySelector('#gAddTerm').onclick = () => {
    p.terms.push({ id: 'custom' + Date.now(), label: '', text: '', on: true }); drawTerms(); guestSaveDebounced();
  };
  v.querySelectorAll('[data-tk]').forEach((inp) => {
    inp.oninput = () => {
      const k = inp.dataset.tk;
      if (k === 'validDays') p.validDays = Number(inp.value) || 0;
      else if (k === 'extra') p.terms.extra = inp.value.split('\n').filter(Boolean);
      else p.terms[k] = inp.value;
      guestSaveDebounced();
    };
  });

  // 电子章（仅本人上传）
  if (type !== 'delivery') {
    const fileInput = v.querySelector('#gStampInput');
    v.querySelector('#gStampUpload').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try {
        const data = await makeStampData(f);
        localSet(GUEST_STAMP, data);
        p.stamp.on = true; p.stamp.size = p.stamp.size || 40;
        guestSave();
        toast('章图已保存到本浏览器');
        guestEditor(type);
      } catch (err) { toast(err.message, true); }
    };
    v.querySelector('#gStampClear').onclick = () => {
      localStorage.removeItem(GUEST_STAMP);
      if (p.stamp) p.stamp.on = false;
      guestSave(); toast('已清除章图'); guestEditor(type);
    };
    v.querySelector('#gStampOn').onchange = (e) => {
      if (e.target.checked && !localGet(GUEST_STAMP, '')) {
        e.target.checked = false;
        toast('请先上传你自己的章图'); return;
      }
      p.stamp.on = e.target.checked; guestSaveDebounced();
    };
    v.querySelector('#gStampSize').oninput = (e) => { p.stamp.size = Number(e.target.value) || 40; guestSaveDebounced(); };
  }

  v.querySelector('#gSave').onclick = () => { guestSave(); toast('已保存到本机草稿'); };
  v.querySelector('#gNew').onclick = async () => {
    if (!await confirmBox('新建一张？当前草稿会被覆盖。', '新建')) return;
    localStorage.removeItem('guest-draft-' + type);
    GE = guestLoad(type);
    guestEditor(type);
    toast('已新建');
  };
  v.querySelector('#gPrint').onclick = () => { guestSave(); guestPrint(); };
}

function makeStampData(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 1024;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        let data = c.toDataURL('image/png');
        if (data.length > 2000000) throw new Error('章图太大，请换一张清晰但体积小一点的 PNG');
        URL.revokeObjectURL(url);
        resolve(data);
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

function guestPrint() {
  if (!GE) return;
  const co = guestCompany(GE.company_id);
  const p = GE.payload;
  const stampData = localGet(GUEST_STAMP, '');
  const on = GE.type !== 'delivery' && p.stamp && p.stamp.on && stampData;
  const printPayload = Object.assign(JSON.parse(JSON.stringify(p)), {
    stamp: { on: !!on, size: (p.stamp && p.stamp.size) || 40, data: on ? stampData : '' },
  });
  const doc = {
    doc_no: GE.doc_no, doc_date: GE.doc_date, payload: printPayload,
    customer_name: (p.cust && p.cust.name) || p.customer || '',
  };
  const sheet = GE.type === 'quote' ? quoteSheet(doc, co) : GE.type === 'contract' ? contractSheet(doc, co) : deliverySheet(doc, co);
  const v = gview(`<div class="print-wrap">
      <div class="print-bar no-print"><button class="btn primary" id="gDoPrint">打印 / 另存为 PDF</button>
        <button class="btn" id="gBack">返回继续编辑</button><div class="spacer"></div>
        <span class="tiny">纸张 A4 · 纵向 · 缩放 100% · 页边距「无」· 关闭页眉页脚</span></div>
      ${sheet}</div>`);
  v.querySelector('#gDoPrint').onclick = () => window.print();
  v.querySelector('#gBack').onclick = () => guestEditor(GE.type);
}

function guestRoute() {
  if (!guestMode) return;
  const r = parseHash();
  if (r.path === '/login') { renderLogin(); return; }
  if (r.path === '/new') { guestEditor(r.q.get('type') || 'quote'); return; }
  guestHome();
}

async function startGuest() {
  guestMode = true;
  try {
    const r = await api('/auth/guest');
    state.token = '';
    state.user = r.user;
    await loadBase();
    renderShell();
    if (!location.hash) history.replaceState(null, '', '#/dashboard');
    route();
  } catch {
    // 服务端不可用时退回纯本地游客页
    try { state.guestCompanies = (await api('/public/bootstrap')).companies; } catch { state.guestCompanies = FALLBACK_COMPANIES; }
    renderGuestShell();
    guestRoute();
  }
}

/* ---------------- 启动 ---------------- */
async function boot() {
  if (!state.token) { startGuest(); return; }
  try {
    const r = await api('/auth/me');
    state.user = r.user;
    guestMode = false;
    await loadBase();
    renderShell();
    if (!location.hash) location.hash = '#/dashboard';
    route();
  } catch {
    state.token = '';
    localStorage.removeItem('token');
    startGuest();
  }
}

boot();
