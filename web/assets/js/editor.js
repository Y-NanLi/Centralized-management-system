/* 单据新建 / 编辑 */
import { state, api, esc, fmt, today, typeLabel, toast, modal, cnyUpper, seq } from './core.js';
import { view } from './shell.js';

/* ---------------- 单据编辑 ---------------- */
function blankPayload(type, company) {
  const base = { company: company.code, date: today(), no: '', remark: '' };
  const self = { name: company.name, addr: company.addr, rep: company.rep, phone: company.phone, fax: company.fax };
  if (type === 'quote') {
    return { ...base, validDays: 7, taxRate: 13, taxMode: 'in', cust: { name: '', contact: '', phone: '', fax: '', about: '' },
      self, items: [blankItem(type)], terms: { delivery: '5个工作日', invoice: '以税率13%增值税发票', extra: [] },
      showSign: false, stamp: { on: false, size: 42, dx: 0, dy: 0, rot: 0 }, cols: [7, 25, 28, 9, 15, 16], meta: { fsTitle: 100, fsInfo: 100, fsItem: 100 } };
  }
  if (type === 'contract') {
    return { ...base, signDate: '', taxRate: 13, cust: { name: '', addr: '', rep: '', phone: '' }, self,
      items: [blankItem(type)],
      terms: [
        { id: 'effect', label: '', text: '本购销合同具有法律效力，签约双方必须全面履行，任何一方不得擅自变动或解除。若因不可预计因素变动或解除，应双方友好协商依法另立协议。', on: true },
        { id: 'delivery', label: '交货时间：', text: '款到发货', on: true },
        { id: 'pay', label: '付款方式：', text: '现结', on: true },
        { id: 'warranty', label: '保修期限：', text: '质保三年', on: true },
        { id: 'accept', label: '验收标准及提出异议期限：', text: '购货方收到货物后即可开箱验收，如有产品型号不符或质量问题，购货方在验货后一周内可提出异议并要求供货方更换。', on: true },
      ],
      termNumbered: true, showSign: true, stamp: { on: true, size: 40, dx: 18, dy: 0, rot: 0 }, cols: [26, 34, 10, 15, 15], meta: { fsTitle: 100, fsInfo: 100, fsItem: 100 } };
  }
  return { ...base, dtype: '送货单', customer: '', summary: '', items: [blankItem('delivery')], showSign: true };
}

function blankItem(type) {
  if (type === 'delivery') return { code: '', name: '', spec: '', proj: '', unit: '', qty: '', pin: '', contract: '' };
  return { name: '', spec: '', qty: '', price: '' };
}

async function pageDocNew(q, my) {
  const type = q.get('type') || 'quote';
  const company = state.companies[0];
  const payload = blankPayload(type, company);
  const noPreview = await api(`/number/next?type=${type}&company_id=${company.id}`);
  if (my !== seq) return;
  payload.no = noPreview.doc_no;
  openEditor({ id: 0, type, payload, status: 'draft', doc_date: today(), doc_no: noPreview.doc_no, title: '', remark: '', company_id: company.id });
}

async function pageDocEdit(q, my) {
  const id = q.get('id');
  const d = await api('/documents/' + id);
  if (my !== seq) return;
  openEditor({
    id: d.id, type: d.type, payload: d.payload, status: d.status, doc_date: d.doc_date,
    doc_no: d.doc_no, title: d.title, remark: d.remark, company_id: d.company_id,
  });
}

