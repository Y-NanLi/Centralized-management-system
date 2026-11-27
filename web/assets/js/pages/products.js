/* 货品库 */
import { api, esc, fmt, toast, modal, seq } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 货品 ---------------- */
async function pageProducts(q, my) {
  const kw = q.get('q') || '';
  const list = await api('/products' + (kw ? '?q=' + encodeURIComponent(kw) : ''));
  if (my !== seq) return;
  const rows = list.map((p) => `<tr>
      <td><b>${esc(p.name)}</b></td><td class="mono">${esc(p.spec || '—')}</td><td>${esc(p.unit || '—')}</td>
      <td class="right">￥${fmt(p.price)}</td><td class="tiny">${esc(p.note || '')}</td>
      <td class="tiny nowrap"><a href="#" data-edit="${p.id}">编辑</a></td></tr>`).join('');
  const v = view(`<div class="page-head"><div><h2>货品库</h2><div class="desc">共 ${list.length} 条 · 报价 / 合同 / 送货单共用；开单时输规格即可带出品名与单价</div></div>
      <div class="actions"><button class="btn primary" id="btnAddProd">+ 新增货品</button></div></div>
    <div class="card"><div class="toolbar"><form id="fProd" style="display:flex;gap:8px"><div class="search"><input class="input" name="q" value="${esc(kw)}" placeholder="品名 / 规格"></div><button class="btn">搜索</button></form></div>
      <table class="tb"><thead><tr><th>品名</th><th>规格型号</th><th>单位</th><th class="right">参考单价</th><th>备注</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><div class="empty"><b>货品库是空的</b>开单时明细填齐会自动入库，也可以在这里手动添加</div></td></tr>'}</tbody></table></div>`, 'products', '货品库');
  v.querySelector('#fProd').onsubmit = (e) => {
    e.preventDefault();
    const kwv = new FormData(e.target).get('q');
    location.hash = '#/products' + (kwv ? '?q=' + encodeURIComponent(kwv) : '');
  };
  v.querySelector('#btnAddProd').onclick = () => productForm();
  v.querySelectorAll('[data-edit]').forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    productForm(list.find((x) => String(x.id) === a.dataset.edit));
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
      m.close(); toast('已保存'); if (after) after(); else route();
    } catch (e) { toast(e.message, true); }
  };
}


export { pageProducts };
