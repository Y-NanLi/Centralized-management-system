/* 外壳、导航、基础数据 */
import { app, state, api, esc, roleLabel } from './core.js';

async function loadBase() {
  if (!state.meta) state.meta = await api('/meta');
  state.companies = await api('/companies');
  state.customers = state.user && state.user.role === 'warehouse' ? [] : await api('/customers');
  state.products = await api('/products');
  state.owners = state.user && state.user.role === 'admin' ? await api('/owners') : [];
}


/* ---------------- 外壳 ---------------- */
const NAV = [
  { key: 'dashboard', label: '工作台', icon: '◪', href: '#/dashboard' },
  { key: 'docs', label: '单据中心', icon: '▤', href: '#/docs' },
  { key: 'warehouse', label: '仓库打单', icon: '▣', href: '#/warehouse', warehouse: true },
  { key: 'customers', label: '客户档案', icon: '◎', href: '#/customers' },
  { key: 'products', label: '货品库', icon: '▦', href: '#/products' },
  { key: 'files', label: '文件库', icon: '▧', href: '#/files' },
  { key: 'recycle', label: '回收站', icon: '♻', href: '#/recycle' },
  { key: 'users', label: '用户管理', icon: '◍', href: '#/users', admin: true },
  { key: 'settings', label: '系统设置', icon: '⚙', href: '#/settings' },
];

function renderShell() {
  const isGuest = state.user.role === 'guest';
  const isWh = state.user.role === 'warehouse';
  const hideSettings = ['guest', 'sales'].includes(state.user.role);
  const nav = NAV.filter((n) => {
    if (isWh) return n.key === 'warehouse';
    return (!n.admin || state.user.role === 'admin')
      && (!n.warehouse || ['admin', 'warehouse'].includes(state.user.role))
      && (!hideSettings || n.key !== 'settings');
  }).map((n) => `
    <a class="nav-item" data-nav="${n.key}" href="${n.href}"><span class="ic">${n.icon}</span>${n.label}</a>`).join('');
  app.innerHTML = `<div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">集</div><div class="brand-text"><b>集中管理系统</b><span>${isWh ? '仓库打单' : '报价 · 合同 · 送货单'}</span></div></div>
        <nav class="nav">${nav}</nav>
        <div class="userbox">
          <div class="avatar">${esc((state.user.name || state.user.username).slice(0, 1))}</div>
          <div class="who"><b>${esc(state.user.name || state.user.username)}</b><span>${esc(roleLabel(state.user.role))}${isGuest ? ' · 免登录' : ''}</span></div>
          ${isGuest ? '<a class="out" id="btnLogin" href="#/login">登录</a>' : '<div class="out" id="btnLogout">退出</div>'}
        </div>
      </aside>
      <div class="main">
        <div class="topbar"><div class="crumb" id="crumb">工作台</div><div class="spacer"></div>
          <div class="tiny" id="topInfo">${isGuest ? '游客模式：数据仅属于本浏览器，别处看不到；注册账号可长期保存，登录时会自动并入账号' : (state.user.role === 'admin' ? '管理员：默认查看全部成员工作台，可按成员切换' : (isWh ? '仓库账号：只显示交到仓库的送货单，可接收、编辑、打印、完成' : '当前只显示你自己的客户、货品、单据和文件'))}</div></div>
        <div class="content" id="view"></div>
      </div>
    </div>`;
  if (isGuest) {
    const b = document.getElementById('btnLogin');
    if (b) b.onclick = () => { location.hash = '#/login'; };
  } else {
    if (state.onLogout) document.getElementById('btnLogout').onclick = state.onLogout;
  }
}

function setNav(key, crumb) {
  const k = state.user && state.user.role === 'warehouse' && ['docs', 'doc', 'doc/edit', 'print'].includes(key)
    ? 'warehouse' : key;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === k));
  const c = document.getElementById('crumb');
  if (c) c.textContent = crumb || '';
}


function view(html, navKey, crumb) {
  const v = document.getElementById('view');
  if (v) v.innerHTML = html;
  setNav(navKey, crumb);
  window.scrollTo({ top: 0 });
  return v;
}


export { loadBase, NAV, renderShell, setNav, view };
