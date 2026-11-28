/* 单据新建 / 编辑：左表单 + 右实时 A4 预览 */
import { state, api, esc, fmt, today, typeLabel, toast, modal, cnyUpper, seq } from './core.js';
import { view } from './shell.js';
import { sheetHtml } from './print.js';
import { openTemplateEditor } from './template-editor.js';

/* ---------------- 单据编辑 ---------------- */
function blankPayload(type, company) {
  const base = { company: company.code, date: today(), no: '', remark: '', showLogo: true };
  const self = { name: company.name, addr: company.addr, rep: company.rep, phone: company.phone, fax: company.fax };
  if (type === 'quote') {
    return { ...base, validDays: 7, taxRate: 13, taxMode: 'in', cust: { name: '', contact: '', phone: '', fax: '', about: '' },
      self, items: [blankItem(type)], terms: { delivery: '5个工作日', invoice: '以税率13%增值税发票', extra: [] },
      showSign: false, stamp: { on: false, size: 42, dx: 0, dy: 0, rot: 0 }, cols: [7, 25, 28, 9, 15, 16], meta: { fsTitle: 100, fsInfo: 100, fsItem: 100 } };
  }
  if (type === 'contract') {
    return { ...base, showLogo: false, signDate: '', taxRate: 13, cust: { name: '', addr: '', rep: '', phone: '' }, self,
      items: [blankItem(type)],
      terms: [
        { id: 'effect', label: '', text: '本购销合同具有法律效力，签约双方必须全面履行，任何一方不得擅自变动或解除。若因不可预计因素变动或解除，应双方友好协商依法另立协议。', on: true },
        { id: 'delivery', label: '交货时间：', text: '款到发货', on: true },
        { id: 'pay', label: '付款方式：', text: '现结', on: true },
        { id: 'warranty', label: '保修期限：', text: '质保三年', on: true },
        { id: 'accept', label: '验收标准及提出异议期限：', text: '购货方收到货物后即可开箱验收，如有产品型号不符或质量问题，购货方在验货后一周内可提出异议并要求供货方更换。', on: true },
      ],
      termNumbered: false, showSign: true, stamp: { on: true, size: 40, dx: 18, dy: 0, rot: 0 }, cols: [26, 34, 10, 15, 15], meta: { fsTitle: 100, fsInfo: 100, fsItem: 100 } };
  }
  return { ...base, dtype: '送货单', customer: '', summary: '', maker: '', agent: '', dept: '', warehouse: '', shipper: '', items: [blankItem('delivery')], showSign: true, stamp: { on: false, size: 40, dx: 0, dy: 0, rot: 0 } };
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
  if (type === 'delivery' && !payload.maker) payload.maker = state.user.name || state.user.username || '';
  const ed = { id: 0, type, payload, status: 'draft', doc_date: today(), doc_no: noPreview.doc_no, title: '', remark: '', company_id: company.id };
  if (!q.get('classic')) { openTemplateEditor(ed); return; }
  openEditor(ed);
}

async function pageDocEdit(q, my) {
  const id = q.get('id');
  const d = await api('/documents/' + id);
  if (my !== seq) return;
  const w = d.warehouse_status || 'none';
  if (d.type === 'delivery') {
    if (w === 'pending') {
      toast(state.user.role === 'warehouse' ? '请先在仓库打单页接收这张送货单' : '已提交仓库，接收前只能撤回，不能编辑', true);
      location.hash = '#/doc?id=' + d.id;
      return;
    }
    if ((w === 'received' || w === 'done') && state.user.role !== 'warehouse') {
      toast('仓库流程中的送货单只能由仓库账号编辑', true);
      location.hash = '#/doc?id=' + d.id;
      return;
    }
  }
  const ed = {
    id: d.id, type: d.type, payload: d.payload, status: d.status, doc_date: d.doc_date,
    doc_no: d.doc_no, title: d.title, remark: d.remark, company_id: d.company_id, owner_name: d.owner_name,
  };
  if (!q.get('classic')) { openTemplateEditor(ed, { autoPrint: q.get('print') === '1' }); return; }
  openEditor(ed);
}

