/* 货品库 */
import { state, api, esc, fmt, toast, modal, seq, rerender } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 货品 ---------------- */
async function pageProducts(q, my) {
  const kw = q.get('q') || '';
  const owner = state.user.role === 'admin' ? (q.get('owner') || '') : '';
  const params = new URLSearchParams();
  if (kw) params.set('q', kw);
  if (owner) params.set('owner', owner);
  const list = await api('/products' + (params.toString() ? '?' + params.toString() : ''));
  if (my !== seq) return;
  const cols = '<colgroup><col style="width:24%"><col style="width:16%"><col style="width:8%"><col style="width:12%"><col style="width:18%"><col style="width:10%"><col style="width:12%"></colgroup>';
  const rows = list.map((p) => {
    const mine = Number(p.owner_id) === Number(state.user.id);
    return `<tr>
      <td><b>${esc(p.name)}</b></td><td class="mono">${esc(p.spec || '—')}</td><td>${esc(p.unit || '—')}</td>
      <td class="right">￥${fmt(p.price)}</td><td class="tiny">${esc(p.note || '')}</td>
      <td class="tiny">${esc(p.owner_name || p.owner_username || '—')}</td>
      <td class="tiny nowrap right">${mine
        ? `<a href="#" data-edit="${p.id}">编辑</a> <a href="#" data-del="${p.id}" style="color:#c0392b;margin-left:8px">删除</a>`
        : '<span class="muted">只读</span>'}</td>
    </tr>`;
  }).join('');
  const ownerOpts = state.user.role === 'admin' ? `<select class="input" name="owner" style="width:150px"><option value="">全部成员</option>${state.owners.map((o) => `<option value="${o.id}" ${String(o.id) === owner ? 'selected' : ''}>${esc(o.display_name)}${o.role === 'guest' ? '（游客）' : ''}</option>`).join('')}</select>` : '';
  const desc = owner
    ? '管理员查看指定成员创建的货品'
    : '全系统共享；只能修改或删除自己创建的货品，开单时输规格即可带出品名与单价';
  const v = view(`<div class="page-head"><div><h2>${owner ? '成员货品库' : '货品库'}</h2><div class="desc">共 ${list.length} 条 · ${desc}</div></div>
      ${owner ? '<div class="tiny">正在查看成员货品，新增货品请切回“全部成员”</div>' : '<div class="actions"><button class="btn primary" id="btnAddProd">+ 新增货品</button></div>'}</div>
    <div class="card"><div class="toolbar"><form id="fProd" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="品名 / 规格"></div>${ownerOpts}<button class="btn">搜索</button></form></div>
      <table class="tb" style="table-layout:fixed">${cols}<thead><tr><th>品名</th><th>规格型号</th><th>单位</th><th class="right">参考单价</th><th>备注</th><th>创建人</th><th class="right">操作</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7"><div class="empty"><b>货品库是空的</b>开单时明细填齐会自动入库，也可以在这里手动添加</div></td></tr>`}</tbody></table></div>`, 'products', '货品库');
  v.querySelector('#fProd').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const np = new URLSearchParams();
    if (fd.get('q')) np.set('q', fd.get('q'));
    if (fd.get('owner')) np.set('owner', fd.get('owner'));
    location.hash = '#/products' + (np.toString() ? '?' + np.toString() : '');
  };
  const add = v.querySelector('#btnAddProd');
  if (add) add.onclick = () => productForm();
  v.querySelectorAll('[data-edit]').forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    productForm(list.find((x) => String(x.id) === a.dataset.edit));
  });
  v.querySelectorAll('[data-del]').forEach((a) => a.onclick = async (e) => {
    e.preventDefault();
    const p = list.find((x) => String(x.id) === a.dataset.del);
    if (!p || !confirm('删除货品「' + p.name + '」？')) return;
    try {
      await api('/products/' + p.id, { method: 'DELETE' });
      state.products = await api('/products');
      toast('已删除');
      rerender();
    } catch (err) { toast(err.message, true); }
  });
}

function productForm(p, after) {
  const m = modal({
    title: p ? '编辑货品' : '新增货品',
    body: `<div class="grid2">
      <div class="field"><label>品名 *</label><input class="input" id="pfName" value="${esc(p && p.name || '')}"></div>
      <div class="field"><label>规格型号</label><input class="input" id="pfSpec" value="${esc(p && p.spec || '')}"></div>
      <div class="field"><label>单位</label><input class="input" id="pfUnit" value="${esc(p && p.unit || '')}"></div>
      <div class="field"><label>参考单价</label><input class="input" type="number" step="0.01" id="pfPrice" value="${esc(p && p.price || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>备注</label><input class="input" id="pfNote" value="${esc(p && p.note || '')}"></div>
    </div>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="pfSave">保存</button>',
  });
  m.root.querySelector('#pfSave').onclick = async () => {
    const body = {
      name: m.root.querySelector('#pfName').value, spec: m.root.querySelector('#pfSpec').value,
      unit: m.root.querySelector('#pfUnit').value, price: Number(m.root.querySelector('#pfPrice').value) || 0,
      note: m.root.querySelector('#pfNote').value,
    };
    try {
      if (p) await api('/products/' + p.id, { method: 'PUT', body });
      else await api('/products', { method: 'POST', body });
      state.products = await api('/products');
      m.close(); toast('已保存'); if (after) after(); else rerender();
    } catch (e) { toast(e.message, true); }
  };
}


export { pageProducts };
