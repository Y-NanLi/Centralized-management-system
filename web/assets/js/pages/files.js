/* 文件库 */
import { state, api, esc, fileUrl, confirmBox, toast, seq, rerender } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 文件库 ---------------- */
async function pageFiles(q, my) {
  const cat = q.get('cat') || '';
  const kw = q.get('q') || '';
  const owner = state.user.role === 'admin' ? (q.get('owner') || '') : '';
  const list = await api('/files?' + new URLSearchParams({ ...(cat ? { category: cat } : {}), ...(kw ? { q: kw } : {}), ...(owner ? { owner } : {}) }).toString());
  if (my !== seq) return;
  const showOwner = state.user.role === 'admin' && !owner;
  const cats = [['', '全部'], ['attachment', '单据附件'], ['contract', '合同扫描件'], ['invoice', '发票'], ['receipt', '送货回单'], ['stamp', '电子章'], ['logo', 'Logo'], ['other', '其他']];
  const cards = list.map((f) => {
    const isImg = /^image\//.test(f.mime || '');
    return `<div class="file-card">
      <div class="thumb">${isImg ? `<img src="${fileUrl(f.id)}" loading="lazy">` : `<span class="ft">${esc((f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 5))}</span>`}</div>
      <div class="info"><b title="${esc(f.name)}">${esc(f.name)}</b><span>${(f.size / 1024).toFixed(0)} KB · ${esc(f.created_at.slice(0, 10))}${f.doc_count ? ' · 关联 ' + f.doc_count : ''}${showOwner ? ' · ' + esc(f.owner_name || f.owner_username || '—') : ''}</span></div>
      <div class="acts"><a class="btn sm" href="/api/files/${f.id}/raw?token=${encodeURIComponent(state.token)}" target="_blank">查看</a>
        <a class="btn sm" href="/api/files/${f.id}/download?token=${encodeURIComponent(state.token)}">下载</a>
        ${(state.user.role === 'admin' || f.owner_id === state.user.id) ? `<button class="btn sm danger" data-del="${f.id}">删除</button>` : ''}</div>
    </div>`;
  }).join('');
  const ownerOpts = state.user.role === 'admin' ? `<select class="input" id="selFileOwner" style="width:150px"><option value="">全部成员</option>${state.owners.map((o) => `<option value="${o.id}" ${String(o.id) === owner ? 'selected' : ''}>${esc(o.display_name)}${o.role === 'guest' ? '（游客）' : ''}</option>`).join('')}</select>` : '';
  const catHref = (k) => '#/files?' + new URLSearchParams({ ...(k ? { cat: k } : {}), ...(owner ? { owner } : {}) }).toString();
  const v = view(`<div class="page-head"><div><h2>${owner ? '成员文件库' : '文件库'}</h2><div class="desc">合同扫描件、发票、送货回单等；${owner ? '管理员查看指定成员的文件' : '每个账号只看自己的文件，公司 Logo 与电子章共用'}</div></div>
      ${owner ? '<div class="tiny">正在查看成员文件，上传请切回“全部成员”</div>' : '<div class="actions"><button class="btn primary" id="btnUpload">+ 上传文件</button></div>'}</div>
    <div class="card"><div class="toolbar">
      ${cats.map(([k, l]) => `<a class="btn sm ${k === cat ? 'primary' : ''}" href="${catHref(k)}">${l}</a>`).join('')}
      <div class="spacer"></div>
      ${ownerOpts}
      <form id="fFile" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="文件名"></div><button class="btn">搜索</button></form>
    </div></div>
    <div style="margin-top:14px">${cards ? `<div class="file-grid">${cards}</div>` : '<div class="card"><div class="empty"><b>没有文件</b>点右上角上传，或到单据详情里添加附件</div></div>'}</div>`, 'files', '文件库');

  const sel = v.querySelector('#selFileOwner');
  if (sel) sel.onchange = () => {
    const np = new URLSearchParams();
    if (cat) np.set('cat', cat);
    if (sel.value) np.set('owner', sel.value);
    location.hash = '#/files' + (np.toString() ? '?' + np.toString() : '');
  };
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.hidden = true;
  document.body.appendChild(input);
  const up = v.querySelector('#btnUpload');
  if (up) up.onclick = () => input.click();
  input.onchange = async () => {
    if (!input.files.length) return;
    const fd = new FormData();
    [...input.files].forEach((f) => fd.append('file', f));
    try { await api('/files?category=' + (cat || 'other'), { method: 'POST', body: fd }); toast('已上传'); rerender(); } catch (e) { toast(e.message, true); }
    input.remove();
  };
  v.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('删除这个文件？文件会移入回收站，30 天内可恢复，到期自动永久删除。', '移入回收站')) return;
    try { await api('/files/' + b.dataset.del, { method: 'DELETE' }); toast('已移入回收站，30 天内可恢复'); rerender(); } catch (e) { toast(e.message, true); }
  });
  v.querySelector('#fFile').onsubmit = (e) => {
    e.preventDefault();
    const kwv = new FormData(e.target).get('q');
    location.hash = '#/files?' + new URLSearchParams({ ...(cat ? { cat } : {}), ...(kwv ? { q: kwv } : {}), ...(owner ? { owner } : {}) }).toString();
  };
}


export { pageFiles };
