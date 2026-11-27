/* 打印视图：报价单 / 销售合同 / 送货单三套模板 */
import { state, api, esc, fmt, qtyFmt, typeLabel, fileUrl, cnyUpper, seq } from './core.js';
import { view } from './shell.js';

/* ---------------- 打印 ---------------- */
async function pagePrint(q, my) {
  const id = q.get('id');
  const d = await api('/documents/' + id);
  if (my !== seq) return;
  const co = state.companies.find((c) => c.id === d.company_id) || state.companies[0];
  const html = sheetHtml(d, co);
  const v = view(`<div class="print-wrap">
      <div class="print-bar no-print"><button class="btn primary" id="btnDoPrint">打印 / 另存为 PDF</button>
        <button class="btn" id="btnBack">返回</button><div class="spacer"></div>
        <span class="tiny">纸张 A4 · 纵向 · 缩放 100% · 页边距「无」· 关闭页眉页脚</span></div>
      ${html}</div>`, 'docs', typeLabel(d.type) + ' / 打印');
  v.querySelector('#btnDoPrint').onclick = () => window.print();
  v.querySelector('#btnBack').onclick = () => { location.hash = '#/doc?id=' + d.id; };
}

function sheetHtml(d, co) {
  return d.type === 'quote' ? quoteSheet(d, co) : d.type === 'contract' ? contractSheet(d, co) : deliverySheet(d, co);
}

const has = (v) => String(v == null ? '' : v).trim() !== '';
const n = (v) => Number(v) || 0;
const pct = (v) => Math.min(2, Math.max(0.6, (n(v) || 100) / 100));
const dateText = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? m[1] + '/' + m[2] + '/' + m[3] : (v || '');
};
const stampSrc = (p, co) => (p.stamp && p.stamp.data) || (co && co.stamp_file_id ? fileUrl(co.stamp_file_id) : '');
const logoUrl = (co) => (co && co.logo_file_id ? fileUrl(co.logo_file_id) : '');

