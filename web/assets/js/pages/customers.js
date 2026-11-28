/* 客户档案 */
import { state, api, esc, fmt, typeLabel, statusLabel, toast, modal, confirmBox, fileUrl, seq, rerender } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 客户 ---------------- */
async function pageCustomers(q, my) {
  const kw = q.get('q') || '';
  const owner = state.user.role === 'admin' ? (q.get('owner') || '') : '';
  const params = new URLSearchParams();
  if (kw) params.set('q', kw);
  if (owner) params.set('owner', owner);
  const list = await api('/customers' + (params.toString() ? '?' + params.toString() : ''));
  if (my !== seq) return;
  const showOwner = state.user.role === 'admin' && !owner;
  const rows = list.map((c) => `<tr class="clickable" data-id="${c.id}">
      <td><b>${esc(c.name)}</b><div class="tiny">${esc(c.addr || '')}</div></td>
      <td>${esc(c.contact || '—')}</td><td class="mono">${esc(c.phone || '—')}</td>
      ${showOwner ? `<td class="tiny">${esc(c.owner_name || c.owner_username || '—')}</td>` : ''}
      <td class="right">${c.doc_count}</td><td class="right">￥${fmt(c.total_amount)}</td>
      <td class="tiny">${esc(c.last_date || '—')}</td>
      <td class="tiny right"><a href="#/customer?id=${c.id}${owner ? '&owner=' + owner : ''}" onclick="event.stopPropagation()">详情</a></td>
    </tr>`).join('');
  const cols = showOwner
    ? '<colgroup><col style="width:24%"><col style="width:12%"><col style="width:14%"><col style="width:11%"><col style="width:7%"><col style="width:10%"><col style="width:12%"><col style="width:10%"></colgroup>'
    : '<colgroup><col style="width:28%"><col style="width:14%"><col style="width:16%"><col style="width:8%"><col style="width:11%"><col style="width:12%"><col style="width:11%"></colgroup>';
  const ownerOpts = state.user.role === 'admin' ? `<select class="input" name="owner" style="width:150px"><option value="">全部成员</option>${state.owners.map((o) => `<option value="${o.id}" ${String(o.id) === owner ? 'selected' : ''}>${esc(o.display_name)}${o.role === 'guest' ? '（游客）' : ''}</option>`).join('')}</select>` : '';
  const v = view(`<div class="page-head"><div><h2>${owner ? '成员客户档案' : '客户档案'}</h2><div class="desc">共 ${list.length} 家 · ${owner ? '管理员查看指定成员的客户' : '每个账号只看自己的客户；开单时填客户名会自动建档'}</div></div>
      ${owner ? '<div class="tiny">正在查看成员客户，新增客户请切回“全部成员”</div>' : '<div class="actions"><button class="btn primary" id="btnAddCust">+ 新增客户</button></div>'}</div>
    <div class="card"><div class="toolbar"><form id="fCust" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="名称 / 联系人 / 电话 / 地址"></div>${ownerOpts}<button class="btn">搜索</button></form></div>
      <table class="tb" style="table-layout:fixed">${cols}<thead><tr><th>客户名称</th><th>联系人</th><th>电话</th>${showOwner ? '<th>归属人</th>' : ''}<th class="right">单据数</th><th class="right">累计金额</th><th>最近单据</th><th class="right">操作</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${showOwner ? 8 : 7}"><div class="empty"><b>还没有客户</b>新建单据时填客户名会自动建档</div></td></tr>`}</tbody></table></div>`, 'customers', '客户档案');

  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/customer?id=' + tr.dataset.id + (owner ? '&owner=' + owner : ''); });
  v.querySelector('#fCust').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const np = new URLSearchParams();
    if (fd.get('q')) np.set('q', fd.get('q'));
    if (fd.get('owner')) np.set('owner', fd.get('owner'));
    location.hash = '#/customers' + (np.toString() ? '?' + np.toString() : '');
  };
  const add = v.querySelector('#btnAddCust');
  if (add) add.onclick = () => customerForm();
}

function customerForm(c, onSaved) {
  const m = modal({
    title: c ? '编辑客户' : '新增客户',
    wide: true,
    body: `<div class="grid2">
      <div class="field"><label>客户名称 *</label><input class="input" id="cfName" value="${esc(c && c.name || '')}"></div>
      <div class="field"><label>联系人</label><input class="input" id="cfContact" value="${esc(c && c.contact || '')}"></div>
      <div class="field"><label>电话</label><input class="input" id="cfPhone" value="${esc(c && c.phone || '')}"></div>
      <div class="field"><label>传真</label><input class="input" id="cfFax" value="${esc(c && c.fax || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>地址</label><input class="input" id="cfAddr" value="${esc(c && c.addr || '')}"></div>
      <div class="field"><label>税号</label><input class="input" id="cfTax" value="${esc(c && c.tax_no || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>备注</label><textarea class="input" id="cfNote" rows="4" style="min-height:90px;resize:vertical" placeholder="例如：付款方式、账期、成本加点、开票要求等">${esc(c && c.note || '')}</textarea></div>
    </div>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="cfSave">保存</button>',
  });
  m.root.querySelector('#cfSave').onclick = async () => {
    const body = {
      name: m.root.querySelector('#cfName').value, contact: m.root.querySelector('#cfContact').value,
      phone: m.root.querySelector('#cfPhone').value, fax: m.root.querySelector('#cfFax').value,
      addr: m.root.querySelector('#cfAddr').value, tax_no: m.root.querySelector('#cfTax').value, note: m.root.querySelector('#cfNote').value,
    };
    try {
      if (c) await api('/customers/' + c.id, { method: 'PUT', body });
      else await api('/customers', { method: 'POST', body });
      state.customers = await api('/customers');
      m.close(); toast('已保存');
      if (onSaved) onSaved(); else rerender();
    } catch (e) { toast(e.message, true); }
  };
}

