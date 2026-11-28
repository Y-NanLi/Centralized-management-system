/* 工作台 */
import { state, api, esc, fmt, typeLabel, statusLabel, seq } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 工作台 ---------------- */
async function pageDashboard(q, my) {
  const isAdmin = state.user.role === 'admin';
  const owner = isAdmin ? (q.get('owner') || '') : '';
  const apiPath = '/dashboard' + (owner ? '?owner=' + encodeURIComponent(owner) : '');
  const d = await api(apiPath);
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

  const showOwnerCol = isAdmin && !owner;
  const recent = d.recent.map((x) => `<tr class="clickable" data-go="#/doc?id=${x.id}">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td>
      <td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.customer_name || '—')}</td>
      ${showOwnerCol ? `<td class="tiny">${esc(x.owner_name || x.owner_username || '—')}</td>` : ''}
      <td class="right">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span></td>
      <td class="tiny">${esc(x.doc_date)}</td></tr>`).join('');

  const ownerOptions = isAdmin ? `<select class="input" id="selOwner" style="width:150px">
      <option value="">全部成员</option>
      ${state.owners.map((o) => `<option value="${o.id}" ${String(o.id) === owner ? 'selected' : ''}>${esc(o.display_name)}${o.role === 'guest' ? '（游客）' : ''}</option>`).join('')}
    </select>` : '';

  const title = owner ? `${d.owner_name || '成员'}的工作台` : (isAdmin ? '工作台' : '我的工作台');
  const desc = state.user.role === 'guest'
    ? `${esc(d.month)} 业务概览 · 游客数据仅属于本浏览器`
    : owner
      ? `${esc(d.month)} 业务概览 · 管理员查看成员 #${esc(owner)} 的客户、货品与单据`
      : isAdmin
        ? `${esc(d.month)} 业务概览 · 全部成员汇总，可切换成员查看`
        : `${esc(d.month)} 业务概览 · 只统计你本人名下的客户、货品与单据`;
  const actions = owner ? '<div class="tiny">查看成员工作台时不提供新建入口，切回“全部成员”再新建</div>' : `<div class="actions"><button class="btn primary" data-new="quote">+ 报价单</button><button class="btn" data-new="contract">+ 合同</button><button class="btn" data-new="delivery">+ 送货单</button></div>`;

  const v = view(`
    <div class="page-head"><div><h2>${esc(title)}</h2><div class="desc">${desc}</div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${ownerOptions}${actions}</div></div>

    <div class="stat-grid">
      <div class="stat"><div class="k">本月单据</div><div class="v">${d.counts.quote + d.counts.contract + d.counts.delivery}</div><div class="s">报价 ${d.counts.quote} · 合同 ${d.counts.contract} · 送货 ${d.counts.delivery}</div><div class="bar"></div></div>
      <div class="stat alt"><div class="k">合同金额（累计）</div><div class="v">￥${fmt(d.amount.contract)}</div><div class="s">报价累计 ￥${fmt(d.amount.quote)}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">客户 / 货品</div><div class="v">${d.customers} / ${d.products}</div><div class="s">${owner || !isAdmin ? '本人名下客户与货品' : '全部成员客户与货品'}</div><div class="bar"></div></div>
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
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>客户</th>${showOwnerCol ? '<th>归属人</th>' : ''}<th class="right">金额</th><th>状态</th><th>日期</th></tr></thead>
      <tbody>${recent || `<tr><td colspan="${showOwnerCol ? 7 : 6}"><div class="empty">还没有单据，点右上角新建一张</div></td></tr>`}</tbody></table>
    </div>`, 'dashboard', title);

  const sel = v.querySelector('#selOwner');
  if (sel) sel.onchange = () => { location.hash = '#/dashboard' + (sel.value ? '?owner=' + sel.value : ''); };
  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });
  v.querySelectorAll('[data-go]').forEach((el) => el.onclick = () => { location.hash = el.dataset.go; });
}


export { pageDashboard };
