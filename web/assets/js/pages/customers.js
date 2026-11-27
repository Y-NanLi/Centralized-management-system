/* 客户档案 */
import { api, esc, fmt, typeLabel, statusLabel, toast, modal, seq } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 客户 ---------------- */
async function pageCustomers(q, my) {
  const kw = q.get('q') || '';
  const list = await api('/customers' + (kw ? '?q=' + encodeURIComponent(kw) : ''));
  if (my !== seq) return;
  const rows = list.map((c) => `<tr class="clickable" data-id="${c.id}">
      <td><b>${esc(c.name)}</b><div class="tiny">${esc(c.addr || '')}</div></td>
      <td>${esc(c.contact || '—')}</td><td class="mono">${esc(c.phone || '—')}</td>
      <td class="right">${c.doc_count}</td><td class="right">￥${fmt(c.total_amount)}</td>
      <td class="tiny">${esc(c.last_date || '—')}</td>
      <td class="tiny"><a href="#/customer?id=${c.id}" onclick="event.stopPropagation()">详情</a></td>
    </tr>`).join('');
  const v = view(`<div class="page-head"><div><h2>客户档案</h2><div class="desc">共 ${list.length} 家 · 三套单据共用同一份客户资料，保存单据时自动建档</div></div>
      <div class="actions"><button class="btn primary" id="btnAddCust">+ 新增客户</button></div></div>
    <div class="card"><div class="toolbar"><form id="fCust" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="名称 / 联系人 / 电话 / 地址"></div><button class="btn">搜索</button></form></div>
      <table class="tb"><thead><tr><th>客户名称</th><th>联系人</th><th>电话</th><th class="right">单据数</th><th class="right">累计金额</th><th>最近单据</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7"><div class="empty"><b>还没有客户</b>新建单据时填客户名会自动建档</div></td></tr>'}</tbody></table></div>`, 'customers', '客户档案');

  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/customer?id=' + tr.dataset.id; });
  v.querySelector('#fCust').onsubmit = (e) => {
    e.preventDefault();
    const kwv = new FormData(e.target).get('q');
    location.hash = '#/customers' + (kwv ? '?q=' + encodeURIComponent(kwv) : '');
  };
  v.querySelector('#btnAddCust').onclick = () => customerForm();
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
      <div class="field" style="grid-column:1/-1"><label>备注</label><input class="input" id="cfNote" value="${esc(c && c.note || '')}"></div>
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
      if (onSaved) onSaved(); else route();
    } catch (e) { toast(e.message, true); }
  };
}

async function pageCustomer(q, my) {
  const d = await api('/customers/' + q.get('id'));
  if (my !== seq) return;
  const rows = d.documents.map((x) => `<tr class="clickable" data-id="${x.id}">
      <td><span class="type-tag ${x.type}">${typeLabel(x.type)}</span></td><td class="mono">${esc(x.doc_no)}</td>
      <td>${esc(x.title)}</td><td class="right">￥${fmt(x.amount)}</td>
      <td><span class="badge ${x.status}">${statusLabel(x.type, x.status)}</span></td><td class="tiny">${esc(x.doc_date)}</td></tr>`).join('');
  const v = view(`<div class="page-head"><div><h2>${esc(d.name)}</h2><div class="desc">${esc([d.addr, d.contact, d.phone].filter(Boolean).join(' · '))}</div></div>
      <div class="actions"><button class="btn" id="btnEditCust">编辑资料</button><button class="btn primary" data-new="quote">给该客户报价</button>
      <button class="btn" data-new="contract">新建合同</button></div></div>
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat"><div class="k">单据总数</div><div class="v">${d.stats.documents}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">合同金额</div><div class="v">￥${fmt(d.stats.contract_amount)}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">报价单</div><div class="v">${d.stats.quote_count}</div><div class="bar"></div></div>
      <div class="stat"><div class="k">送货单</div><div class="v">${d.stats.delivery_count}</div><div class="bar"></div></div>
    </div>
    <div class="card"><h3>往来单据</h3>
      <table class="tb"><thead><tr><th>类型</th><th>编号</th><th>标题</th><th class="right">金额</th><th>状态</th><th>日期</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><div class="empty">还没有单据</div></td></tr>'}</tbody></table></div>`, 'customers', '客户档案 / ' + d.name);
  v.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/doc?id=' + tr.dataset.id; });
  v.querySelector('#btnEditCust').onclick = () => customerForm(d, () => route());
  v.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => { location.hash = `#/doc/new?type=${b.dataset.new}`; });
}


export { pageCustomers, pageCustomer };
