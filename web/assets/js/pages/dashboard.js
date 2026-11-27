/* 工作台 */
import { state, api, esc, fmt, typeLabel, statusLabel, seq } from '../core.js';
import { view } from '../shell.js';

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


export { pageDashboard };
