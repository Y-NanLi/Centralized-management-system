/* 打印视图与三套版式 */
import { state, api, esc, fmt, qtyFmt, typeLabel, fileUrl, cnyUpper, seq } from './core.js';
import { view } from './shell.js';

/* ---------------- 打印 ---------------- */
async function pagePrint(q, my) {
  const id = q.get('id');
  const d = await api('/documents/' + id);
  if (my !== seq) return;
  const co = state.companies.find((c) => c.id === d.company_id) || state.companies[0];
  const html = d.type === 'quote' ? quoteSheet(d, co) : d.type === 'contract' ? contractSheet(d, co) : deliverySheet(d, co);
  const v = view(`<div class="print-wrap">
      <div class="print-bar no-print"><button class="btn primary" id="btnDoPrint">打印 / 另存为 PDF</button>
        <button class="btn" id="btnBack">返回</button><div class="spacer"></div>
        <span class="tiny">纸张 A4 · 纵向 · 缩放 100% · 页边距「无」· 关闭页眉页脚</span></div>
      ${html}</div>`, 'docs', typeLabel(d.type) + ' / 打印');
  v.querySelector('#btnDoPrint').onclick = () => window.print();
  v.querySelector('#btnBack').onclick = () => { location.hash = '#/doc?id=' + d.id; };
}

function stampImg(co, p, style) {
  if (!p.stamp || p.stamp.on === false) return '';
  const size = Number(p.stamp.size) || 40;
  if (p.stamp.data) {
    return `<img class="stamp" src="${p.stamp.data}" style="width:${size}mm;${style || ''}">`;
  }
  if (!co || !co.stamp_file_id) return '';
  return `<img class="stamp" src="${fileUrl(co.stamp_file_id)}" style="width:${size}mm;${style || ''}">`;
}