/* ---------------- 报价单（模板：报价单生成器） ---------------- */
function quoteSheet(d, co) {
  const p = d.payload || {};
  const cust = p.cust || {};
  const self = Object.assign({ name: co.name, phone: co.phone, fax: co.fax }, p.self || {});
  const rate = n(p.taxRate);
  const mode = p.taxMode || 'in';
  const headPrice = mode === 'in' ? `单价（含税${rate}%）` : '单价（未税）';
  const headAmount = mode === 'in' ? `合计（含税${rate}%）` : '金额（未税）';
  const list = (p.items || []).filter((it) => it && (has(it.name) || has(it.spec) || has(it.qty) || has(it.price)));

  let rows = '';
  let seqNo = 0;
  if (!list.length) {
    rows = '<tr><td></td><td class="l"></td><td class="l"></td><td></td><td class="r"></td><td class="r"></td></tr>';
  } else {
    list.forEach((it) => {
      seqNo += 1;
      const q = has(it.qty) ? esc(it.qty) : '';
      const price = has(it.price) ? fmt(it.price) : '';
      const amt = has(it.qty) && has(it.price) ? fmt(n(it.qty) * n(it.price)) : '';
      rows += `<tr><td>${seqNo}</td><td class="l">${esc(it.name)}</td><td class="l">${esc(it.spec)}</td><td>${q}</td><td class="r">${price}</td><td class="r">${amt}</td></tr>`;
    });
  }

  const metaRow = (l1, v1, l2, v2, bold2) => `<tr>
    <td class="l1">${l1}</td><td class="v1">${has(v1) ? esc(v1) : '&nbsp;'}</td>
    <td class="l2">${l2}</td><td class="v2${bold2 ? ' bold' : ''}">${has(v2) ? esc(v2) : '&nbsp;'}</td></tr>`;

  const ts = p.terms || {};
  const show = ts.show || { delivery: true, invoice: true, valid: true };
  const termLines = [];
  if (show.delivery !== false) termLines.push('交货期：' + esc(ts.delivery || ''));
  if (show.invoice !== false) termLines.push('发票：' + esc(ts.invoice || ''));
  if (show.valid !== false) termLines.push('此报价 ' + (n(p.validDays) || 1) + ' 个自然日内有效。');
  (ts.extra || []).forEach((x) => { if (String(x).trim() !== '') termLines.push(esc(x)); });
  const termHtml = termLines.map((t, i) => `<div>${i + 1}. ${t}</div>`).join('') + (p.remark ? `<div class="remark">备注：${esc(p.remark)}</div>` : '');
  const hasTerms = termHtml.trim() !== '';

  const stampOn = p.stamp && p.stamp.on;
  const sSrc = stampSrc(p, co);
  const sImg = stampOn && sSrc ? `<img class="stampImg" src="${sSrc}" alt="">` : '';
  const logo = p.showLogo !== false && logoUrl(co);

  return `<div class="a4 quote-doc" data-co="${esc(co.code)}" style="--kt:${pct(p.meta && p.meta.fsTitle)};--ki:${pct(p.meta && p.meta.fsInfo)};--km:${pct(p.meta && p.meta.fsItem)};--stSize:${Math.min(80, Math.max(20, n(p.stamp && p.stamp.size) || 42))}mm;--stDX:${n(p.stamp && p.stamp.dx)}mm;--stDY:${n(p.stamp && p.stamp.dy)}mm;--stRot:${Math.max(-60, Math.min(60, n(p.stamp && p.stamp.rot)))}deg">
    <div class="brandHead">${logo ? `<img class="logo" src="${logo}" alt="">` : `<div class="hCompany">${esc(self.name)}</div>`}</div>
    <div class="docTitle">报 价 单</div>
    <table class="meta"><tbody>
      ${metaRow('收件单位：', cust.name, '发件单位：', self.name, true)}
      ${metaRow('联 系 人：', cust.contact || cust.rep, '联系电话：', self.phone)}
      ${metaRow('电　　话：', cust.phone, '传　　真：', self.fax)}
      ${metaRow('传　　真：', cust.fax, '日　　期：', dateText(p.date || d.doc_date))}
      ${metaRow('关　　于：', cust.about, '报价单号：', d.doc_no)}
    </tbody></table>
    <div class="lead">根据您介绍的情况，贵单位需要的产品如下，请审核！</div>
    <table class="items"><colgroup><col style="width:7%"><col style="width:25%"><col style="width:28%"><col style="width:9%"><col style="width:15%"><col style="width:16%"></colgroup>
      <thead><tr><th>序号</th><th>名称</th><th>规格型号</th><th>数量</th><th>${headPrice}</th><th>${headAmount}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="terms">${termHtml || '&nbsp;'}${sImg && hasTerms ? sImg : ''}</div>
    ${p.showSign ? `<div class="sign">
      <div class="sg">报价单位（盖章）：<span class="sgLine" style="min-width:150px">${esc(self.name)}</span></div>
      <div class="sg">经办人：<span class="sgLine"></span></div>
      <div class="sg">日期：<span class="sgLine"></span></div>
    </div>` : ''}
    ${sImg && !hasTerms ? `<div class="stampFallback" style="position:absolute;left:${n(p.stamp && p.stamp.dx)}mm;bottom:${Math.max(0, 4 - n(p.stamp && p.stamp.dy))}mm;width:${Math.min(80, Math.max(20, n(p.stamp && p.stamp.size) || 42))}mm;height:${Math.min(80, Math.max(20, n(p.stamp && p.stamp.size) || 42))}mm;transform:rotate(${Math.max(-60, Math.min(60, n(p.stamp && p.stamp.rot)))}deg)"><img src="${sSrc}" style="width:100%;height:100%"></div>` : ''}
  </div>`;
}

