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
  '/users': pageUsers,
  '/settings': pageSettings,
};

function logout() {
  localStorage.removeItem('token');
  state.token = '';
  state.user = null;
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

/* ---------------- 游客身份 ---------------- */
async function startGuest() {
  try {
    const r = await api('/auth/guest');
    state.token = '';
    state.user = r.user;
    await loadBase();
    renderShell();
    if (!location.hash) history.replaceState(null, '', '#/dashboard');
    route();
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
  if (r.path === '/login' && state.user.role === 'guest') { renderLogin(); return; }
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
});

state.onUnauthorized = logout;
state.onLogout = logout;

/* ---------------- 启动 ---------------- */
async function boot() {
  if (!state.token) { startGuest(); return; }
  try {
    const r = await api('/auth/me');
    state.user = r.user;
    await loadBase();
    renderShell();
    if (!location.hash) history.replaceState(null, '', '#/dashboard');
    route();
  } catch {
    state.token = '';
    localStorage.removeItem('token');
    startGuest();
  }
}

boot();