function openEditor(ed) {
  const type = ed.type;
  const p = ed.payload;
  const isQuote = type === 'quote';
  const isContract = type === 'contract';
  const isDelivery = type === 'delivery';
  const company = state.companies.find((c) => c.id === ed.company_id) || state.companies[0];
  ed.company_id = company.id;

  // 兼容旧数据
  if (!p.cust) p.cust = { name: '', contact: '', phone: '', addr: '', rep: '', fax: '', about: '' };
  if (!Array.isArray(p.items) || !p.items.length) p.items = [blankItem(type)];
  if (!p.self) p.self = { name: company.name, addr: company.addr, rep: company.rep, phone: company.phone, fax: company.fax };
  if (!p.self.name) p.self.name = company.name;
  if (!p.stamp) p.stamp = { on: isContract, size: isContract ? 40 : 42, dx: 0, dy: 0, rot: 0 };
  if (p.showLogo === undefined) p.showLogo = !isContract;
  if (isDelivery) {
    ['maker', 'agent', 'dept', 'warehouse', 'shipper', 'summary'].forEach((k) => { if (p[k] == null) p[k] = ''; });
    if (!p.maker) p.maker = ed.owner_name || state.user.name || state.user.username || '';
  }
  if (type === 'contract' && !Array.isArray(p.terms)) p.terms = blankPayload('contract', company).terms;
  if (type === 'quote' && (!p.terms || Array.isArray(p.terms))) p.terms = { delivery: '', invoice: '', extra: [] };
  if (!p.terms) p.terms = { delivery: '', invoice: '', extra: [] };

  const itemCols = isDelivery
    ? [['code', '存货编号'], ['name', '存货名称'], ['spec', '规格型号'], ['proj', '项目编号'], ['unit', '单位'], ['qty', '数量'], ['pin', '品号'], ['contract', '合同编号']]
    : [['name', '品名'], ['spec', '规格型号'], ['qty', '数量'], ['price', '单价']];

  const itemsHtml = () => p.items.map((it, i) => `<tr data-row="${i}">
      <td class="c" style="width:30px">${i + 1}</td>
      ${itemCols.map(([k, label]) => `<td><input data-idx="${i}" data-f="${k}" value="${esc(it[k] == null ? '' : it[k])}" placeholder="${label}"></td>`).join('')}
      ${isDelivery ? '' : `<td class="amt">￥${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>`}
      <td style="width:26px"><button class="del" data-del="${i}" title="删除本行">×</button></td>
    </tr>`).join('');

  const statusOpts = state.meta.statuses[type].map((s) => `<option value="${s.key}" ${s.key === ed.status ? 'selected' : ''}>${s.label}</option>`).join('');

  const coTabs = state.companies.map((c) => `<button type="button" class="co-tab ${c.id === ed.company_id ? 'on' : ''}" data-co="${c.id}">${esc(c.short_name || c.name)}</button>`).join('');
  const coLabel = (c) => esc(c.short_name || c.name);

  const termsHtml = () => isContract && Array.isArray(p.terms)
    ? p.terms.map((t, i) => `<div class="term-row" data-term="${i}">
        <input type="checkbox" data-tf="on" ${t.on !== false ? 'checked' : ''}>
        <input class="input" data-tf="label" value="${esc(t.label || '')}" placeholder="条目标签，可空">
        <input class="input" data-tf="text" value="${esc(t.text || '')}" placeholder="条款内容">
        <button class="del" data-tdel="${i}" type="button" style="border:0;background:none;cursor:pointer;color:#b9c3d3">×</button>
      </div>`).join('')
    : `<div class="grid2">
        <div class="field"><label>交货期</label><input class="input" data-tk="delivery" value="${esc((p.terms && p.terms.delivery) || '')}"></div>
        <div class="field"><label>发票</label><input class="input" data-tk="invoice" value="${esc((p.terms && p.terms.invoice) || '')}"></div>
      </div>
      <div class="field"><label>其他条款（每行一条）</label><textarea class="input" rows="2" data-tk="extra">${esc(((p.terms && p.terms.extra) || []).join('\n'))}</textarea></div>`;

  const custName = isDelivery ? (p.customer || p.cust.name || '') : (p.cust.name || '');
  const custPerson = p.cust.contact || p.cust.rep || '';

  const layoutControls = [
    `<label class="check-line"><input type="checkbox" id="showLogo" ${p.showLogo !== false ? 'checked' : ''}> 页面显示公司 Logo</label>`,
    `<label class="check-line"><input type="checkbox" id="stampOn" ${p.stamp.on !== false ? 'checked' : ''}> 显示电子章（公司章）</label>`,
    `<label class="check-line"><input type="checkbox" id="showSign" ${p.showSign !== false ? 'checked' : ''}> 显示签章栏</label>`,
  ].join('');

  const v = view(`<div class="doc-editor-page">
    <div class="doc-topbar">
      <div class="dt-title">${typeLabel(type)}</div>
      <span class="dt-chip" id="noChip">${esc(ed.doc_no)}</span>
      <span class="dt-chip" id="coChip">${coLabel(company)}</span>
      <span class="dt-spacer"></span>
      ${ed.id ? '<button class="btn sm" id="btnDetail" type="button">详情</button>' : ''}
      <button class="btn sm" id="btnNew" type="button">新建</button>
      <button class="btn sm" id="btnSave" type="button">保存</button>
      <button class="btn sm" id="btnSavePrint" type="button">保存并打印</button>
      <button class="btn sm primary" id="btnPrintNow" type="button">打印 / 导出 PDF</button>
      <button class="btn sm" id="btnCancel" type="button">取消</button>
    </div>

    <div class="doc-workbench">
      <section class="doc-form-pane">
        <div class="doc-form-body">
          <div class="doc-section">
            <div class="doc-sec-head"><h3>单据信息</h3><span>编号、日期、状态与税率</span></div>
            <div class="grid2">
              <div class="field span2"><label>单据编号</label>
                <div class="input-with-btn"><input class="input mono" id="noInput" value="${esc(ed.doc_no)}"><button class="btn sm" id="btnRegen" type="button">重新生成</button></div>
              </div>
              <div class="field"><label>单据日期</label><input class="input" type="date" id="dateInput" value="${esc(ed.doc_date)}"></div>
              <div class="field"><label>状态</label><select class="input" id="statusSel">${statusOpts}</select></div>
              ${isDelivery ? `
                <div class="field"><label>单据类型</label><select class="input" id="dtypeSel">${['送货单', '样品单', '提前送货单'].map((x) => `<option ${p.dtype === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
                <div class="field"><label>关联合同号</label><input class="input" id="contractNo" value="${esc((p.items[0] && p.items[0].contract) || '')}" placeholder="可空"></div>` : `
                <div class="field"><label>税率</label><select class="input" id="taxSel">${[13, 9, 6, 3, 0].map((x) => `<option value="${x}" ${Number(p.taxRate) === x ? 'selected' : ''}>${x}%</option>`).join('')}</select></div>
                ${isQuote ? `<div class="field"><label>计税方式</label><select class="input" id="taxModeSel">
                  <option value="in" ${p.taxMode !== 'ex' ? 'selected' : ''}>含税价（税额内含）</option>
                  <option value="ex" ${p.taxMode === 'ex' ? 'selected' : ''}>未税价（另加税）</option>
                </select></div><div class="field"><label>报价有效期（天）</label><input class="input" type="number" id="validDays" value="${esc(p.validDays || 7)}"></div>` : `<div class="field"><label>签订日期</label><input class="input" type="date" id="signDate" value="${esc(p.signDate || '')}"></div>`}`}
            </div>
          </div>

          <div class="doc-section">
            <div class="doc-sec-head"><h3>${isDelivery ? '收货方' : '购货方'}</h3><span>输入名称可从客户档案带出地址、联系人与电话</span></div>
            <div class="grid2">
              <div class="field span2"><label>${isDelivery ? '收货单位' : '单位名称'}</label>
                <input class="input" id="custName" list="custList" value="${esc(custName)}" placeholder="输入或从客户档案选择">
                <datalist id="custList">${state.customers.map((c) => `<option value="${esc(c.name)}">${esc([c.contact, c.phone].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
              </div>
              <div class="field span2"><label>地址</label><input class="input" id="custAddr" value="${esc(p.cust.addr || '')}" placeholder="选填"></div>
              <div class="field"><label>联系人 / 代表人</label><input class="input" id="custContact" value="${esc(custPerson)}" placeholder="选填"></div>
              <div class="field"><label>电话</label><input class="input" id="custPhone" value="${esc(p.cust.phone || '')}" placeholder="选填"></div>
              ${isQuote ? `<div class="field"><label>传真</label><input class="input" id="custFax" value="${esc(p.cust.fax || '')}" placeholder="选填"></div>
              <div class="field"><label>关于</label><input class="input" id="custAbout" value="${esc(p.cust.about || '')}" placeholder="选填"></div>` : ''}
            </div>
          </div>

          <div class="doc-section">
            <div class="doc-sec-head"><h3>供货方</h3><span>切换主体会换单位名称、电子章与编号前缀</span></div>
            <div class="co-tabs" id="coTabs">${coTabs}</div>
            <div class="grid2">
              <div class="field span2"><label>单位名称</label><input class="input" id="selfName" data-self="name" value="${esc(p.self.name || '')}"></div>
              <div class="field span2"><label>地址</label><input class="input" id="selfAddr" data-self="addr" value="${esc(p.self.addr || '')}" placeholder="选填"></div>
              <div class="field"><label>代表人</label><input class="input" id="selfRep" data-self="rep" value="${esc(p.self.rep || '')}" placeholder="选填"></div>
              <div class="field"><label>电话</label><input class="input" id="selfPhone" data-self="phone" value="${esc(p.self.phone || '')}" placeholder="选填"></div>
              <div class="field"><label>传真</label><input class="input" id="selfFax" data-self="fax" value="${esc(p.self.fax || '')}" placeholder="选填"></div>
            </div>
          </div>

          ${isDelivery ? `<div class="doc-section">
            <div class="doc-sec-head"><h3>送货信息</h3><span>制单人、经办人、仓库与送货人</span></div>
            <div class="grid2">
              <div class="field"><label>制单人</label><input class="input" data-dv="maker" value="${esc(p.maker || '')}"></div>
              <div class="field"><label>经办人</label><input class="input" data-dv="agent" value="${esc(p.agent || '')}"></div>
              <div class="field"><label>部门</label><input class="input" data-dv="dept" value="${esc(p.dept || '')}"></div>
              <div class="field"><label>发货仓库</label><input class="input" data-dv="warehouse" value="${esc(p.warehouse || '')}"></div>
              <div class="field"><label>送货人</label><input class="input" data-dv="shipper" value="${esc(p.shipper || '')}"></div>
              <div class="field"><label>摘要</label><input class="input" data-dv="summary" value="${esc(p.summary || '')}"></div>
            </div>
          </div>` : ''}

          <div class="doc-section">
            <div class="doc-sec-head"><h3>明细与金额</h3><span>规格输入可从货品库带出品名与单价；填齐后自动入库</span></div>
            <div class="databar">
              <button class="btn sm" id="btnAddRow" type="button">+ 加一行</button>
              <button class="btn sm" id="btnPaste" type="button">从 Excel 粘贴</button>
              <span class="tiny">支持 Tab / 逗号分隔</span>
              <div class="spacer"></div>
              ${isDelivery ? '' : `<span class="tiny">合计 <b id="totalText" style="color:#1e4b8f;font-size:16px">￥0.00</b></span>`}
            </div>
            <div class="items-table-wrap">
              <table class="items-table"><thead><tr><th style="width:30px">#</th>
                ${itemCols.map(([k, l]) => `<th>${l}</th>`).join('')}
                ${isDelivery ? '' : '<th style="width:88px">金额</th>'}<th style="width:26px"></th></tr></thead>
                <tbody id="itemBody">${itemsHtml()}</tbody></table>
            </div>
            ${isDelivery ? '' : `<div class="total-line"><span class="upper" id="upperText">${esc(cnyUpper(0))}</span><span>合计 <span class="sum" id="sumText">￥0.00</span></span></div>`}
            <div class="field" style="margin-top:12px;margin-bottom:0"><label>备注</label><textarea class="input" id="remark" rows="2">${esc(p.remark || ed.remark || '')}</textarea></div>
          </div>

          ${isDelivery ? '' : `<div class="doc-section">
            <div class="doc-sec-head"><h3>条款 / 版式</h3><span>${isContract ? '勾选需要打印的条款' : '报价条款与版式选项'}</span></div>
            <div id="termsBox">${termsHtml()}</div>
            ${isContract ? '<button class="btn sm" id="btnAddTerm" type="button" style="margin-top:6px">+ 加一条条款</button>' : ''}
            ${layoutControls ? `<div class="check-group">${layoutControls}</div>` : ''}
            <datalist id="prodList">${state.products.map((x) => `<option value="${esc(x.spec)}">${esc(x.name)}${x.price ? ' ￥' + x.price : ''}</option>`).join('')}</datalist>
          </div>`}

          ${isDelivery ? `<datalist id="prodList">${state.products.map((x) => `<option value="${esc(x.spec)}">${esc(x.name)}${x.price ? ' ￥' + x.price : ''}</option>`).join('')}</datalist>` : ''}
        </div>
      </section>

      <section class="doc-preview-pane">
        <div class="preview-bar">
          <span>实时预览 · A4 纵向</span>
          <div class="preview-zoom">
            <button class="pz-btn" id="zoomOut" type="button">−</button>
            <span id="zoomLabel">68%</span>
            <button class="pz-btn" id="zoomIn" type="button">+</button>
            <button class="pz-btn pz-fit" id="zoomFit" type="button">适应</button>
          </div>
        </div>
        <div class="preview-scroll" id="previewScroll">
          <div class="preview-sizer" id="previewSizer">
            <div class="preview-stage" id="previewStage"></div>
          </div>
        </div>
      </section>
    </div>
  </div>`, 'docs', (ed.id ? '编辑 / ' : '新建 / ') + typeLabel(type));

  /* ---------- 实时预览 ---------- */
  const previewScroll = v.querySelector('#previewScroll');
  const previewSizer = v.querySelector('#previewSizer');
  const previewStage = v.querySelector('#previewStage');
  const zoomLabel = v.querySelector('#zoomLabel');
  let zoom = 0.68;
  let previewTimer = 0;

  const previewDoc = () => ({
    type,
    doc_no: ed.doc_no,
    doc_date: ed.doc_date,
    customer_name: p.cust.name || p.customer || '',
    payload: p,
  });
  const currentCompany = () => state.companies.find((c) => c.id === ed.company_id) || state.companies[0];

  const applyZoom = () => {
    const w = previewStage.offsetWidth || 794;
    const h = previewStage.offsetHeight || 1123;
    previewStage.style.transform = `scale(${zoom})`;
    previewSizer.style.width = Math.round(w * zoom) + 'px';
    previewSizer.style.height = Math.round(h * zoom) + 'px';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
  };

  const renderPreview = () => {
    previewStage.innerHTML = sheetHtml(previewDoc(), currentCompany());
    requestAnimationFrame(applyZoom);
  };

  const schedulePreview = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 80);
  };

  const fitPreview = () => {
    const avail = previewScroll.clientWidth - 36;
    zoom = Math.min(1, Math.max(0.35, avail / 794));
    applyZoom();
  };

  /* ---------- 交互 ---------- */
  const recalc = () => {
    if (isDelivery) return;
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
      inp.oninput = () => {
        p.items[Number(inp.dataset.idx)][inp.dataset.f] = inp.value;
        recalc();
        schedulePreview();
      };
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
            schedulePreview();
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
  const refreshRows = () => {
    v.querySelector('#itemBody').innerHTML = itemsHtml();
    bindRows();
    recalc();
    schedulePreview();
  };
  bindRows();
  recalc();

  v.querySelector('#btnAddRow').onclick = () => { p.items.push(blankItem(type)); refreshRows(); };
  v.querySelector('#btnPaste').onclick = () => openPaste(p, type, () => refreshRows());

  // 购货方
  const custNameInput = v.querySelector('#custName');
  custNameInput.oninput = (e) => {
    p.cust.name = e.target.value;
    if (isDelivery) p.customer = e.target.value;
  };
  custNameInput.onchange = (e) => {
    const name = e.target.value.trim();
    p.cust.name = name;
    if (isDelivery) p.customer = name;
    const hit = state.customers.find((x) => x.name === name);
    if (hit) {
      if (!p.cust.contact && (hit.contact || hit.rep)) { p.cust.contact = hit.contact || hit.rep; v.querySelector('#custContact').value = p.cust.contact; }
      if (!p.cust.phone && hit.phone) { p.cust.phone = hit.phone; v.querySelector('#custPhone').value = hit.phone; }
      if (!p.cust.addr && hit.addr) { p.cust.addr = hit.addr; v.querySelector('#custAddr').value = hit.addr; }
    }
    schedulePreview();
  };
  v.querySelector('#custContact').oninput = (e) => { p.cust.contact = e.target.value; p.cust.rep = e.target.value; };
  v.querySelector('#custPhone').oninput = (e) => { p.cust.phone = e.target.value; };
  v.querySelector('#custAddr').oninput = (e) => { p.cust.addr = e.target.value; };
  if (v.querySelector('#custFax')) v.querySelector('#custFax').oninput = (e) => { p.cust.fax = e.target.value; };
  if (v.querySelector('#custAbout')) v.querySelector('#custAbout').oninput = (e) => { p.cust.about = e.target.value; };

  // 供货方
  v.querySelectorAll('[data-self]').forEach((inp) => {
    inp.oninput = () => { p.self[inp.dataset.self] = inp.value; };
  });
  v.querySelectorAll('[data-dv]').forEach((inp) => {
    inp.oninput = () => { p[inp.dataset.dv] = inp.value; };
  });

  // 单据信息
  v.querySelector('#remark').oninput = (e) => { p.remark = e.target.value; };
  v.querySelector('#dateInput').onchange = (e) => { ed.doc_date = e.target.value; p.date = e.target.value; };
  v.querySelector('#noInput').oninput = (e) => {
    ed.doc_no = e.target.value; p.no = e.target.value;
    v.querySelector('#noChip').textContent = e.target.value || '未编号';
  };
  v.querySelector('#statusSel').onchange = (e) => { ed.status = e.target.value; };
  if (v.querySelector('#dtypeSel')) v.querySelector('#dtypeSel').onchange = (e) => { p.dtype = e.target.value; };
  if (v.querySelector('#taxSel')) v.querySelector('#taxSel').onchange = (e) => { p.taxRate = Number(e.target.value); };
  if (v.querySelector('#taxModeSel')) v.querySelector('#taxModeSel').onchange = (e) => { p.taxMode = e.target.value; };
  if (v.querySelector('#validDays')) v.querySelector('#validDays').oninput = (e) => { p.validDays = Number(e.target.value) || 0; };
  if (v.querySelector('#signDate')) v.querySelector('#signDate').onchange = (e) => { p.signDate = e.target.value; };
  if (v.querySelector('#contractNo')) v.querySelector('#contractNo').oninput = (e) => { p.items.forEach((it) => { it.contract = e.target.value; }); };

  // 主体切换
  const regenerateNo = async () => {
    const btn = v.querySelector('#btnRegen');
    btn.disabled = true;
    try {
      const r = await api(`/number/next?type=${type}&company_id=${ed.company_id}`);
      ed.doc_no = r.doc_no; p.no = r.doc_no;
      v.querySelector('#noInput').value = r.doc_no;
      v.querySelector('#noChip').textContent = r.doc_no;
      toast('编号已重新生成：' + r.doc_no);
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  };

  v.querySelector('#btnRegen').onclick = regenerateNo;
  v.querySelectorAll('[data-co]').forEach((b) => b.onclick = async () => {
    const co = state.companies.find((c) => c.id === Number(b.dataset.co));
    if (!co || co.id === ed.company_id) return;
    ed.company_id = co.id;
    p.company = co.code;
    p.self = { name: co.name, addr: co.addr, rep: co.rep, phone: co.phone, fax: co.fax };
    v.querySelector('#selfName').value = p.self.name;
    v.querySelector('#selfAddr').value = p.self.addr || '';
    v.querySelector('#selfRep').value = p.self.rep || '';
    v.querySelector('#selfPhone').value = p.self.phone || '';
    v.querySelector('#selfFax').value = p.self.fax || '';
    v.querySelector('#coChip').textContent = co.short_name || co.name;
    v.querySelectorAll('[data-co]').forEach((x) => x.classList.toggle('on', Number(x.dataset.co) === co.id));
    if (!ed.id) await regenerateNo();
    renderPreview();
  });

  // 条款
  const bindTerms = () => {
    v.querySelectorAll('[data-tf]').forEach((inp) => {
      const i = Number(inp.closest('[data-term]').dataset.term);
      inp.oninput = inp.onchange = () => {
        if (inp.dataset.tf === 'on') p.terms[i].on = inp.checked;
        else p.terms[i][inp.dataset.tf] = inp.value;
        schedulePreview();
      };
    });
    v.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = (e) => {
      e.preventDefault();
      p.terms.splice(Number(b.dataset.tdel), 1);
      drawTerms();
    });
  };
  const drawTerms = () => {
    if (!isContract) return;
    v.querySelector('#termsBox').innerHTML = termsHtml();
    bindTerms();
    schedulePreview();
  };
  bindTerms();
  if (v.querySelector('#btnAddTerm')) v.querySelector('#btnAddTerm').onclick = () => {
    p.terms.push({ id: 'custom' + Date.now(), label: '', text: '', on: true });
    drawTerms();
  };
  v.querySelectorAll('[data-tk]').forEach((inp) => {
    inp.oninput = () => {
      const k = inp.dataset.tk;
      if (k === 'extra') p.terms.extra = inp.value.split('\n').filter(Boolean);
      else { p.terms = p.terms || {}; p.terms[k] = inp.value; }
    };
  });

  // 版式 / 印章
  if (v.querySelector('#showLogo')) v.querySelector('#showLogo').onchange = (e) => { p.showLogo = e.target.checked; renderPreview(); };
  if (v.querySelector('#stampOn')) v.querySelector('#stampOn').onchange = (e) => { p.stamp.on = e.target.checked; renderPreview(); };
  if (v.querySelector('#showSign')) v.querySelector('#showSign').onchange = (e) => { p.showSign = e.target.checked; renderPreview(); };

  // 任何输入都刷新预览
  v.querySelector('.doc-form-body').addEventListener('input', schedulePreview);
  v.querySelector('.doc-form-body').addEventListener('change', schedulePreview);

  // 缩放
  v.querySelector('#zoomOut').onclick = () => { zoom = Math.max(0.35, zoom - 0.05); applyZoom(); };
  v.querySelector('#zoomIn').onclick = () => { zoom = Math.min(1.2, zoom + 0.05); applyZoom(); };
  v.querySelector('#zoomFit').onclick = fitPreview;

  const save = async (thenPrint) => {
    clearTimeout(previewTimer);
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
  v.querySelector('#btnPrintNow').onclick = () => window.print();
  v.querySelector('#btnNew').onclick = () => { location.hash = '#/doc/new?type=' + type; };
  if (v.querySelector('#btnDetail')) v.querySelector('#btnDetail').onclick = () => { location.hash = '#/doc?id=' + ed.id; };
  v.querySelector('#btnCancel').onclick = () => history.length > 1 ? history.back() : (location.hash = '#/docs');

  renderPreview();
  requestAnimationFrame(() => fitPreview());
}

function openPaste(p, type, done) {
  const hint = type === 'delivery' ? '存货编号、存货名称、规格型号、项目编号、单位、数量、品号、合同编号' : '品名、规格、数量、单价';
  const sample = type === 'delivery' ? 'IPC-610\t工控机\tIPC-610 / i7\tP001\t台\t2\tIPC610\tHT001' : '工控机\tIPC-610\t2\t5200';
  const m = modal({
    title: '从 Excel 粘贴明细',
    wide: true,
    body: `<p class="tiny">直接从 Excel 选中几行粘贴（列顺序：${hint}），Tab 或逗号分隔。</p>
      <textarea class="input" id="pasteBox" rows="10" placeholder="${sample}"></textarea>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="pasteOk">导入</button>',
  });
  m.root.querySelector('#pasteOk').onclick = () => {
    const text = m.root.querySelector('#pasteBox').value.trim();
    if (!text) return;
    const rows = text.split(/\r?\n/).filter(Boolean).map((line) => line.includes('\t') ? line.split('\t') : line.split(','));
    const map = type === 'delivery' ? ['code', 'name', 'spec', 'proj', 'unit', 'qty', 'pin', 'contract'] : ['name', 'spec', 'qty', 'price'];
    for (const r of rows) {
      const it = blankItem(type);
      map.forEach((k, i) => { if (k && r[i] != null) it[k] = String(r[i]).trim(); });
      if (it.name || it.spec) p.items.push(it);
    }
    p.items = p.items.filter((it) => type === 'delivery' ? (it.code || it.name || it.spec || it.proj) : (it.name || it.spec || it.price));
    m.close(); done();
  };
}

export { pageDocNew, pageDocEdit, blankPayload, blankItem };
