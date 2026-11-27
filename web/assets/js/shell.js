/* 外壳、导航、基础数据 */
import { app, state, api, esc, roleLabel } from './core.js';

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
    if (state.onLogout) document.getElementById('btnLogout').onclick = state.onLogout;
  }
}

function setNav(key, crumb) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
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
