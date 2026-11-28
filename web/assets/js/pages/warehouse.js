/* 仓库专用：接收送货单、编辑与打印 */
import { state, api, esc, fmt, typeLabel, toast, seq, rerender, dt } from '../core.js';
import { view } from '../shell.js';

async function pageWarehouse(q, my) {
  if (!['admin', 'warehouse'].includes(state.user.role)) { location.hash = '#/dashboard'; return; }
  const status = q.get('status') || 'all';
  const kw = q.get('q') || '';
  const page = Number(q.get('page') || 1);
  const params = new URLSearchParams({ status, page: String(page) });
  if (kw) params.set('q', kw);
  const data = await api('/warehouse/deliveries?' + params.toString());
  if (my !== seq) return;

  const labels = data.labels || {};
  const isWh = state.user.role === 'warehouse';
  const statusTabs = [['all', '全部'], ['pending', '待接收'], ['received', '处理中'], ['done', '已完成']];
  const badgeCls = (s) => s === 'done' ? 'accepted' : (s === 'received' ? 'sent' : 'draft');

  const rows = data.items.map((d) => {
    const w = d.warehouse_status;
    const printBtn = `<button class="btn sm" data-print="${d.id}" data-w="${w}">打印</button>`;
    const actions = !isWh
      ? `<a class="btn sm" href="#/doc?id=${d.id}">查看</a>`
      : w === 'pending'
        ? `<button class="btn sm primary" data-receive="${d.id}">接收并编辑</button>
         ${printBtn}
         <a class="btn sm" href="#/doc?id=${d.id}">查看</a>`
        : w === 'received'
          ? `<button class="btn sm primary" data-done="${d.id}">完成</button>
           <a class="btn sm" href="#/doc/edit?id=${d.id}">编辑</a>
           ${printBtn}`
          : `<a class="btn sm" href="#/doc?id=${d.id}">查看</a>
           ${printBtn}`;
    return `<tr data-id="${d.id}">
      <td class="mono">${esc(d.doc_no)}</td>
      <td><b>${esc(d.customer_name || d.title || '—')}</b></td>
      <td class="tiny">${esc(d.owner_name || d.owner_username || '—')}</td>
      <td class="tiny nowrap">${esc(d.doc_date)}</td>
      <td class="right nowrap">￥${fmt(d.amount)}</td>
      <td class="tiny nowrap">${d.warehouse_at ? esc(dt(d.warehouse_at)) : '—'}</td>
      <td><span class="badge ${badgeCls(w)}">${esc(labels[w] || w)}</span></td>
      <td class="nowrap">${actions}</td>
    </tr>`;
  }).join('');

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const tabHref = (s) => '#/warehouse?' + new URLSearchParams({ ...(s ? { status: s } : {}), ...(kw ? { q: kw } : {}) }).toString();
  const v = view(`
    <div class="page-head"><div><h2>仓库打单</h2><div class="desc">${isWh ? '业务员提交送货单后，在这里接收、编辑、打印并完成；也可以不接收，直接手动新建送货单' : '管理员只读查看仓库队列；接收、编辑、打印和完成由仓库账号操作'}</div></div>
      ${isWh ? '<button class="btn primary" id="btnNewWh" type="button">＋ 新建送货单</button>' : ''}
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat"><div class="k">待接收</div><div class="v">${data.stats.pending}</div><div class="s">其他用户刚提交的送货单</div><div class="bar"></div></div>
      <div class="stat"><div class="k">处理中</div><div class="v">${data.stats.received}</div><div class="s">已接收，可编辑和打印</div><div class="bar"></div></div>
      <div class="stat"><div class="k">已完成</div><div class="v">${data.stats.done}</div><div class="s">仓库已完成打单</div><div class="bar"></div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div style="display:flex;gap:4px;background:#f3f6fb;border-radius:9px;padding:3px">
          ${statusTabs.map(([s, l]) => `<a class="btn ghost ${s === status ? 'primary' : ''}" style="border:0;padding:5px 14px" href="${tabHref(s)}">${l}</a>`).join('')}
        </div>
        <div class="spacer"></div>
        <form id="fWh" style="display:flex;gap:8px">
          <div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="单号 / 客户 / 标题"></div>
          <button class="btn">搜索</button>
        </form>
        <div class="tiny">第 ${data.page} / ${pages} 页 · 共 ${data.total} 张</div>
        ${page > 1 ? `<a class="btn sm" href="${hashWith(q, { page: page - 1 })}">上一页</a>` : ''}
        ${page < pages ? `<a class="btn sm" href="${hashWith(q, { page: page + 1 })}">下一页</a>` : ''}
      </div>
      <table class="tb"><thead><tr><th>送货单号</th><th>客户</th><th>制单人</th><th>送货日期</th><th class="right">金额</th><th>提交仓库</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8"><div class="empty">${status === 'pending' ? '没有待接收的送货单' : '这个状态下没有送货单'}</div></td></tr>`}</tbody></table>
    </div>`, 'warehouse', '仓库打单');

  v.querySelector('#fWh').onsubmit = (e) => {
    e.preventDefault();
    const np = new URLSearchParams();
    if (status) np.set('status', status);
    const qv = new FormData(e.target).get('q');
    if (qv) np.set('q', qv);
    location.hash = '#/warehouse?' + np.toString();
  };
  if (v.querySelector('#btnNewWh')) v.querySelector('#btnNewWh').onclick = () => { location.hash = '#/doc/new?type=delivery'; };
  v.querySelectorAll('[data-receive]').forEach((b) => b.onclick = async () => {
    try {
      await api(`/documents/${b.dataset.receive}/warehouse`, { method: 'POST', body: { action: 'receive' } });
      toast('已接收，进入编辑');
      location.hash = '#/doc/edit?id=' + b.dataset.receive;
    } catch (e) { toast(e.message, true); rerender(); }
  });
  v.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => {
    try { await api(`/documents/${b.dataset.done}/warehouse`, { method: 'POST', body: { action: 'done' } }); toast('已完成'); rerender(); } catch (e) { toast(e.message, true); }
  });
  v.querySelectorAll('[data-print]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.print;
    try {
      // 待接收单先由仓库认领，未接收前仍不允许编辑；打印本身不受影响
      if (b.dataset.w === 'pending') {
        await api(`/documents/${id}/warehouse`, { method: 'POST', body: { action: 'receive' } });
        toast('已接收，正在打开打印');
      }
      location.hash = `#/doc/edit?id=${id}&print=1`;
    } catch (e) { toast(e.message, true); rerender(); }
  });
}

function hashWith(q, patch) {
  const p = new URLSearchParams(q.toString());
  for (const [k, v] of Object.entries(patch)) p.set(k, v);
  return '#/warehouse?' + p.toString();
}

export { pageWarehouse };
