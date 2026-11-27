/* 文件库 */
import { api, esc, confirmBox, toast, seq } from '../core.js';
import { view } from '../shell.js';
import { fileRow } from './documents.js';

/* ---------------- 文件库 ---------------- */
async function pageFiles(q, my) {
  const cat = q.get('cat') || '';
  const kw = q.get('q') || '';
  const list = await api('/files?' + new URLSearchParams({ ...(cat ? { category: cat } : {}), ...(kw ? { q: kw } : {}) }).toString());
  if (my !== seq) return;
  const cats = [['', '全部'], ['attachment', '单据附件'], ['contract', '合同扫描件'], ['invoice', '发票'], ['receipt', '送货回单'], ['stamp', '电子章'], ['logo', 'Logo'], ['other', '其他']];
  const cards = list.map((f) => {
    const isImg = /^image\//.test(f.mime || '');
    return `<div class="file-card">
      <div class="thumb">${isImg ? `<img src="${fileUrl(f.id)}" loading="lazy">` : `<span class="ft">${esc((f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 5))}</span>`}</div>
      <div class="info"><b title="${esc(f.name)}">${esc(f.name)}</b><span>${(f.size / 1024).toFixed(0)} KB · ${esc(f.created_at.slice(0, 10))}${f.doc_count ? ' · 关联 ' + f.doc_count : ''}</span></div>
      <div class="acts"><a class="btn sm" href="/api/files/${f.id}/raw?token=${encodeURIComponent(state.token)}" target="_blank">查看</a>
        <a class="btn sm" href="/api/files/${f.id}/download?token=${encodeURIComponent(state.token)}">下载</a>
        ${['admin', 'manager'].includes(state.user.role) ? `<button class="btn sm danger" data-del="${f.id}">删除</button>` : ''}</div>
    </div>`;
  }).join('');
  const v = view(`<div class="page-head"><div><h2>文件库</h2><div class="desc">合同扫描件、发票、送货回单、电子章等集中存放；也可在单据详情里直接上传</div></div>
      <div class="actions"><button class="btn primary" id="btnUpload">+ 上传文件</button></div></div>
    <div class="card"><div class="toolbar">
      ${cats.map(([k, l]) => `<a class="btn sm ${k === cat ? 'primary' : ''}" href="#/files${k ? '?cat=' + k : ''}">${l}</a>`).join('')}
      <div class="spacer"></div>
      <form id="fFile" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="文件名"></div><button class="btn">搜索</button></form>
    </div></div>
    <div style="margin-top:14px">${cards ? `<div class="file-grid">${cards}</div>` : '<div class="card"><div class="empty"><b>没有文件</b>点右上角上传，或到单据详情里添加附件</div></div>'}</div>`, 'files', '文件库');
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.hidden = true;
  document.body.appendChild(input);
  v.querySelector('#btnUpload').onclick = () => input.click();
  input.onchange = async () => {
    if (!input.files.length) return;
    const fd = new FormData();
    [...input.files].forEach((f) => fd.append('file', f));
    try { await api('/files?category=' + (cat || 'other'), { method: 'POST', body: fd }); toast('已上传'); route(); } catch (e) { toast(e.message, true); }
    input.remove();
  };
  v.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('删除这个文件？')) return;
    try { await api('/files/' + b.dataset.del, { method: 'DELETE' }); toast('已删除'); route(); } catch (e) { toast(e.message, true); }
  });
  v.querySelector('#fFile').onsubmit = (e) => {
    e.preventDefault();
    const kwv = new FormData(e.target).get('q');
    location.hash = '#/files?' + new URLSearchParams({ ...(cat ? { cat } : {}), ...(kwv ? { q: kwv } : {}) }).toString();
  };
}


export { pageFiles };