/* ---------------- 销售合同（模板：销售合同生成器） ---------------- */
function contractSheet(d, co) {
  const p = d.payload || {};
  const cust = p.cust || {};
  const self = Object.assign({ name: co.name, addr: co.addr, rep: co.rep, phone: co.phone }, p.self || {});
  const list = (p.items || []).filter((it) => it && (has(it.name) || has(it.spec) || has(it.price)));
  const total = (p.items || []).reduce((s, it) => s + n(it.qty) * n(it.price), 0);

  let rows = '';
  if (!list.length) {
    rows = '<tr><td></td><td></td><td></td><td></td><td></td></tr>';
  } else {
    list.forEach((it) => {
      const q = has(it.qty) ? esc(it.qty) : '';
      const pr = has(it.price) ? fmt(it.price) : '';
      rows += `<tr><td class="l">${esc(it.name)}</td><td class="l">${esc(it.spec)}</td><td>${q}</td><td class="r">${pr}</td><td class="r">${has(it.qty) && has(it.price) ? fmt(n(it.qty) * n(it.price)) : ''}</td></tr>`;
    });
  }

  const terms = (p.terms || []).filter((t) => t && t.on !== false && (has(t.label) || has(t.text)));
  const logo = (p.showLogo === true || p.logoOn === true) && logoUrl(co);
  const stampOn = p.stamp && p.stamp.on;
  const sSrc = stampSrc(p, co);
  const st = p.stamp || {};
  const size = Math.min(70, Math.max(24, n(st.size) || 40));
  const signDate = p.signDate || d.doc_date;

  return `<div class="a4 contract-doc" style="--kt:${pct(p.meta && p.meta.fsTitle)};--ki:${pct(p.meta && p.meta.fsInfo)};--km:${pct(p.meta && p.meta.fsItem)}">
    ${logo ? `<div class="brandHead"><img src="${logo}" alt=""></div>` : ''}
    <div class="docTitle">产 品 销 售 合 同</div>
    <div class="noLine">合同编号：${esc(d.doc_no)}</div>
    <div class="party"><span class="pk">购货方：</span><span class="pv"><b>${esc(cust.name)}</b></span></div>
    <div class="party"><span class="pk">供货方：</span><span class="pv"><b>${esc(self.name)}</b></span></div>
    <div class="lead">产品规格型号，数量，单价，金额：</div>
    <table class="items"><thead><tr>
      <th style="width:26%">品名</th><th style="width:34%">型号</th><th style="width:10%">数量</th><th style="width:15%">单价(RMB)</th><th style="width:15%">总价(RMB)</th>
    </tr></thead><tbody>${rows}
      <tr class="totRow"><td colspan="3"></td><td class="tl">总计</td><td class="tv">￥${fmt(total)}</td></tr>
    </tbody></table>
    <div class="upper">总金额大写（RMB）：${esc(cnyUpper(total))}（含${esc(p.taxRate || 0)}%税）</div>
    <div class="remarkBox">备注：${esc(p.remark || '')}</div>
    ${terms.length ? `<div class="terms">${terms.map((t, i) => `<p>${p.termNumbered ? (i + 1) + '. ' : ''}${esc(t.label || '')}${esc(t.text || '')}</p>`).join('')}</div>` : ''}
    ${p.showSign !== false ? `<div class="signWrap">
      <table class="signT">
        <tr><td>供货方：（盖章）<b>${esc(self.name)}</b></td><td>购货方：（盖章）<b>${esc(cust.name)}</b></td></tr>
        <tr><td>地　　址：${esc(self.addr || co.addr || '')}</td><td>地　　址：${esc(cust.addr || '')}</td></tr>
        <tr><td>代 表 人：${esc(self.rep || co.rep || '')}</td><td>代 表 人：${esc(cust.rep || cust.contact || '')}</td></tr>
        <tr><td>电　　话：${esc(self.phone || co.phone || '')}</td><td>电　　话：${esc(cust.phone || '')}</td></tr>
        <tr><td>签订日期：${esc(signDate)}</td><td>签订日期：${esc(signDate)}</td></tr>
      </table>
      ${stampOn && sSrc ? `<img class="stampImg" src="${sSrc}" alt="" style="width:${size}mm;height:${size}mm;left:${n(st.dx)}mm;top:${-3 - n(st.dy)}mm;transform:rotate(${Math.max(-60, Math.min(60, n(st.rot)))}deg)">` : ''}
    </div>` : ''}
  </div>`;
}

