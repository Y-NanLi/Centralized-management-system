/* 单据列表与详情 */
import { state, api, esc, fmt, typeLabel, statusLabel, fileUrl, toast, confirmBox, cnyUpper, modal, seq, rerender } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 单据列表 ---------------- */
async function pageDocs(q, my) {
  if (state.user.role === 'warehouse') { location.hash = '#/warehouse'; return; }
  const type = q.get('type') || '';
  const status = q.get('status') || '';
  const kw = q.get('q') || '';
  const owner = state.user.role === 'admin' ? (q.get('owner') || '') : '';
  const page = Number(q.get('page') || 1);
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (kw) params.set('q', kw);
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

  const rows = data.items.map((x) => `<tr class="clickable" data-id="${x.id}" title="点击进入编辑 / 预览">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td>
      <td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.customer_name || '—')}</td>
      <td class="tiny">${x.chain_size > 1 ? '链路 ' + x.chain_size + ' 张' : '—'}</td>
      <td class="right nowrap">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span>
        ${x.type === 'delivery' && x.warehouse_status && x.warehouse_status !== 'none' ? `<div style="margin-top:3px"><span class="badge ${x.warehouse_status === 'done' ? 'accepted' : (x.warehouse_status === 'received' ? 'sent' : 'draft')}">仓 ${({ pending: '待接收', received: '处理中', done: '已完成' })[x.warehouse_status] || x.warehouse_status}</span></div>` : ''}</td>
      <td class="tiny nowrap">${esc(x.doc_date)}</td>
      <td class="tiny nowrap">${esc(x.owner_name || x.owner_username || '')}</td>
    </tr>`).join('');

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const tabHref = (t) => '#/docs?' + new URLSearchParams({ ...(t ? { type: t } : {}), ...(owner ? { owner } : {}) }).toString();
  const title = owner ? `${(state.owners.find((o) => String(o.id) === owner) || {}).display_name || '成员'}的单据` : '单据中心';
  const v = view(`
    <div class="page-head"><div><h2>${esc(title)}</h2><div class="desc">共 ${data.total} 张 · 报价 → 合同 → 送货单 可逐级派生，客户与明细自动带过去</div></div>
      ${owner ? '<div class="tiny">正在查看成员单据，新建请切回“全部成员”</div>' : `<div class="actions"><button class="btn" data-new="quote">+ 报价单</button><button class="btn" data-new="contract">+ 合同</button><button class="btn primary" data-new="delivery">+ 送货单</button></div>`}</div>
    <div class="card">
      <div class="toolbar">
        <div style="display:flex;gap:4px;background:#f3f6fb;border-radius:9px;padding:3px">
          ${['', 'quote', 'contract', 'delivery'].map((t) => `<a class="btn ghost ${t === type ? 'primary' : ''}" style="border:0;padding:5px 12px" href="${tabHref(t)}">${t ? typeLabel(t) : '全部'}</a>`).join('')}
        </div>
        <form id="fDoc" style="display:flex;gap:8px;align-items:center">
          <div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="单号 / 客户 / 标题"></div>
          <select class="input" name="status" style="width:130px"><option value="">全部状态</option>${statusOpts}</select>
          ${ownerOpts ? `<select class="input" name="owner" style="width:150px">${ownerOpts}</select>` : ''}
          <button class="btn">筛选</button>
        </form>
        <div class="spacer"></div>
        <div class="tiny">第 ${data.page} / ${pages} 页</div>
        ${page > 1 ? `<a class="btn sm" href="${hashWith(q, { page: page - 1 })}">上一页</a>` : ''}
        ${page < pages ? `<a class="btn sm" href="${hashWith(q, { page: page + 1 })}">下一页</a>` : ''}
      </div>
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>客户</th><th>关联</th><th class="right">金额</th><th>状态</th><th>日期</th><th>制单人</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8"><div class="empty"><b>暂无单据</b>${owner ? '该成员还没有单据' : '点右上角新建，或从旧系统导入备份'}</div></td></tr>`}</tbody></table>
    </div>`, 'docs', '单据中心 / ' + (type ? typeLabel(type) : (owner ? '成员筛选' : '全部')));

  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });
  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `#/doc/edit?id=${tr.dataset.id}`; });
  v.querySelector('#fDoc').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const np = new URLSearchParams();
    if (type) np.set('type', type);
    if (fd.get('q')) np.set('q', fd.get('q'));
    if (fd.get('status')) np.set('status', fd.get('status'));
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
  const roots = chainNodes.filter((n) => {
    const parent = Number(n.parent_id);
    return !parent || !chainIds.has(parent);
  }).sort(sortById);
  const graphNodes = [];
  let nextRow = 0;
  const layoutNode = (n, depth) => {
    const kids = (childMap.get(Number(n.id)) || []).sort(sortById);
    n._depth = depth;
    n._kids = kids;
    graphNodes.push(n);
    if (!kids.length) { n._row = nextRow; nextRow += 1; return; }
    kids.forEach((k) => layoutNode(k, depth + 1));
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
    return `<div class="flow-node ${Number(n.id) === Number(d.id) ? 'on' : ''}" style="left:${x}px;top:${y}px;width:${CARD_W}px;height:${CARD_H}px" data-go="${n.id}">
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
  const canEdit = isWh ? w === 'received' : (canOwn && w === 'none');
  const canStatus = canOwn && state.user.role !== 'warehouse';
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
        <button class="btn primary" id="btnPrint">打印 / PDF</button>
        ${canConvertContract ? '<button class="btn" id="btnToContract">转合同</button>' : ''}
        ${canConvertDelivery ? '<button class="btn" id="btnToDelivery">转送货单</button>' : ''}
        ${canDelete ? '<button class="btn danger" id="btnDel">删除</button>' : ''}
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
  if (v.querySelector('#btnEdit')) v.querySelector('#btnEdit').onclick = () => go(`#/doc/edit?id=${d.id}`);
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
    if (!existing.length) { convert(d.id, to, 'new'); return; }
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
      ${['admin', 'manager'].includes(state.user.role) ? `<button class="btn sm danger" data-unlink="${f.id}">移除</button>` : ''}
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
