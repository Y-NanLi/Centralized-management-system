/* 单据列表与详情 */
import { state, api, esc, fmt, typeLabel, statusLabel, fileUrl, toast, confirmBox, cnyUpper, modal, seq, rerender } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 单据列表 ---------------- */
async function pageDocs(q, my) {
  if (state.user.role === 'warehouse') { location.hash = '#/warehouse'; return; }
  const type = q.get('type') || '';
  const status = q.get('status') || '';
  const kw = q.get('q') || '';
  const from = q.get('from') || '';
  const to = q.get('to') || '';
  const customerId = q.get('customer_id') || '';
  const quick = q.get('quick') || '';
  const owner = state.user.role === 'admin' ? (q.get('owner') || '') : '';
  const page = Number(q.get('page') || 1);
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (kw) params.set('q', kw);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (customerId) params.set('customer_id', customerId);
  if (quick) params.set('quick', quick);
  if (owner) params.set('owner', owner);
  params.set('page', page);
  const data = await api('/documents?' + params.toString());
  if (my !== seq) return;

  const statusOpts = type
    ? state.meta.statuses[type].map((s) => `<option value="${s.key}" ${s.key === status ? 'selected' : ''}>${s.label}</option>`).join('')
    : Object.values(state.meta.statuses).flat().filter((s, i, arr) => arr.findIndex((x) => x.key === s.key) === i)
      .map((s) => `<option value="${s.key}" ${s.key === status ? 'selected' : ''}>${s.label}</option>`).join('');

  const ownerOpts = state.user.role === 'admin' ? `<option value="">全部成员</option>` + state.owners.map((o) =>
    `<option value="${o.id}" ${String(o.id) === owner ? 'selected' : ''}>${esc(o.display_name)}${o.role === 'guest' ? '（游客）' : ''}</option>`).join('') : '';
  const customerOpts = `<option value="">全部客户</option>` + state.customers.map((c) =>
    `<option value="${c.id}" ${String(c.id) === customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const quickOpts = [
    ['', '普通筛选'],
    ['quote_no_contract', '报价未转合同'],
    ['contract_no_delivery', '合同未送货'],
    ['delivery_pending', '送货待接收'],
    ['delivery_received', '仓库处理中'],
  ].map(([k, label]) => `<option value="${k}" ${k === quick ? 'selected' : ''}>${label}</option>`).join('');

  const typeOrder = { quote: 0, contract: 1, delivery: 2 };
  const docRow = (x, relation, inChain) => `<tr class="clickable ${inChain ? 'chain-member' : ''}" data-id="${x.id}" title="单击查看详情，双击进入编辑">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td>
      <td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.customer_name || '—')}</td>
      <td class="tiny">${esc(relation || '—')}</td>
      <td class="right nowrap">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span>
        ${x.type === 'delivery' && x.warehouse_status && x.warehouse_status !== 'none' ? `<div style="margin-top:3px"><span class="badge ${x.warehouse_status === 'done' ? 'accepted' : (x.warehouse_status === 'received' ? 'sent' : 'draft')}">仓 ${({ pending: '待接收', received: '处理中', done: '已完成' })[x.warehouse_status] || x.warehouse_status}</span></div>` : ''}</td>
      <td class="tiny nowrap">${esc(x.doc_date)}</td>
      <td class="tiny nowrap">${esc(x.owner_name || x.owner_username || '')}</td>
    </tr>`;
  const groups = new Map();
  data.items.forEach((x) => {
    const key = String(x.root_id || x.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  });
  const rows = Array.from(groups.values()).map((list) => {
    const byId = new Map(list.map((x) => [Number(x.id), x]));
    const kidsOf = (pid) => list.filter((x) => Number(x.parent_id) === pid)
      .sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || Number(a.id) - Number(b.id));
    const ordered = [];
    const seen = new Set();
    const walk = (x) => {
      if (seen.has(Number(x.id))) return;
      seen.add(Number(x.id));
      ordered.push(x);
      kidsOf(Number(x.id)).forEach(walk);
    };
    list.filter((x) => !byId.has(Number(x.parent_id)))
      .sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || Number(a.id) - Number(b.id))
      .forEach(walk);
    list.filter((x) => !seen.has(Number(x.id)))
      .sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || Number(a.id) - Number(b.id))
      .forEach(walk);
    const sorted = ordered;
    if (!list.some((x) => x.chain_size > 1)) return docRow(sorted[0], '', false);
    const rootDoc = sorted.find((x) => x.type === 'quote') || sorted[0];
    const chainTotal = rootDoc.chain_size || list.length;
    const countText = chainTotal > list.length ? `共 ${chainTotal} 张 · 本页 ${list.length}` : `共 ${chainTotal} 张`;
    const rootType = rootDoc.root_type || rootDoc.type;
    const pathText = rootType === 'quote' ? '报价单 → 合同 → 送货单' : rootType === 'contract' ? '合同 → 送货单' : '';
    const header = `<tr class="chain-group"><td colspan="8"><div class="chain-group-head">
        <span class="cg-label">关联单据</span>
        <b>${esc(rootDoc.root_doc_no || rootDoc.doc_no)}</b>
        <span class="badge">${countText}</span>
        <span class="cg-cust">${esc(rootDoc.customer_name || '')}</span>
        <span class="cg-path">${pathText}</span>
      </div></td></tr>`;
    return header + sorted.map((x) => {
      const parent = byId.get(Number(x.parent_id));
      const relation = parent ? `${typeLabel(parent.type)} → ${typeLabel(x.type)}` : '根单据';
      return docRow(x, relation, true);
    }).join('');
  }).join('');

  const pages = Math.max(1, data.pages || Math.ceil(data.total / data.page_size));
  const commonFilters = {
    ...(owner ? { owner } : {}), ...(kw ? { q: kw } : {}), ...(status ? { status } : {}),
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(customerId ? { customer_id: customerId } : {}),
  };
  const tabHref = (t) => '#/docs?' + new URLSearchParams({ ...commonFilters, ...(t ? { type: t } : {}) }).toString();
  const title = owner ? `${(state.owners.find((o) => String(o.id) === owner) || {}).display_name || '成员'}的单据` : '单据中心';
  const v = view(`
    <div class="page-head"><div><h2>${esc(title)}</h2><div class="desc">共 ${data.total} 张 · 编号全系统共用，遇到已占用号自动跳过 · 单击查看，双击编辑</div></div>
      ${owner ? '<div class="tiny">正在查看成员单据，新建请切回“全部成员”</div>' : `<div class="actions"><button class="btn" data-new="quote">+ 报价单</button><button class="btn" data-new="contract">+ 合同</button><button class="btn primary" data-new="delivery">+ 送货单</button></div>`}</div>
    <div class="card">
      <div class="toolbar">
        <div style="display:flex;gap:4px;background:#f3f6fb;border-radius:9px;padding:3px">
          ${['', 'quote', 'contract', 'delivery'].map((t) => `<a class="btn ghost ${t === type ? 'primary' : ''}" style="border:0;padding:5px 12px" href="${tabHref(t)}">${t ? typeLabel(t) : '全部'}</a>`).join('')}
        </div>
        <form id="fDoc" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="单号 / 客户 / 标题"></div>
          <select class="input" name="quick" style="width:126px" title="快捷筛选">${quickOpts}</select>
          <input class="input" type="date" name="from" value="${esc(from)}" style="width:132px" title="开始日期">
          <span class="tiny">至</span>
          <input class="input" type="date" name="to" value="${esc(to)}" style="width:132px" title="结束日期">
          <select class="input" name="customer_id" style="width:150px" title="按客户筛选">${customerOpts}</select>
          <select class="input" name="status" style="width:118px"><option value="">全部状态</option>${statusOpts}</select>
          ${ownerOpts ? `<select class="input" name="owner" style="width:140px">${ownerOpts}</select>` : ''}
          <button class="btn">筛选</button>
          <a class="btn ghost sm" href="#/docs">重置</a>
        </form>
        <div class="spacer"></div>
        <div class="tiny">第 ${data.page} / ${pages} 页</div>
        ${data.page > 1 ? `<a class="btn sm" href="${hashWith(q, { page: data.page - 1 })}">上一页</a>` : ''}
        ${data.page < pages ? `<a class="btn sm" href="${hashWith(q, { page: data.page + 1 })}">下一页</a>` : ''}
      </div>
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>客户</th><th>关联</th><th class="right">金额</th><th>状态</th><th>日期</th><th>制单人</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8"><div class="empty"><b>暂无单据</b>${owner ? '该成员还没有单据' : '点右上角新建，或从旧系统导入备份'}</div></td></tr>`}</tbody></table>
    </div>`, 'docs', '单据中心 / ' + (type ? typeLabel(type) : (owner ? '成员筛选' : '全部')));

  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });
  v.querySelectorAll('tr[data-id]').forEach((tr) => {
    let timer = 0;
    tr.onclick = (e) => {
      if (e.detail > 1) return;
      clearTimeout(timer);
      timer = setTimeout(() => { location.hash = `#/doc?id=${tr.dataset.id}`; }, 300);
    };
    tr.ondblclick = (e) => {
      e.preventDefault();
      clearTimeout(timer);
      location.hash = `#/doc/edit?id=${tr.dataset.id}`;
    };
  });
  v.querySelector('#fDoc').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const np = new URLSearchParams();
    const nextQuick = fd.get('quick') || '';
    if (type && !nextQuick) np.set('type', type);
    if (nextQuick) np.set('quick', nextQuick);
    if (fd.get('q')) np.set('q', fd.get('q'));
    if (fd.get('status')) np.set('status', fd.get('status'));
    if (fd.get('from')) np.set('from', fd.get('from'));
    if (fd.get('to')) np.set('to', fd.get('to'));
    if (fd.get('customer_id')) np.set('customer_id', fd.get('customer_id'));
    if (fd.get('owner')) np.set('owner', fd.get('owner'));
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
  const chainData = await api('/documents/' + id + '/chain');
  if (my !== seq) return;
  const p = d.payload || {};
  const items = p.items || [];
  const amount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

  const itemRows = items.filter((it) => it.name || it.spec).map((it, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td>
      <td class="c">${esc(it.qty)}</td>${d.type === 'delivery' ? `<td class="c">${esc(it.unit || '')}</td>` : `<td class="right">￥${fmt(it.price)}</td><td class="right">￥${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>`}
    </tr>`).join('');

  const chainNodes = (chainData.nodes || []).map((n) => ({ ...n, on: Number(n.id) === Number(d.id) }));
  if (!chainNodes.length) chainNodes.push({ id: d.id, doc_no: d.doc_no, type: d.type, status: d.status, on: true });
  const chainIds = new Set(chainNodes.map((n) => Number(n.id)));
  const childMap = new Map();
  chainNodes.forEach((n) => {
    const parent = Number(n.parent_id);
    if (parent && chainIds.has(parent)) {
      if (!childMap.has(parent)) childMap.set(parent, []);
      childMap.get(parent).push(n);
    }
  });
  const sortById = (a, b) => Number(a.id) - Number(b.id);
  const typeOrder = { quote: 0, contract: 1, delivery: 2 };
  const sortChildren = (a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || sortById(a, b);
  const roots = chainNodes.filter((n) => {
    const parent = Number(n.parent_id);
    return !parent || !chainIds.has(parent);
  }).sort(sortById);
  const graphNodes = [];
  let nextRow = 0;
  const chainTypes = new Set(chainNodes.map((n) => n.type));
  const contractCol = chainTypes.has('quote') ? 1 : 0;
  const deliveryCol = chainTypes.has('contract') ? contractCol + 1 : (chainTypes.has('quote') ? 1 : 0);
  const stageDepth = (n) => {
    if (n.type === 'quote') return 0;
    if (n.type === 'contract') return contractCol;
    if (n.type === 'delivery') return deliveryCol;
    return n._depth + 1;
  };
  const layoutNode = (n, depth) => {
    const kids = (childMap.get(Number(n.id)) || []).sort(sortChildren);
    n._depth = depth;
    n._kids = kids;
    graphNodes.push(n);
    if (!kids.length) { n._row = nextRow; nextRow += 1; return; }
    kids.forEach((k) => layoutNode(k, stageDepth(k)));
    n._row = (kids[0]._row + kids[kids.length - 1]._row) / 2;
  };
  roots.forEach((r, i) => {
    if (i) nextRow += 1;
    layoutNode(r, 0);
  });
  const compact = window.matchMedia && window.matchMedia('(max-width:900px)').matches;
  const CARD_W = compact ? 116 : 190;
  const CARD_H = compact ? 60 : 58;
  const GAP_X = compact ? 28 : 86;
  const GAP_Y = compact ? 20 : 22;
  const PAD = compact ? 6 : 8;
  const maxDepth = Math.max(0, ...graphNodes.map((n) => n._depth));
  const rows = Math.max(1, nextRow || 1);
  const graphW = PAD * 2 + (maxDepth + 1) * CARD_W + maxDepth * GAP_X;
  const graphH = PAD * 2 + rows * CARD_H + (rows - 1) * GAP_Y;
  const nodeXY = (n) => ({
    x: PAD + n._depth * (CARD_W + GAP_X),
    y: PAD + n._row * (CARD_H + GAP_Y),
  });
  const edges = graphNodes.flatMap((p) => p._kids.map((k) => {
    const a = nodeXY(p), b = nodeXY(k);
    const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2;
    const x2 = b.x - 9, y2 = b.y + CARD_H / 2;
    if (p._kids.length === 1) return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#chainArrow)"/>`;
    const bx = x1 + Math.min(22, GAP_X / 2);
    return `<path d="M${x1} ${y1} H${bx} V${y2} H${x2}" marker-end="url(#chainArrow)"/>`;
  })).join('');
  const graphCards = graphNodes.map((n) => {
    const { x, y } = nodeXY(n);
    return `<div class="flow-node ${Number(n.id) === Number(d.id) ? 'on' : ''}" style="left:${x}px;top:${y}px;width:${CARD_W}px;height:${CARD_H}px" data-go="${n.id}" data-type="${n.type}" title="${n.type === 'quote' || n.type === 'contract' ? '单击查看详情，双击进入编辑' : '单击查看详情'}">
        <div class="flow-main"><b>${typeLabel(n.type)}</b><span class="st">${statusLabel(n.type, n.status)}</span></div>
        <span class="n">${esc(n.doc_no)}</span>
      </div>`;
  }).join('');
  const chain = roots.length ? `<div class="chain-graph" style="width:${graphW}px;height:${graphH}px">
      <svg class="chain-links" width="${graphW}" height="${graphH}" aria-hidden="true">
        <defs><marker id="chainArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0 0 L7 3.5 L0 7" fill="#9aa7b8" stroke="none"/>
        </marker></defs>${edges}
      </svg>${graphCards}
    </div>` : '<span class="tiny">此单据还没有上下游关联</span>';

  const statusOpts = state.meta.statuses[d.type].map((s) => `<option value="${s.key}" ${s.key === d.status ? 'selected' : ''}>${s.label}</option>`).join('');
  const files = d.files.map((f) => fileRow(f)).join('');
  const isMine = d.owner_id === state.user.id;
  const canOwn = isMine || state.user.role === 'admin';
  const canConvertContract = d.type === 'quote' && canOwn;
  const canConvertDelivery = (d.type === 'quote' || d.type === 'contract') && canOwn;
  const isWh = state.user.role === 'warehouse';
  const w = d.warehouse_status || 'none';
  const wLabel = { none: '未提交', pending: '待仓库接收', received: '仓库处理中', done: '仓库已完成' }[w] || w;
  const wBadge = w === 'done' ? 'accepted' : (w === 'received' ? 'sent' : (w === 'pending' ? 'draft' : ''));
  const canEdit = isWh ? w === 'received' : (canOwn && w === 'none' && !d.locked);
  const canStatus = canOwn && state.user.role !== 'warehouse';
  const canEditRemark = canOwn && d.locked && d.type !== 'delivery';
  const canDelete = canOwn;
  const whActions = d.type === 'delivery' ? [
    (w === 'none' && isMine && d.status !== 'canceled') ? '<button class="btn" id="btnSendWh">交仓库</button>' : '',
    (w === 'pending' && isMine) ? '<button class="btn" id="btnWithdrawWh">撤回</button>' : '',
    (w === 'pending' && isWh) ? '<button class="btn primary" id="btnReceiveWh">接收</button>' : '',
    (w === 'received' && isWh) ? '<button class="btn primary" id="btnDoneWh">完成</button>' : '',
  ].join('') : '';

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
          ${d.type === 'delivery' ? `<span>仓库 <b><span class="badge ${wBadge}">${wLabel}</span></b></span>` : ''}
        </div>
      </div>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <select class="input" id="selStatus" style="width:112px" ${canStatus ? '' : 'disabled title="仅制单人可改业务状态"'}>${statusOpts}</select>
        ${whActions}
        ${canEdit ? '<button class="btn" id="btnEdit">编辑</button>' : ''}
        ${canEditRemark ? '<button class="btn" id="btnEditRemark">编辑备注</button>' : ''}
        <button class="btn primary" id="btnPrint">打印 / PDF</button>
        ${canConvertContract ? '<button class="btn" id="btnToContract">转合同</button>' : ''}
        ${canConvertDelivery ? '<button class="btn" id="btnToDelivery">转送货单</button>' : ''}
        ${canDelete ? '<button class="btn danger" id="btnDel">删除</button>' : ''}
      </div>
    </div>
    ${d.locked ? `<div class="lock-note"><b>关键内容已锁定</b><span>该单据已生成 ${d.downstream_count} 张下游单据。为保证报价、合同、送货单金额一致，客户、明细、金额、日期、编号和供货主体不可再改；状态、备注和附件仍可维护。</span></div>` : ''}
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
  v.querySelectorAll('[data-go]').forEach((n) => {
    let timer = 0;
    n.onclick = (e) => {
      if (e.detail > 1) return;
      clearTimeout(timer);
      timer = setTimeout(() => go('#/doc?id=' + n.dataset.go), 300);
    };
    n.ondblclick = (e) => {
      if (!['quote', 'contract'].includes(n.dataset.type)) return;
      e.preventDefault();
      clearTimeout(timer);
      go('#/doc/edit?id=' + n.dataset.go);
    };
  });
  if (v.querySelector('#btnEdit')) v.querySelector('#btnEdit').onclick = () => go(`#/doc/edit?id=${d.id}`);
  if (v.querySelector('#btnEditRemark')) v.querySelector('#btnEditRemark').onclick = () => {
    const old = d.remark || p.remark || '';
    const m = modal({
      title: '编辑备注',
      body: `<p class="tiny" style="margin:0 0 8px;line-height:1.7">这张${typeLabel(d.type)}已生成下游单据，金额和明细不能改，备注、状态和附件可以继续维护。</p>
        <textarea class="input" id="lockRemark" rows="5" placeholder="填写内部备注">${esc(old)}</textarea>`,
      footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="lockRemarkSave">保存备注</button>',
    });
    m.root.querySelector('#lockRemarkSave').onclick = async () => {
      const val = m.root.querySelector('#lockRemark').value;
      try {
        await api('/documents/' + d.id, { method: 'PUT', body: { remark: val } });
        m.close();
        toast('备注已更新');
        rerender();
      } catch (e) { toast(e.message, true); }
    };
  };
  v.querySelector('#btnPrint').onclick = async () => {
    try {
      // 仓库可以直接打印；待接收单先认领，避免打印视图被“未接收不能编辑”拦截
      if (d.type === 'delivery' && isWh && w === 'pending') {
        await api(`/documents/${d.id}/warehouse`, { method: 'POST', body: { action: 'receive' } });
        toast('已接收，正在打开打印');
      }
      go(`#/doc/edit?id=${d.id}&print=1`);
    } catch (e) { toast(e.message, true); }
  };
  const startConvert = (to) => {
    const existing = chainNodes.filter((n) => Number(n.parent_id) === Number(d.id) && n.type === to);
    if (!existing.length) {
      const linked = d.type === 'quote' && to === 'delivery'
        ? chainNodes.filter((n) => n.type === 'delivery') : [];
      if (linked.length) {
        const m = modal({
          title: '链路已有送货单',
          body: `<p style="margin:0 0 10px;line-height:1.8">当前业务链已经有 <b>${linked.length}</b> 张送货单，再生成会多出一张直接挂在报价单下的送货单。</p>
            <p class="tiny" style="margin:0;line-height:1.8">继续生成时，新送货单会自动使用一个未占用编号，不会重复占用已有单号。</p>`,
          footer: `<button class="btn" data-close>取消</button><button class="btn primary" id="dupContinue">仍要生成</button>`,
        });
        m.root.querySelector('#dupContinue').onclick = () => { m.close(); convert(d.id, to, 'new'); };
        return;
      }
      convert(d.id, to, 'new');
      return;
    }
    const label = to === 'contract' ? '销售合同' : '送货单';
    const latest = existing[existing.length - 1];
    const m = modal({
      title: `已有${label}`,
      body: `<p style="margin:0 0 10px;line-height:1.8">这张${typeLabel(d.type)}已经生成过 <b>${existing.length}</b> 张${label}，最近一张编号是 <b>${esc(latest.doc_no)}</b>。</p>
        <p class="tiny" style="margin:0;line-height:1.8">覆盖：保留原编号，用当前单据内容替换最近一张。<br>另存：保留原${label}，新建一张${label}，编号从当前单据编号往后自动找未占用的编号。</p>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn" id="convOverwrite">覆盖原${label}</button><button class="btn primary" id="convNew">另存新${label}</button>`,
    });
    m.root.querySelector('#convOverwrite').onclick = () => { m.close(); convert(d.id, to, 'overwrite'); };
    m.root.querySelector('#convNew').onclick = () => { m.close(); convert(d.id, to, 'new'); };
  };
  if (v.querySelector('#btnToContract')) v.querySelector('#btnToContract').onclick = () => startConvert('contract');
  if (v.querySelector('#btnToDelivery')) v.querySelector('#btnToDelivery').onclick = () => startConvert('delivery');
  const whAct = async (action, msg) => {
    try { await api(`/documents/${d.id}/warehouse`, { method: 'POST', body: { action } }); toast(msg); rerender(); } catch (e) { toast(e.message, true); }
  };
  if (v.querySelector('#btnSendWh')) v.querySelector('#btnSendWh').onclick = async () => { if (await confirmBox('把这张送货单交给仓库处理？仓库可以接收、编辑并打印。')) whAct('send', '已提交仓库，等待接收'); };
  if (v.querySelector('#btnWithdrawWh')) v.querySelector('#btnWithdrawWh').onclick = async () => { if (await confirmBox('撤回后仓库将看不到这张送货单。')) whAct('withdraw', '已撤回'); };
  if (v.querySelector('#btnReceiveWh')) v.querySelector('#btnReceiveWh').onclick = () => whAct('receive', '已接收，可编辑和打印');
  if (v.querySelector('#btnDoneWh')) v.querySelector('#btnDoneWh').onclick = () => whAct('done', '仓库已完成');
  if (v.querySelector('#btnDel')) v.querySelector('#btnDel').onclick = async () => {
    if (!await confirmBox('确定删除 ' + d.doc_no + '？单据会移入回收站，30 天内可恢复，到期自动永久删除。', '移入回收站')) return;
    try { await api('/documents/' + d.id, { method: 'DELETE' }); toast('已移入回收站，30 天内可恢复'); go('#/docs'); } catch (e) { toast(e.message, true); }
  };
  if (v.querySelector('#selStatus')) v.querySelector('#selStatus').onchange = async (e) => {
    try {
      await api(`/documents/${d.id}/status`, { method: 'POST', body: { status: e.target.value } });
      toast('状态已更新'); rerender();
    } catch (err) { toast(err.message, true); }
  };

  const input = v.querySelector('#fileInput');
  const drop = v.querySelector('#dropZone');
  drop.onclick = () => input.click();
  v.querySelectorAll('[data-unlink]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('从本单据移除该附件？文件仍保留在文件库。')) return;
    try { await api(`/documents/${d.id}/files/${b.dataset.unlink}`, { method: 'DELETE' }); toast('已移除'); rerender(); } catch (e) { toast(e.message, true); }
  });
  input.onchange = async () => {
    if (!input.files.length) return;
    await uploadDocs(d.id, input.files);
    rerender();
  };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = async (e) => {
    e.preventDefault(); drop.classList.remove('on');
    if (e.dataTransfer.files.length) { await uploadDocs(d.id, e.dataTransfer.files); rerender(); }
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
      ${state.user.role === 'admin' ? `<button class="btn sm danger" data-unlink="${f.id}">移除</button>` : ''}
    </div>`;
}

async function convert(id, to, mode = 'new') {
  try {
    const nd = await api(`/documents/${id}/convert`, { method: 'POST', body: { to, mode } });
    toast((mode === 'overwrite' ? '已覆盖 ' : '已生成 ') + nd.doc_no);
    location.hash = '#/doc?id=' + nd.id;
  } catch (e) { toast(e.message, true); }
}


export { pageDocs, pageDocDetail, fileRow };
