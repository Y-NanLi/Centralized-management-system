/* 单据列表与详情 */
import { state, api, esc, fmt, typeLabel, statusLabel, fileUrl, toast, confirmBox, cnyUpper, seq } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 单据列表 ---------------- */
async function pageDocs(q, my) {
  const type = q.get('type') || '';
  const status = q.get('status') || '';
  const kw = q.get('q') || '';
  const page = Number(q.get('page') || 1);
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (kw) params.set('q', kw);
  params.set('page', page);
  const data = await api('/documents?' + params.toString());
  if (my !== seq) return;

  const statusOpts = type
    ? state.meta.statuses[type].map((s) => `<option value="${s.key}" ${s.key === status ? 'selected' : ''}>${s.label}</option>`).join('')
    : Object.values(state.meta.statuses).flat().filter((s, i, arr) => arr.findIndex((x) => x.key === s.key) === i)
      .map((s) => `<option value="${s.key}" ${s.key === status ? 'selected' : ''}>${s.label}</option>`).join('');

  const rows = data.items.map((x) => `<tr class="clickable" data-id="${x.id}" title="点击进入编辑 / 预览">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td>
      <td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.customer_name || '—')}</td>
      <td class="tiny">${x.chain_size > 1 ? '链路 ' + x.chain_size + ' 张' : '—'}</td>
      <td class="right nowrap">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span></td>
      <td class="tiny nowrap">${esc(x.doc_date)}</td>
      <td class="tiny nowrap">${esc(x.owner_name || '')}</td>
    </tr>`).join('');

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const v = view(`
    <div class="page-head"><div><h2>单据中心</h2><div class="desc">共 ${data.total} 张 · 报价 → 合同 → 送货单 可逐级派生，客户与明细自动带过去</div></div>
      <div class="actions"><button class="btn" data-new="quote">+ 报价单</button><button class="btn" data-new="contract">+ 合同</button><button class="btn primary" data-new="delivery">+ 送货单</button></div></div>
    <div class="card">
      <div class="toolbar">
        <div style="display:flex;gap:4px;background:#f3f6fb;border-radius:9px;padding:3px">
          ${['', 'quote', 'contract', 'delivery'].map((t) => `<a class="btn ghost ${t === type ? 'primary' : ''}" style="border:0;padding:5px 12px" href="#/docs${t ? '?type=' + t : ''}">${t ? typeLabel(t) : '全部'}</a>`).join('')}
        </div>
        <form id="fDoc" style="display:flex;gap:8px;align-items:center">
          <div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="单号 / 客户 / 标题"></div>
          <select class="input" name="status" style="width:130px"><option value="">全部状态</option>${statusOpts}</select>
          <button class="btn">筛选</button>
        </form>
        <div class="spacer"></div>
        <div class="tiny">第 ${data.page} / ${pages} 页</div>
        ${page > 1 ? `<a class="btn sm" href="${hashWith(q, { page: page - 1 })}">上一页</a>` : ''}
        ${page < pages ? `<a class="btn sm" href="${hashWith(q, { page: page + 1 })}">下一页</a>` : ''}
      </div>
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>客户</th><th>关联</th><th class="right">金额</th><th>状态</th><th>日期</th><th>制单</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8"><div class="empty"><b>暂无单据</b>点右上角新建，或从旧系统导入备份</div></td></tr>'}</tbody></table>
    </div>`, 'docs', '单据中心 / ' + (type ? typeLabel(type) : '全部'));

  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });
  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `#/doc/edit?id=${tr.dataset.id}`; });
  v.querySelector('#fDoc').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const np = new URLSearchParams();
    if (type) np.set('type', type);
    if (fd.get('q')) np.set('q', fd.get('q'));
    if (fd.get('status')) np.set('status', fd.get('status'));
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
  if (my !== seq) return;
  const p = d.payload || {};
  const items = p.items || [];
  const amount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

  const itemRows = items.filter((it) => it.name || it.spec).map((it, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td>
      <td class="c">${esc(it.qty)}</td>${d.type === 'delivery' ? `<td class="c">${esc(it.unit || '')}</td>` : `<td class="right">￥${fmt(it.price)}</td><td class="right">￥${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>`}
    </tr>`).join('');

  const chainNodes = [];
  if (d.parent) chainNodes.push(d.parent);
  chainNodes.push({ id: d.id, doc_no: d.doc_no, type: d.type, status: d.status, on: true });
  d.children.forEach((c) => chainNodes.push(c));
  const chain = chainNodes.map((n, i) => `${i ? '<span class="arrow">→</span>' : ''}
      <div class="node ${n.on ? 'on' : ''}" data-go="${n.id}">${typeLabel(n.type)}<span class="n">${esc(n.doc_no)}</span></div>`).join('')
    || '<span class="tiny">此单据还没有上下游关联</span>';

  const statusOpts = state.meta.statuses[d.type].map((s) => `<option value="${s.key}" ${s.key === d.status ? 'selected' : ''}>${s.label}</option>`).join('');
  const files = d.files.map((f) => fileRow(f)).join('');
  const canConvertContract = d.type === 'quote';
  const canConvertDelivery = d.type === 'quote' || d.type === 'contract';

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
        </div>
      </div>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <select class="input" id="selStatus" style="width:112px">${statusOpts}</select>
        <button class="btn" id="btnEdit">编辑</button>
        <button class="btn primary" id="btnPrint">打印 / PDF</button>
        ${canConvertContract ? '<button class="btn" id="btnToContract">转合同</button>' : ''}
        ${canConvertDelivery ? '<button class="btn" id="btnToDelivery">转送货单</button>' : ''}
        ${['admin', 'manager'].includes(state.user.role) ? '<button class="btn danger" id="btnDel">删除</button>' : ''}
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
  v.querySelector('#btnEdit').onclick = () => go(`#/doc/edit?id=${d.id}`);
  v.querySelector('#btnPrint').onclick = () => go(`#/print?id=${d.id}`);
  if (v.querySelector('#btnToContract')) v.querySelector('#btnToContract').onclick = () => convert(d.id, 'contract');
  if (v.querySelector('#btnToDelivery')) v.querySelector('#btnToDelivery').onclick = () => convert(d.id, 'delivery');
  if (v.querySelector('#btnDel')) v.querySelector('#btnDel').onclick = async () => {
    if (!await confirmBox('确定删除 ' + d.doc_no + '？删除后不可恢复。', '删除')) return;
    try { await api('/documents/' + d.id, { method: 'DELETE' }); toast('已删除'); go('#/docs'); } catch (e) { toast(e.message, true); }
  };
  v.querySelector('#selStatus').onchange = async (e) => {
    try {
      await api(`/documents/${d.id}/status`, { method: 'POST', body: { status: e.target.value } });
      toast('状态已更新'); route();
    } catch (err) { toast(err.message, true); }
  };

  const input = v.querySelector('#fileInput');
  const drop = v.querySelector('#dropZone');
  drop.onclick = () => input.click();
  v.querySelectorAll('[data-unlink]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('从本单据移除该附件？文件仍保留在文件库。')) return;
    try { await api(`/documents/${d.id}/files/${b.dataset.unlink}`, { method: 'DELETE' }); toast('已移除'); route(); } catch (e) { toast(e.message, true); }
  });
  input.onchange = async () => {
    if (!input.files.length) return;
    await uploadDocs(d.id, input.files);
    route();
  };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = async (e) => {
    e.preventDefault(); drop.classList.remove('on');
    if (e.dataTransfer.files.length) { await uploadDocs(d.id, e.dataTransfer.files); route(); }
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

async function convert(id, to) {
  try {
    const nd = await api(`/documents/${id}/convert`, { method: 'POST', body: { to } });
    toast('已生成 ' + nd.doc_no);
    location.hash = '#/doc?id=' + nd.id;
  } catch (e) { toast(e.message, true); }
}


export { pageDocs, pageDocDetail, fileRow };
