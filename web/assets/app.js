/* 集中管理系统 前端入口（零构建，原生 ES Module） */
import { app, state, api, esc, toast, parseHash, nextSeq } from './js/core.js';
import { loadBase, renderShell } from './js/shell.js';
import { pageDashboard } from './js/pages/dashboard.js';
import { pageDocs, pageDocDetail } from './js/pages/documents.js';
import { pageDocNew, pageDocEdit } from './js/editor.js';
import { pagePrint } from './js/print.js';
import { pageCustomers, pageCustomer } from './js/pages/customers.js';
import { pageProducts } from './js/pages/products.js';
import { pageFiles } from './js/pages/files.js';
import { pageWarehouse } from './js/pages/warehouse.js';
import { pageRecycle } from './js/pages/recycle.js';
import { pageUsers } from './js/pages/users.js';
import { pageSettings } from './js/pages/settings.js';

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
  '/warehouse': pageWarehouse,
  '/recycle': pageRecycle,
  '/users': pageUsers,
  '/settings': pageSettings,
};

/* 仓库账号只保留仓库打单和送货单查看/编辑/打印，其余页面一律回到仓库打单 */
const WAREHOUSE_ROUTES = new Set(['/warehouse', '/doc', '/doc/edit', '/print']);
const SALES_BLOCKED = new Set(['/settings', '/users']);
const homeHash = (role) => role === 'warehouse' ? '#/warehouse' : '#/dashboard';

function logout(msg) {
  localStorage.removeItem('token');
  state.token = '';
  state.user = null;
  state.owners = [];
  history.replaceState(null, '', '#/login');
  renderLogin(msg);
}

/* ---------------- 登录 / 注册 ---------------- */
function renderLogin(msg, mode = 'login') {
  document.body.classList.remove('printing');
  const reg = mode === 'register';
  app.innerHTML = `<div class="login-wrap"><form class="login-card" id="loginForm">
      <div class="login-brand"><div class="login-logo">集</div><div><h1>集中管理系统</h1></div></div>
      <div class="sub">报价单 · 销售合同 · 送货单 一体化管理</div>
      ${msg ? `<div class="login-err">${esc(msg)}</div>` : ''}
      <div class="field"><label>用户名</label><input class="input" name="username" autocomplete="username" placeholder="支持中文，2–24 位" autofocus></div>
      ${reg ? `<div class="field"><label>显示名称</label><input class="input" name="name" placeholder="留空则与用户名相同"></div>
      <div class="field"><label>电话（可选）</label><input class="input" name="phone" placeholder="联系电话"></div>` : ''}
      <button class="btn primary" style="width:100%;justify-content:center;padding:10px" type="submit">${reg ? '注 册 并 登 录' : '登 录'}</button>
      <div class="login-note">登录不需要密码，凭用户名识别身份。用户名支持中文、字母、数字、下划线、点或短横。<br>
      每个人只能看到自己的工作台和单据；注册后默认为业务员，没有系统设置和用户管理；仓库账号只进入仓库打单。</div>
      <div class="login-switch">
        ${reg ? '已有用户名？<a href="#/login" id="toLogin">直接登录</a>' : '还没有用户名？<a href="#/login?mode=register" id="toRegister">注册一个</a>'}
      </div>
      <div style="text-align:center;margin-top:10px"><a href="#/" id="toGuest" style="font-size:12.5px;color:#6b7688">先不登录，用临时游客模式</a></div>
    </form></div>`;
  const form = document.getElementById('loginForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const path = reg ? '/auth/register' : '/auth/login';
    const body = { username: fd.get('username') };
    if (reg) { body.name = fd.get('name'); body.phone = fd.get('phone'); }
    try {
      const r = await api(path, { method: 'POST', body });
      state.token = r.token;
      state.user = r.user;
      localStorage.setItem('token', r.token);
      await loadBase();
      history.replaceState(null, '', homeHash(r.user.role));
      renderShell();
      route();
      const m = r.merged || {};
      const total = (m.documents || 0) + (m.files || 0) + (m.customers || 0) + (m.products || 0);
      if (total) toast(`登录成功，已把本浏览器的临时数据并入账号：${m.documents || 0} 张单据、${m.files || 0} 个文件、${m.customers || 0} 个客户、${m.products || 0} 条货品`);
      else toast(reg ? '注册成功' : '登录成功');
    } catch (err) {
      renderLogin(err.message, mode);
    }
  };
  const toRegister = document.getElementById('toRegister');
  if (toRegister) toRegister.onclick = (e) => { e.preventDefault(); renderLogin('', 'register'); };
  const toLogin = document.getElementById('toLogin');
  if (toLogin) toLogin.onclick = (e) => { e.preventDefault(); renderLogin(); };
  document.getElementById('toGuest').onclick = (e) => { e.preventDefault(); startGuest(); };
  form.username && form.username.focus();
}

/* ---------------- 游客身份 ---------------- */
async function startGuest() {
  try {
    const r = await api('/auth/guest');
    state.token = '';
    state.user = r.user;
    localStorage.removeItem('token');
    await loadBase();
    renderShell();
    history.replaceState(null, '', '#/dashboard');
    route();
    toast('临时游客模式：数据只保存在本浏览器对应的游客身份，建议注册账号长期保存');
  } catch (err) {
    app.innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="login-brand"><div class="login-logo">集</div><div><h1>集中管理系统</h1></div></div>
      <div class="sub">无法连接服务器</div>
      <div class="login-err">${esc(err.message)}</div>
    </div></div>`;
  }
}

/* ---------------- 路由 ---------------- */
async function route() {
  if (!state.user) return;
  const r = parseHash();
  if (state.user.role === 'warehouse' && !WAREHOUSE_ROUTES.has(r.path)) {
    if (location.hash !== '#/warehouse') location.hash = '#/warehouse';
    return;
  }
  if (state.user.role === 'sales' && SALES_BLOCKED.has(r.path)) {
    location.hash = '#/dashboard';
    return;
  }
  if (r.path === '/login') {
    if (state.user.role === 'guest') { renderLogin(); return; }
    location.hash = homeHash(state.user.role);
    return;
  }
  if (!document.getElementById('view')) renderShell();
  const my = nextSeq();
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
  else if (parseHash().path === '/login') renderLogin();
});

state.onUnauthorized = () => logout('登录已失效，请重新登录');
state.onLogout = () => logout('已退出登录');
state.onRerender = route;

/* ---------------- 启动 ---------------- */
async function boot() {
  if (!state.token) { renderLogin(); return; }
  try {
    const r = await api('/auth/me');
    state.user = r.user;
    await loadBase();
    renderShell();
    if (!location.hash || location.hash === '#/login') history.replaceState(null, '', homeHash(r.user.role));
    route();
  } catch {
    state.token = '';
    localStorage.removeItem('token');
    renderLogin();
  }
}

boot();