async function pageCustomer(q, my) {
  const d = await api('/customers/' + q.get('id'));
  if (my !== seq) return;
  const owner = state.user.role === 'admin' ? (q.get('owner') || '') : '';
  const rows = d.documents.map((x) => `<tr class="clickable" data-id="${x.id}">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td><td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.title)}</td><td class="right">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span></td><td class="tiny">${esc(x.doc_date)}</td></tr>`).join('');
  const canManage = state.user.role === 'admin' || Number(d.created_by) === Number(state.user.id);
  const files = (d.files || []).map((f) => customerFileRow(f, canManage)).join('');
  const noteHtml = d.note
    ? `<div style="white-space:pre-wrap;line-height:1.85;font-size:14px">${esc(d.note)}</div>`
    : '<div class="empty" style="padding:16px">还没有备注，点右上角“编辑资料”添加付款方式、账期、成本加点等信息</div>';
  const actions = owner
    ? '<button class="btn" id="btnEditCust">编辑资料</button><div class="tiny">查看成员客户时不提供新建单据入口</div>'
    : `<div class="actions"><button class="btn" id="btnEditCust">编辑资料</button><button class="btn primary" data-new="quote">给该客户报价</button>
      <button class="btn" data-new="contract">新建合同</button></div>`;
  const v = view(`<div class="page-head"><div><h2>${esc(d.name)}</h2><div class="desc">${esc([d.addr, d.contact, d.phone].filter(Boolean).join(' · '))}</div></div>
      ${actions}</div>
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat"><div class="k">单据总数</div><div class="v">${d.stats.documents}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">合同金额</div><div class="v">￥${fmt(d.stats.contract_amount)}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">报价单</div><div class="v">${d.stats.quote_count}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">送货单</div><div class="v">${d.stats.delivery_count}</div><div class="bar"></div></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>客户备注</h3>${noteHtml}</div>
    <div class="card" style="margin-top:14px"><h3>客户附件 <span class="tiny">付款资料 / 客户信息 / 合同扫描件等</span></h3>
      <div class="files" id="custFileList">${files || '<div class="empty" style="padding:14px">还没有附件</div>'}</div>
      ${canManage ? '<div class="drop" id="custDropZone" style="margin-top:12px">点击或拖入文件上传（单个 ≤ 100MB）</div><input type="file" id="custFileInput" multiple hidden>' : ''}
    </div>
    <div class="card" style="margin-top:14px"><h3>往来单据</h3>
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>标题</th><th class="right">金额</th><th>状态</th><th>日期</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><div class="empty">还没有单据</div></td></tr>'}</tbody></table></div>`, 'customers', '客户档案 / ' + d.name);
  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/doc?id=' + tr.dataset.id; });
  v.querySelector('#btnEditCust').onclick = () => customerForm(d, () => rerender());
  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });

  v.querySelectorAll('[data-cust-unlink]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('从客户档案移除该附件？文件仍保留在文件库。')) return;
    try { await api(`/customers/${d.id}/files/${b.dataset.custUnlink}`, { method: 'DELETE' }); toast('已移除'); rerender(); }
    catch (e) { toast(e.message, true); }
  });
  const input = v.querySelector('#custFileInput');
  const drop = v.querySelector('#custDropZone');
  if (input && drop) {
    drop.onclick = () => input.click();
    input.onchange = async () => {
      if (!input.files.length) return;
      await uploadCustomerFiles(d.id, input.files);
      rerender();
    };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
    drop.ondragleave = () => drop.classList.remove('on');
    drop.ondrop = async (e) => {
      e.preventDefault(); drop.classList.remove('on');
      if (e.dataTransfer.files.length) { await uploadCustomerFiles(d.id, e.dataTransfer.files); rerender(); }
    };
  }
}

function customerFileRow(f, canManage) {
  const isImg = /^image\//.test(f.mime || '');
  return `<div class="file-row" data-fid="${f.id}">
      <div class="fi">${isImg ? 'IMG' : (f.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</div>
      <div class="t"><b>${esc(f.name)}</b><span>${(Number(f.size) / 1024).toFixed(0)} KB · ${esc((f.created_at || '').slice(0, 16).replace('T', ' '))}</span></div>
      <a class="btn sm" href="${fileUrl(f.id)}" target="_blank">查看</a>
      <a class="btn sm" href="/api/files/${f.id}/download?token=${encodeURIComponent(state.token)}">下载</a>
      ${canManage ? `<button class="btn sm danger" data-cust-unlink="${f.id}">移除</button>` : ''}
    </div>`;
}

async function uploadCustomerFiles(customerId, files) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append('file', f));
  try {
    await api('/customers/' + customerId + '/files', { method: 'POST', body: fd });
    toast('已上传 ' + files.length + ' 个文件');
  } catch (e) { toast(e.message, true); }
}


export { pageCustomers, pageCustomer };