function openEditor(ed) {
  const type = ed.type;
  const p = ed.payload;
  const company = state.companies.find((c) => c.id === ed.company_id) || state.companies[0];
  // 兼容旧数据
  if (!p.cust) p.cust = { name: '', contact: '', phone: '', addr: '', rep: '', fax: '', about: '' };
  if (!Array.isArray(p.items) || !p.items.length) p.items = [blankItem(type)];
  if (type === 'contract' && !Array.isArray(p.terms)) p.terms = blankPayload('contract', company).terms;
  if (type === 'quote' && (!p.terms || Array.isArray(p.terms))) p.terms = { delivery: '', invoice: '', extra: [] };

  const itemCols = type === 'delivery'
    ? [['name', '品名'], ['spec', '规格型号'], ['proj', '项目'], ['unit', '单位'], ['qty', '数量'], ['pin', '批号/备注']]
    : [['name', '品名'], ['spec', '规格型号'], ['qty', '数量'], ['price', '单价']];

  const itemsHtml = () => p.items.map((it, i) => `<tr data-row="${i}">
      <td class="c" style="width:34px">${i + 1}</td>
      ${itemCols.map(([k, label]) => `<td><input data-idx="${i}" data-f="${k}" value="${esc(it[k] == null ? '' : it[k])}" placeholder="${label}"></td>`).join('')}
      ${type === 'delivery' ? '' : `<td class="amt">￥${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>`}
      <td style="width:30px"><button class="del" data-del="${i}" title="删除本行">×</button></td>
    </tr>`).join('');

  const statusOpts = state.meta.statuses[type].map((s) => `<option value="${s.key}" ${s.key === ed.status ? 'selected' : ''}>${s.label}</option>`).join('');
  const companyOpts = state.companies.map((c) => `<option value="${c.id}" ${c.id === ed.company_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  const termsHtml = () => type === 'contract' && Array.isArray(p.terms)
    ? p.terms.map((t, i) => `<div class="term-row" data-term="${i}">
        <input type="checkbox" data-tf="on" ${t.on !== false ? 'checked' : ''}>
        <input class="input" data-tf="label" value="${esc(t.label || '')}" placeholder="条目标签，可空">
        <input class="input" data-tf="text" value="${esc(t.text || '')}" placeholder="条款内容">
        <button class="del" data-tdel="${i}" style="border:0;background:none;cursor:pointer;color:#b9c3d3">×</button>
      </div>`).join('')
    : `<div class="grid3">
        <div class="field"><label>交货期</label><input class="input" data-tk="delivery" value="${esc((p.terms && p.terms.delivery) || '')}"></div>
        <div class="field"><label>发票</label><input class="input" data-tk="invoice" value="${esc((p.terms && p.terms.invoice) || '')}"></div>
        <div class="field"><label>报价有效期（天）</label><input class="input" type="number" data-tk="validDays" value="${esc(p.validDays || 7)}"></div>
      </div>
      <div class="field"><label>其他条款（每行一条）</label><textarea class="input" rows="2" data-tk="extra">${esc(((p.terms && p.terms.extra) || []).join('\n'))}</textarea></div>`;

  const v = view(`
    <div class="page-head"><div><h2>${ed.id ? '编辑单据' : '新建' + typeLabel(type)}</h2>
      <div class="desc">保存后自动写入客户档案与货品库；需要派生下游单据时，在详情页点「转合同 / 转送货单」</div></div>
      <div class="actions"><button class="btn" id="btnCancel">取消</button><button class="btn primary" id="btnSave">保存</button><button class="btn" id="btnSavePrint">保存并打印</button></div></div>

    <div class="card">
      <h3>基本信息</h3>
      <div class="grid4">
        <div class="field"><label>单据类型</label><input class="input" value="${typeLabel(type)}" disabled></div>
        <div class="field"><label>公司主体</label><select class="input" id="companySel">${companyOpts}</select></div>
        <div class="field"><label>单据编号</label><input class="input mono" id="noInput" value="${esc(ed.doc_no)}"></div>
        <div class="field"><label>单据日期</label><input class="input" type="date" id="dateInput" value="${esc(ed.doc_date)}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>${type === 'delivery' ? '收货单位' : '客户名称'}</label>
          <input class="input" id="custName" list="custList" value="${esc(type === 'delivery' ? (p.customer || '') : (p.cust.name || ''))}" placeholder="输入或从客户档案选择">
          <datalist id="custList">${state.customers.map((c) => `<option value="${esc(c.name)}">${esc([c.contact, c.phone].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
        </div>
        <div class="field"><label>联系人 / 代表人</label><input class="input" id="custContact" value="${esc((p.cust && (p.cust.contact || p.cust.rep)) || '')}"></div>
        <div class="field"><label>电话</label><input class="input" id="custPhone" value="${esc((p.cust && p.cust.phone) || '')}"></div>
        <div class="field"><label>地址</label><input class="input" id="custAddr" value="${esc((p.cust && p.cust.addr) || '')}"></div>
        ${type === 'delivery' ? `<div class="field"><label>单据类型（送货单/样品单/提前送货单）</label><select class="input" id="dtypeSel">${['送货单', '样品单', '提前送货单'].map((x) => `<option ${p.dtype === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label>状态</label><select class="input" id="statusSel">${statusOpts}</select></div>
        ${type === 'delivery' ? `<div class="field"><label>关联合同号</label><input class="input" id="contractNo" value="${esc((p.items[0] && p.items[0].contract) || '')}" placeholder="可空"></div>` : `<div class="field"><label>税率</label><select class="input" id="taxSel">${[13, 9, 6, 3, 0].map((x) => `<option value="${x}" ${Number(p.taxRate) === x ? 'selected' : ''}>${x}%</option>`).join('')}</select></div>`}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>明细 <span class="tiny">在「规格型号」输入可从货品库带出品名与单价；填齐后自动入库</span></h3>
      <div class="databar">
        <button class="btn sm" id="btnAddRow">+ 加一行</button>
        <button class="btn sm" id="btnPaste">从 Excel 粘贴</button>
        <span class="tiny">支持 Tab / 逗号分隔，一次多行</span>
        <div class="spacer"></div>
        <span class="tiny">合计 <b id="totalText" style="color:#1e4b8f;font-size:16px">￥0.00</b></span>
      </div>
      <table class="items-table"><thead><tr><th style="width:34px">#</th>
        ${itemCols.map(([k, l]) => `<th>${l}</th>`).join('')}
        ${type === 'delivery' ? '' : '<th style="width:100px">金额</th>'}<th style="width:30px"></th></tr></thead>
        <tbody id="itemBody">${itemsHtml()}</tbody></table>
      ${type !== 'delivery' ? `<div class="total-line"><span class="upper" id="upperText">${esc(cnyUpper(0))}</span><span>合计 <span class="sum" id="sumText">￥0.00</span></span></div>` : ''}
      <div class="field" style="margin-top:12px"><label>备注</label><textarea class="input" id="remark" rows="2">${esc(p.remark || ed.remark || '')}</textarea></div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>条款</h3>
      <div id="termsBox">${termsHtml()}</div>
      ${type === 'contract' ? '<button class="btn sm" id="btnAddTerm" style="margin-top:6px">+ 加一条条款</button>' : ''}
      <datalist id="prodList">${state.products.map((x) => `<option value="${esc(x.spec)}">${esc(x.name)}${x.price ? ' ￥' + x.price : ''}</option>`).join('')}</datalist>
    </div>`, 'docs', (ed.id ? '编辑 / ' : '新建 / ') + typeLabel(type));

  /* ---------- 交互 ---------- */
  const recalc = () => {
    if (type === 'delivery') return;
    let total = 0;
    p.items.forEach((it) => { total += (Number(it.qty) || 0) * (Number(it.price) || 0); });
    const sum = v.querySelector('#sumText'); if (sum) sum.textContent = '￥' + fmt(total);
    const up = v.querySelector('#upperText'); if (up) up.textContent = cnyUpper(total);
    const tt = v.querySelector('#totalText'); if (tt) tt.textContent = '￥' + fmt(total);
    v.querySelectorAll('tr[data-row]').forEach((tr) => {
      const i = Number(tr.dataset.row); const it = p.items[i];
      const amt = tr.querySelector('.amt'); if (amt) amt.textContent = '￥' + fmt((Number(it.qty) || 0) * (Number(it.price) || 0));
    });
  };

  const bindRows = () => {
    v.querySelectorAll('#itemBody input').forEach((inp) => {
      inp.oninput = () => { p.items[Number(inp.dataset.idx)][inp.dataset.f] = inp.value; recalc(); };
      if (inp.dataset.f === 'spec') {
        inp.setAttribute('list', 'prodList');
        inp.onchange = () => {
          const hit = state.products.find((x) => x.spec === inp.value);
          const row = p.items[Number(inp.dataset.idx)];
          const tr = inp.closest('tr');
          if (hit) {
            if (!row.name) { row.name = hit.name; tr.querySelector('[data-f="name"]').value = hit.name; }
            if (!row.price && hit.price) { row.price = hit.price; const pi = tr.querySelector('[data-f="price"]'); if (pi) pi.value = hit.price; }
            if (!row.unit && hit.unit) { row.unit = hit.unit; const ui = tr.querySelector('[data-f="unit"]'); if (ui) ui.value = hit.unit; }
            recalc();
          }
        };
      }
    });
    v.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      p.items.splice(Number(b.dataset.del), 1);
      if (!p.items.length) p.items.push(blankItem(type));
      refreshRows();
    });
  };
  const refreshRows = () => { v.querySelector('#itemBody').innerHTML = itemsHtml(); bindRows(); recalc(); };
  bindRows(); recalc();

  v.querySelector('#btnAddRow').onclick = () => { p.items.push(blankItem(type)); refreshRows(); };
  v.querySelector('#btnPaste').onclick = () => openPaste(p, type, () => refreshRows());

  // 表头字段
  v.querySelector('#custName').onchange = (e) => {
    const name = e.target.value.trim();
    p.cust.name = name;
    if (type === 'delivery') p.customer = name;
    const hit = state.customers.find((x) => x.name === name);
    if (hit) {
      if (!p.cust.contact && (hit.contact || hit.rep)) { p.cust.contact = hit.contact || hit.rep; v.querySelector('#custContact').value = p.cust.contact; }
      if (!p.cust.phone && hit.phone) { p.cust.phone = hit.phone; v.querySelector('#custPhone').value = hit.phone; }
      if (!p.cust.addr && hit.addr) { p.cust.addr = hit.addr; v.querySelector('#custAddr').value = hit.addr; }
    }
  };
  v.querySelector('#custContact').oninput = (e) => { p.cust.contact = e.target.value; };
  v.querySelector('#custPhone').oninput = (e) => { p.cust.phone = e.target.value; };
  v.querySelector('#custAddr').oninput = (e) => { p.cust.addr = e.target.value; };
  v.querySelector('#remark').oninput = (e) => { p.remark = e.target.value; };
  v.querySelector('#dateInput').onchange = (e) => { ed.doc_date = e.target.value; p.date = e.target.value; };
  v.querySelector('#noInput').oninput = (e) => { ed.doc_no = e.target.value; p.no = e.target.value; };
  v.querySelector('#statusSel').onchange = (e) => { ed.status = e.target.value; };
  if (v.querySelector('#dtypeSel')) v.querySelector('#dtypeSel').onchange = (e) => { p.dtype = e.target.value; };
  if (v.querySelector('#taxSel')) v.querySelector('#taxSel').onchange = (e) => { p.taxRate = Number(e.target.value); };
  if (v.querySelector('#contractNo')) v.querySelector('#contractNo').oninput = (e) => { p.items.forEach((it) => { it.contract = e.target.value; }); };

  v.querySelector('#companySel').onchange = async (e) => {
    ed.company_id = Number(e.target.value);
    const co = state.companies.find((c) => c.id === ed.company_id);
    p.company = co.code;
    if (!p.self || !p.self.name || /捷信通|悦智乐|安驰/.test(p.self.name)) {
      p.self = { name: co.name, addr: co.addr, rep: co.rep, phone: co.phone, fax: co.fax };
    }
    if (!ed.id) {
      try {
        const r = await api(`/number/next?type=${type}&company_id=${co.id}`);
        ed.doc_no = r.doc_no; p.no = r.doc_no;
        v.querySelector('#noInput').value = r.doc_no;
        toast('编号已按新主体重排：' + r.doc_no);
      } catch { /* 忽略 */ }
    }
  };

  // 条款
  const bindTerms = () => {
    v.querySelectorAll('[data-tf]').forEach((inp) => {
      const i = Number(inp.closest('[data-term]').dataset.term);
      inp.oninput = inp.onchange = () => {
        if (inp.dataset.tf === 'on') p.terms[i].on = inp.checked;
        else p.terms[i][inp.dataset.tf] = inp.value;
      };
    });
    v.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = (e) => {
      e.preventDefault();
      p.terms.splice(Number(b.dataset.tdel), 1);
      drawTerms();
    });
  };
  const drawTerms = () => {
    if (type !== 'contract') return;
    v.querySelector('#termsBox').innerHTML = termsHtml();
    bindTerms();
  };
  bindTerms();
  if (v.querySelector('#btnAddTerm')) v.querySelector('#btnAddTerm').onclick = () => {
    p.terms.push({ id: 'custom' + Date.now(), label: '', text: '', on: true });
    drawTerms();
  };
  v.querySelectorAll('[data-tk]').forEach((inp) => {
    inp.oninput = () => {
      const k = inp.dataset.tk;
      if (k === 'validDays') p.validDays = Number(inp.value) || 0;
      else if (k === 'extra') p.terms.extra = inp.value.split('\n').filter(Boolean);
      else { p.terms = p.terms || {}; p.terms[k] = inp.value; }
    };
  });

  const save = async (thenPrint) => {
    const body = {
      type, company_id: ed.company_id, doc_no: ed.doc_no, doc_date: ed.doc_date, status: ed.status,
      title: ed.title, remark: p.remark || '', tax_rate: p.taxRate, payload: p,
    };
    try {
      const doc = ed.id
        ? await api('/documents/' + ed.id, { method: 'PUT', body })
        : await api('/documents', { method: 'POST', body });
      toast('已保存 ' + doc.doc_no);
      if (thenPrint) location.hash = '#/print?id=' + doc.id;
      else location.hash = '#/doc?id=' + doc.id;
    } catch (e) { toast(e.message, true); }
  };
  v.querySelector('#btnSave').onclick = () => save(false);
  v.querySelector('#btnSavePrint').onclick = () => save(true);
  v.querySelector('#btnCancel').onclick = () => history.length > 1 ? history.back() : (location.hash = '#/docs');
}

function openPaste(p, type, done) {
  const m = modal({
    title: '从 Excel 粘贴明细',
    wide: true,
    body: `<p class="tiny">直接从 Excel 选中几行粘贴（列顺序：${type === 'delivery' ? '品名、规格、项目、单位、数量、备注' : '品名、规格、数量、单价'}），Tab 或逗号分隔。</p>
      <textarea class="input" id="pasteBox" rows="10" placeholder="工控机\tIPC-610\t2\t5200"></textarea>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="pasteOk">导入</button>',
  });
  m.root.querySelector('#pasteOk').onclick = () => {
    const text = m.root.querySelector('#pasteBox').value.trim();
    if (!text) return;
    const rows = text.split(/\r?\n/).filter(Boolean).map((line) => line.includes('\t') ? line.split('\t') : line.split(','));
    const map = type === 'delivery' ? ['name', 'spec', 'proj', 'unit', 'qty', 'pin'] : ['name', 'spec', 'qty', 'price'];
    for (const r of rows) {
      const it = blankItem(type);
      map.forEach((k, i) => { if (k && r[i] != null) it[k] = String(r[i]).trim(); });
      if (it.name || it.spec) p.items.push(it);
    }
    p.items = p.items.filter((it) => it.name || it.spec || it.price);
    m.close(); done();
  };
}


export { pageDocNew, pageDocEdit, blankPayload, blankItem };