/* ---------------- 送货单（模板：送货单生成器 A4 版） ---------------- */
function deliverySheet(d, co) {
  const p = d.payload || {};
  const self = Object.assign({ name: co.name }, p.self || {});
  const list = (p.items || []).filter((it) => it && ['code', 'name', 'spec', 'proj', 'unit', 'qty', 'pin', 'contract'].some((k) => has(it[k])));
  const perPage = 12;
  const chunks = [];
  if (!list.length) chunks.push([]);
  else for (let i = 0; i < list.length; i += perPage) chunks.push(list.slice(i, i + perPage));
  const pageCount = chunks.length;
  const totalQty = list.reduce((s, it) => s + n(it.qty), 0);

  const maker = p.maker || d.owner_name || (state.user && state.user.name) || '';
  const summary = p.summary || '';
  const titleText = `${self.name || co.name}  ${p.dtype || '送货单'}`;
  const titleLen = [...titleText].length;
  const titleSize = Math.max(10, Math.min(20, 516.3 / (titleLen + 1)));
  const infoCell = (label, val, span) => `<div class="dv-cell${span ? ' span2' : ''}"><span>${label}</span><b>${esc(val == null ? '' : val)}</b></div>`;

  return chunks.map((rows, pageIndex) => {
    const seqStart = pageIndex * perPage;
    let body = '';
    rows.forEach((it, i) => {
      body += `<tr><td>${seqStart + i + 1}</td><td>${esc(it.code)}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td><td>${esc(it.proj)}</td><td>${esc(it.unit)}</td><td class="r">${esc(it.qty)}</td><td>${esc(it.pin)}</td><td>${esc(it.contract)}</td></tr>`;
    });
    const isLast = pageIndex === pageCount - 1;
    const pageQty = rows.reduce((s, it) => s + n(it.qty), 0);
    return `<div class="a4 delivery-doc">
    <div class="dv-title" style="top:24.5mm;font-size:${titleSize.toFixed(2)}pt">${esc(self.name || co.name)}&nbsp;&nbsp;${esc(p.dtype || '送货单')}</div>
    <div class="dv-info">
      <div class="dv-row">${infoCell('制 单 人：', maker)}${infoCell('录单日期：', d.doc_date)}${infoCell('单据编号：', d.doc_no)}</div>
      <div class="dv-row">${infoCell('经 办 人：', p.agent)}${infoCell('部　　门：', p.dept)}${infoCell('发货仓库：', p.warehouse)}</div>
      <div class="dv-row">${infoCell('客　　户：', p.customer || (p.cust && p.cust.name))}${infoCell('摘　　要：', summary, true)}</div>
    </div>
    <div class="dv-body">
      <table class="dv-table">
        <colgroup>
          <col style="width:10.0mm"><col style="width:16.5mm"><col style="width:23.9mm"><col style="width:35.6mm">
          <col style="width:18.0mm"><col style="width:12.7mm"><col style="width:13.0mm"><col style="width:25.9mm"><col style="width:26.6mm">
        </colgroup>
        <thead><tr><th>序号</th><th>存货编号</th><th>存货名称</th><th>规格型号</th><th>项目编号</th><th>单位</th><th>数量</th><th>品号</th><th>合同编号</th></tr></thead>
        <tbody>${body}
          <tr class="dv-total"><td colspan="6">${isLast ? '合计' : '小计'}</td><td class="r">${qtyFmt(isLast ? totalQty : pageQty)}</td><td colspan="2"></td></tr>
        </tbody>
      </table>
      <div class="dv-sign"><span>财务</span><span>${p.shipper ? '送货人：' + esc(p.shipper) : '送货人'}</span><span>购货单位签字</span></div>
    </div>
    ${pageCount > 1 ? `<div class="dv-pageno">第 ${pageIndex + 1} 页 / 共 ${pageCount} 页</div>` : ''}
  </div>`;
  }).join('');
}

export { pagePrint, sheetHtml, quoteSheet, contractSheet, deliverySheet };
