/* 回收站 */
import { state, api, esc, fmt, cnyUpper, statusLabel, typeLabel, toast, confirmBox, seq, rerender, dt, modal, fileUrl } from '../core.js';
import { view } from '../shell.js';

async function previewRecycleDoc(id) {
  let d;
  try { d = await api('/recycle/documents/' + id); }
  catch (e) { toast(e.message, true); return; }
  const p = d.payload || {};
  const items = (Array.isArray(p.items) ? p.items : []).filter((it) => it && (it.name || it.spec));
  const amount = Number(d.amount) || 0;
  const customer = d.customer_name || p.customer || '未填客户';
  const delBy = d.deleted_by_name || d.deleted_by_username || '—';
  const itemRows = items.map((it, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td><td class="c">${esc(it.qty)}</td>
      ${d.type === 'delivery' ? `<td class="c">${esc(it.unit || '')}</td>` : `<td class="right">￥${fmt(it.price)}</td><td class="right">￥${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>`}
    </tr>`).join('');
  const fileRows = (d.files || []).map((f) => `<div class="file-row" style="margin-top:7px">
      <div class="fi">${/^image\//.test(f.mime || '') ? 'IMG' : (f.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</div>
      <div class="t"><b>${esc(f.name)}</b><span>${(Number(f.size) / 1024).toFixed(0)} KB</span></div>
      <a class="btn sm" href="${fileUrl(f.id)}" target="_blank">查看</a>
    </div>`).join('');
  const body = `<div class="lock-note"><b>已删除 · 只读查看</b><span>删除于 ${esc(dt(d.deleted_at))}，操作人 ${esc(delBy)}；剩 ${d.days_left} 天自动永久删除。恢复后才能编辑或继续流转。</span></div>
    <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:13px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="type-tag ${esc(d.type)}">${typeLabel(d.type)}</span>
          <b style="font-size:18px">${esc(d.doc_no)}</b>
          <span class="badge">${esc(statusLabel(d.type, d.status))}</span>
        </div>
        <div class="tiny" style="margin-top:6px;line-height:1.8">${esc(customer)} · ${esc(d.doc_date)} · 制单 ${esc(d.owner_name || d.owner_username || '—')} · 主体 ${esc(d.company_name || '—')}</div>
        ${d.parent ? `<div class="tiny" style="margin-top:2px">上游单据：${typeLabel(d.parent.type)} ${esc(d.parent.doc_no)}</div>` : ''}
      </div>
      <div style="flex:none;text-align:right"><div class="tiny">金额</div><div style="font-size:20px;font-weight:700">￥${fmt(amount)}</div></div>
    </div>
    <div class="kv">
      <div><div class="k">客户</div><div class="v">${esc(customer)}</div></div>
      <div><div class="k">联系人</div><div class="v">${esc((p.cust && (p.cust.contact || p.cust.rep)) || d.customer_contact || '—')}</div></div>
      <div><div class="k">电话</div><div class="v">${esc((p.cust && p.cust.phone) || d.customer_phone || '—')}</div></div>
      <div><div class="k">地址</div><div class="v">${esc((p.cust && p.cust.addr) || d.customer_addr || '—')}</div></div>
      <div><div class="k">交货 / 有效期</div><div class="v">${esc((p.terms && (p.terms.delivery || p.terms.validDays)) || (p.validDays ? p.validDays + ' 天' : '—'))}</div></div>
      <div><div class="k">税率</div><div class="v">${esc(p.taxRate != null ? p.taxRate + '%' : '—')}</div></div>
    </div>
    <h3 style="font-size:14px;margin:16px 0 8px">明细（${items.length} 行）</h3>
    <table class="tb"><thead><tr><th style="width:40px">#</th><th>品名</th><th>规格型号</th><th style="width:60px">数量</th>
      ${d.type === 'delivery' ? '<th style="width:55px">单位</th>' : '<th class="right" style="width:90px">单价</th><th class="right" style="width:100px">金额</th>'}</tr></thead>
      <tbody>${itemRows || `<tr><td colspan="6"><div class="empty">没有明细</div></td></tr>`}</tbody></table>
    ${d.type !== 'delivery' ? `<div class="total-line"><span class="upper">大写：${esc(cnyUpper(amount))}</span><span>合计 <span class="sum">￥${fmt(amount)}</span></span></div>` : ''}
    ${(d.remark || p.remark) ? `<p class="tiny" style="margin-top:9px">备注：${esc(d.remark || p.remark)}</p>` : ''}
    <h3 style="font-size:14px;margin:16px 0 4px">附件 <span class="tiny">${(d.files || []).length} 个</span></h3>
    ${fileRows || '<div class="tiny" style="padding:6px 0">没有附件</div>'}`;
  modal({
    title: '回收站单据 · ' + (d.doc_no || '查看'),
    wide: true,
    body,
    footer: '<button class="btn primary" data-close>关闭</button>',
  });
}

async function pageRecycle(q, my) {
  const kind = q.get('kind') === 'file' ? 'file' : 'doc';
  const owner = state.user.role === 'admin' ? (q.get('owner') || '') : '';
  const params = new URLSearchParams();
  if (owner) params.set('owner', owner);
  const data = await api('/recycle' + (params.toString() ? '?' + params.toString() : ''));
  if (my !== seq) return;

  const ownerOpts = state.user.role === 'admin' ? `<select class="input" id="selOwner" style="width:150px"><option value="">全部成员</option>${state.owners.map((o) => `<option value="${o.id}" ${String(o.id) === owner ? 'selected' : ''}>${esc(o.display_name)}${o.role === 'guest' ? '（游客）' : ''}</option>`).join('')}</select>` : '';

  const docRows = data.documents.map((d) => {
    const name = d.owner_name || d.owner_username || '—';
    return `<tr>
      <td><span class="type-tag ${d.type}">${typeLabel(d.type)}</span></td>
      <td class="mono">${esc(d.doc_no)}</td>
      <td>${esc(d.customer_name || d.title || '—')}</td>
      <td class="tiny">${esc(name)}</td>
      <td class="tiny nowrap">${esc(dt(d.deleted_at))}</td>
      <td><span class="badge" style="background:#fff3e0;color:#a15c00">剩 ${d.days_left} 天</span></td>
      <td class="nowrap"><button class="btn sm" data-view-doc="${d.id}">查看</button>
        <button class="btn sm" data-restore-doc="${d.id}">恢复</button>
        <button class="btn sm danger" data-purge-doc="${d.id}">永久删除</button></td>
    </tr>`;
  }).join('');
  const fileRows = data.files.map((f) => {
    const name = f.owner_name || f.owner_username || '—';
    return `<tr>
      <td><b>${esc(f.name)}</b></td>
      <td class="tiny">${(Number(f.size) / 1024).toFixed(0)} KB</td>
      <td class="tiny">${esc(f.category || 'other')}</td>
      <td class="tiny">${esc(name)}</td>
      <td class="tiny nowrap">${esc(dt(f.deleted_at))}</td>
      <td><span class="badge" style="background:#fff3e0;color:#a15c00">剩 ${f.days_left} 天</span></td>
      <td class="nowrap"><button class="btn sm" data-restore-file="${f.id}">恢复</button>
        <button class="btn sm danger" data-purge-file="${f.id}">永久删除</button></td>
    </tr>`;
  }).join('');

  const v = view(`<div class="page-head"><div><h2>回收站</h2><div class="desc">删除的单据和文件会在这里保留 ${data.retention_days} 天，到期后自动永久删除；管理员可查看全部成员</div></div>
      <div style="display:flex;gap:8px;align-items:center">${ownerOpts}</div></div>
    <div class="card">
      <div class="toolbar">
        <div style="display:flex;gap:4px;background:#f3f6fb;border-radius:9px;padding:3px">
          <a class="btn ghost ${kind === 'doc' ? 'primary' : ''}" style="border:0;padding:5px 14px" href="#/recycle${owner ? '?owner=' + owner : ''}">单据 ${data.documents.length}</a>
          <a class="btn ghost ${kind === 'file' ? 'primary' : ''}" style="border:0;padding:5px 14px" href="#/recycle?${new URLSearchParams({ kind: 'file', ...(owner ? { owner } : {}) }).toString()}">文件 ${data.files.length}</a>
        </div>
        <div class="spacer"></div><div class="tiny">到期后由系统每 6 小时自动清理一次</div>
      </div>
      ${kind === 'doc' ? `<table class="tb"><thead><tr><th>类型</th><th>编号</th><th>客户 / 标题</th><th>制单人</th><th>删除时间</th><th>保留</th><th>操作</th></tr></thead>
        <tbody>${docRows || '<tr><td colspan="7"><div class="empty">回收站里没有单据</div></td></tr>'}</tbody></table>`
        : `<table class="tb"><thead><tr><th>文件名</th><th>大小</th><th>类别</th><th>归属人</th><th>删除时间</th><th>保留</th><th>操作</th></tr></thead>
        <tbody>${fileRows || '<tr><td colspan="7"><div class="empty">回收站里没有文件</div></td></tr>'}</tbody></table>`}
    </div>`, 'recycle', '回收站');

  const sel = v.querySelector('#selOwner');
  if (sel) sel.onchange = () => {
    const np = new URLSearchParams();
    if (kind === 'file') np.set('kind', 'file');
    if (sel.value) np.set('owner', sel.value);
    location.hash = '#/recycle' + (np.toString() ? '?' + np.toString() : '');
  };
  v.querySelectorAll('[data-view-doc]').forEach((b) => b.onclick = () => previewRecycleDoc(b.dataset.viewDoc));
  v.querySelectorAll('[data-restore-doc]').forEach((b) => b.onclick = async () => {
    try { await api('/recycle/documents/' + b.dataset.restoreDoc + '/restore', { method: 'POST' }); toast('单据已恢复'); rerender(); } catch (e) { toast(e.message, true); }
  });
  v.querySelectorAll('[data-restore-file]').forEach((b) => b.onclick = async () => {
    try { await api('/recycle/files/' + b.dataset.restoreFile + '/restore', { method: 'POST' }); toast('文件已恢复'); rerender(); } catch (e) { toast(e.message, true); }
  });
  v.querySelectorAll('[data-purge-doc]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('立即永久删除这张单据？建议先点“查看”核对内容，删除后不可恢复。', '永久删除')) return;
    try { await api('/recycle/documents/' + b.dataset.purgeDoc, { method: 'DELETE' }); toast('已永久删除'); rerender(); } catch (e) { toast(e.message, true); }
  });
  v.querySelectorAll('[data-purge-file]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('立即永久删除这个文件？删除后不可恢复。', '永久删除')) return;
    try { await api('/recycle/files/' + b.dataset.purgeFile, { method: 'DELETE' }); toast('已永久删除'); rerender(); } catch (e) { toast(e.message, true); }
  });
}

export { pageRecycle };