function quoteSheet(d, co) {
  const p = d.payload || {};
  const items = (p.items || []).filter((x) => x.name || x.spec || x.price);
  const self = Object.assign({ name: co.name, phone: co.phone, fax: co.fax }, p.self || {});
  if (!self.name) self.name = co.name;
  const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const rows = items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td>
      <td class="c">${esc(it.qty)}</td><td class="r">${fmt(it.price)}</td><td class="r">${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td></tr>`).join('')
    || '<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>';
  const terms = p.terms || {};
  return `<div class="a4">
    ${co.logo_file_id ? `<img src="${fileUrl(co.logo_file_id)}" style="height:12mm;margin-bottom:1mm">` : ''}
    <div class="doc-title">报 价 单</div>
    <div class="doc-no">单号：${esc(d.doc_no)}</div>
    <table class="sheet" style="margin-bottom:2mm">
      <tr><td style="width:52%">致：<b>${esc(p.cust && p.cust.name || d.customer_name || '')}</b></td><td>报价日期：${esc(d.doc_date)}</td></tr>
      <tr><td>联系人：${esc(p.cust && (p.cust.contact || p.cust.rep) || '')}</td><td>电话：${esc(p.cust && p.cust.phone || '')}</td></tr>
      <tr><td>地址：${esc(p.cust && (p.cust.addr || p.cust.about) || '')}</td><td>报价有效期：${esc(p.validDays || 7)} 天</td></tr>
    </table>
    <div class="lead">现将以下产品报价如下（人民币）：</div>
    <table class="sheet">
      <colgroup><col style="width:8%"><col style="width:30%"><col style="width:28%"><col style="width:10%"><col style="width:12%"><col style="width:12%"></colgroup>
      <thead><tr><th>序号</th><th>品名</th><th>规格型号</th><th>数量</th><th>单价（元）</th><th>金额（元）</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total">合计金额（${p.taxMode === 'ex' ? '未税' : '含 ' + (p.taxRate || 13) + '% 税'}）：￥${fmt(total)}<br>
      <span class="up">大写：${esc(cnyUpper(total))}</span></div>
    <div class="terms">
      ${terms.delivery ? `<div class="t">交货期：${esc(terms.delivery)}</div>` : ''}
      ${terms.invoice ? `<div class="t">发票：${esc(terms.invoice)}</div>` : ''}
      ${(terms.extra || []).map((t, i) => `<div class="t">${i + 1}. ${esc(t)}</div>`).join('')}
      ${p.remark ? `<div class="t">备注：${esc(p.remark)}</div>` : ''}
    </div>
    <div class="sign" style="grid-template-columns:1fr;margin-top:10mm">
      <div style="min-height:26mm;position:relative">
        <div class="line">报价单位（盖章）：<b>${esc(self.name)}</b></div>
        <div class="line">代表人：${esc(self.rep || co.rep || '')}　　电话：${esc(self.phone || co.phone || '')}</div>
        <div class="line">日期：${esc(d.doc_date)}</div>
        ${stampImg(co, p, 'right:16mm;bottom:2mm;')}
      </div>
    </div>
  </div>`;
}

function contractSheet(d, co) {
  const p = d.payload || {};
  const items = (p.items || []).filter((x) => x.name || x.spec || x.price);
  const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const self = Object.assign({ name: co.name, addr: co.addr, rep: co.rep, phone: co.phone }, p.self || {});
  if (!self.name) self.name = co.name;
  const rows = items.map((it, i) => `<tr><td>${esc(it.name)}</td><td>${esc(it.spec)}</td><td class="c">${esc(it.qty)}</td>
      <td class="r">${fmt(it.price)}</td><td class="r">${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td></tr>`).join('');
  const terms = (p.terms || []).filter((t) => t.on !== false && (t.text || t.label));
  return `<div class="a4">
    <div class="doc-title">产 品 销 售 合 同</div>
    <div class="doc-no">合同编号：${esc(d.doc_no)}</div>
    <div class="info-line">购货方：<b>${esc(p.cust && p.cust.name || d.customer_name || '')}</b></div>
    <div class="info-line">供货方：<b>${esc(self.name)}</b></div>
    <div class="lead">经双方协商一致，就下列产品达成购销条款：</div>
    <table class="sheet">
      <colgroup><col style="width:26%"><col style="width:34%"><col style="width:10%"><col style="width:15%"><col style="width:15%"></colgroup>
      <thead><tr><th>产品名称</th><th>规格型号</th><th>数量</th><th>单价（RMB）</th><th>总价（RMB）</th></tr></thead>
      <tbody>${rows}
      <tr><td colspan="3" class="r"><b>总计</b></td><td class="r"><b>${fmt(total)}</b></td><td class="r"><b>${fmt(total)}</b></td></tr></tbody>
    </table>
    <div class="total">总金额大写（RMB）：<span class="up">${esc(cnyUpper(total))}</span>（含 ${esc(p.taxRate || 0)}% 税）</div>
    <div class="terms">备注：${esc(p.remark || '')}</div>
    <div class="terms">${terms.map((t, i) => `<div class="t">${p.termNumbered ? (i + 1) + '、' : ''}${esc(t.label || '')}${esc(t.text || '')}</div>`).join('')}</div>
    <div class="sign">
      <div style="position:relative">
        <div class="line"><b>供货方：（盖章）</b>${esc(self.name)}</div>
        <div class="line">地址：${esc(self.addr || co.addr || '')}</div>
        <div class="line">代表人：${esc(self.rep || co.rep || '')}</div>
        <div class="line">电话：${esc(self.phone || co.phone || '')}</div>
        <div class="line">签订日期：${esc(p.signDate || d.doc_date)}</div>
        ${stampImg(co, p, 'left:26mm;top:4mm;')}
      </div>
      <div>
        <div class="line"><b>购货方：（盖章）</b>${esc(p.cust && p.cust.name || '')}</div>
        <div class="line">地址：${esc(p.cust && p.cust.addr || '')}</div>
        <div class="line">代表人：${esc(p.cust && p.cust.rep || '')}</div>
        <div class="line">电话：${esc(p.cust && p.cust.phone || '')}</div>
        <div class="line">签订日期：${esc(p.signDate || d.doc_date)}</div>
      </div>
    </div>
  </div>`;
}

function deliverySheet(d, co) {
  const p = d.payload || {};
  const cust = p.cust || {};
  const items = (p.items || []).filter((x) => x.name || x.spec || x.qty);
  const rows = items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td>
      <td>${esc(it.proj || '')}</td><td class="c">${esc(it.unit || '')}</td><td class="c">${esc(it.qty)}</td><td>${esc(it.pin || '')}</td></tr>`).join('')
    || '<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const contact = cust.contact || d.customer_contact || '';
  const phone = cust.phone || d.customer_phone || '';
  const addr = cust.addr || d.customer_addr || '';
  return `<div class="a4">
    ${co.logo_file_id ? `<img src="${fileUrl(co.logo_file_id)}" style="height:11mm">` : ''}
    <div style="font-size:9pt;color:#333">供货单位：${esc(co.name)}</div>
    <div class="doc-title">送 货 单</div>
    <div class="doc-no">单号：${esc(d.doc_no)}　　日期：${esc(d.doc_date)}</div>
    <div class="info-line">收货单位：<b>${esc(p.customer || d.customer_name || '')}</b>　　联系人：${esc(contact)}　　电话：${esc(phone)}</div>
    <div class="info-line">送货地址：${esc(addr)}</div>
    <table class="sheet" style="margin-top:2mm">
      <colgroup><col style="width:7%"><col style="width:26%"><col style="width:24%"><col style="width:13%"><col style="width:8%"><col style="width:10%"><col style="width:12%"></colgroup>
      <thead><tr><th>序号</th><th>品名</th><th>规格型号</th><th>项目/用途</th><th>单位</th><th>数量</th><th>备注</th></tr></thead>
      <tbody>${rows}
      <tr><td colspan="5" class="r"><b>合计数量</b></td><td class="c"><b>${qtyFmt(totalQty)}</b></td><td></td></tr></tbody>
    </table>
    <div class="delivery-note">备注：${esc(p.remark || p.summary || '')}</div>
    <div class="delivery-note" style="margin-top:8mm">送货人：________________　　收货人（签字）：________________　　收货日期：________________</div>
    <div class="delivery-note" style="margin-top:6mm;color:#666">本单为「${esc(p.dtype || '送货单')}」，一式三联：存根 / 客户 / 财务。</div>
    ${p.items && p.items[0] && p.items[0].contract ? `<div class="delivery-note">关联合同：${esc(p.items[0].contract)}</div>` : ''}
  </div>`;
}


export { pagePrint, stampImg, quoteSheet, contractSheet, deliverySheet };
