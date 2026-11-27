/* 集中管理系统 · 核心状态与工具 */
const state = {
  token: localStorage.getItem('token') || '',
  user: null,
  meta: null,
  companies: [],
  customers: [],
  products: [],
  onUnauthorized: null,
  onLogout: null,
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
    if (res.status === 401 && !['/auth/me', '/auth/login', '/auth/guest'].includes(path) && state.onUnauthorized) state.onUnauthorized();
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

/* 请求序号，避免旧请求覆盖新页面 */
export let seq = 0;
export function nextSeq() { return ++seq; }

/* ---------------- 人民币大写 ---------------- */
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


/* ---------------- 路由解析 ---------------- */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const [path, qs] = raw.split('?');
  return { path, q: new URLSearchParams(qs || '') };
}

export { state, app, esc, fmt, qtyFmt, today, typeLabel, statusLabel, roleLabel, fileUrl, api, toast, modal, confirmBox, cnyUpper, parseHash };
