/* 回收站 */
import { state, api, esc, typeLabel, toast, confirmBox, seq, rerender, dt } from '../core.js';
import { view } from '../shell.js';

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
      <td class="nowrap"><button class="btn sm" data-restore-doc="${d.id}">恢复</button>
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
  v.querySelectorAll('[data-restore-doc]').forEach((b) => b.onclick = async () => {
    try { await api('/recycle/documents/' + b.dataset.restoreDoc + '/restore', { method: 'POST' }); toast('单据已恢复'); rerender(); } catch (e) { toast(e.message, true); }
  });
  v.querySelectorAll('[data-restore-file]').forEach((b) => b.onclick = async () => {
    try { await api('/recycle/files/' + b.dataset.restoreFile + '/restore', { method: 'POST' }); toast('文件已恢复'); rerender(); } catch (e) { toast(e.message, true); }
  });
  v.querySelectorAll('[data-purge-doc]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('立即永久删除这张单据？删除后不可恢复。', '永久删除')) return;
    try { await api('/recycle/documents/' + b.dataset.purgeDoc, { method: 'DELETE' }); toast('已永久删除'); rerender(); } catch (e) { toast(e.message, true); }
  });
  v.querySelectorAll('[data-purge-file]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('立即永久删除这个文件？删除后不可恢复。', '永久删除')) return;
    try { await api('/recycle/files/' + b.dataset.purgeFile, { method: 'DELETE' }); toast('已永久删除'); rerender(); } catch (e) { toast(e.message, true); }
  });
}

export { pageRecycle };
