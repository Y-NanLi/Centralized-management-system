/* 系统设置 */
import { state, api, esc, today, roleLabel, fileUrl, toast, cnyUpper, seq, rerender } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 设置 ---------------- */
async function pageSettings(q, my) {
  const v = view(`<div class="page-head"><div><h2>系统设置</h2><div class="desc">公司主体与电子章、账号说明、旧数据导入</div></div></div>
    <div class="card"><h3>公司主体</h3><div class="card-sub">报价单、合同、送货单可分别选择主体；编号前缀取主体代码</div>
      <div id="coBox" class="grid3"></div></div>

    <div class="card" style="margin-top:14px"><h3>从旧工具导入数据</h3>
      <div class="card-sub">支持三个单文件工具「导出全部 / 导出备份」的 JSON：报价单（ac-quote-all）、合同（sale-contract）、送货单（records + products）。导入的客户、货品、单据归当前登录账号。</div>
      <div class="drop" id="impBox">点击选择备份 JSON 文件</div>
      <input type="file" id="impInput" accept=".json,application/json" hidden>
      <div id="impResult" class="tiny" style="margin-top:10px"></div>
    </div>

    <div class="card" style="margin-top:14px"><h3>账号</h3>
      <div class="kv"><div><div class="k">当前账号</div><div class="v">${esc(state.user.name || state.user.username)}（${esc(state.user.username)} · ${esc(roleLabel(state.user.role))}）</div></div></div>
      <div class="tiny" style="margin-top:10px;line-height:1.9">系统已改为免密码登录，凭用户名识别身份。用户名支持中文、字母、数字、下划线、点或短横；新用户可在登录页自助注册。<br>
      普通账号只能看到自己的工作台、客户、货品、单据和文件；管理员可查看全部成员，并在工作台按成员切换。<br>
      v1.8 新增“仓库”角色：业务员可把送货单交仓库，仓库接收后编辑、打印、完成；删除的单据和文件进入回收站保留 30 天，到期自动永久删除。<br>
      v1.8.1 送货单默认三联纸 214.7×139.8mm，货物明细默认 7 列：序号、存货编号、存货名称、规格型号、单位、数量、项目编号；仓库账号只显示仓库打单，业务员隐藏系统设置和用户管理，接收/编辑/完成仅仓库账号操作。<br>
      v1.8.2 增加 GitHub tag 自动构建 Docker 镜像和飞牛 Watchtower 自动更新配置。<br>
      v1.8.3 仓库可直接打印待接收送货单，打印时自动接收为“处理中”，编辑与完成权限仍仅限仓库账号。<br>
      v1.8.4 仓库可在仓库打单页直接手动新建送货单，无需接收业务员单据；保存后进入“处理中”，但仍不能新建报价单或合同。<br>
      v1.8.5 仓库打单默认进入“全部”页签，“全部”放在最左侧。<br>
      v1.8.6 系统品牌名称改为“CRM系统”。<br>
      v1.9.0 单据编号统一为“公司代码+日期+三位流水”（如 JXT-20261128001），报价、合同、送货单共用当天流水；转换单据继承原编号。<br>
      v1.9.1 侧栏品牌图标改为红色 AC 字母标识，CRM系统下方显示版本号；修复客户档案列表表头与数据错位。<br>
      v1.9.2 货品库改为全系统共享，只能修改或删除自己创建的货品；修正表头与金额右对齐。<br>
      v1.9.3 单据详情显示完整业务链，报价单、合同、送货单三个节点不再互相消失。<br>
      v1.9.4 送货单制单人随仓库流转自动变化：未交仓库显示本人，交仓库后显示“仓库”，仓库接收后显示接收人姓名；经办人显示提交人。<br>
      v1.9.5 修复客户档案“累计金额”：同一订单的报价、合同不再重复相加，每个订单只计一次，优先取合同金额。<br>
      v1.9.6 客户档案新增多行备注和客户附件，可记录付款方式、账期、成本加点，并上传付款资料、客户信息、合同扫描件。<br>
      v1.9.7 增加窄窗口与手机端适配：顶部横向导航、表格横向滑动不挤压；单据编辑器手机端上下排列，录入和预览都可正常使用。<br>
      v1.9.8 转合同/转送货单时，如果已有下游单据会提示“覆盖原单 / 另存新单”；另存自动递增编号并跳过已占用号码，详情链路改为树状结构。<br>
      v1.9.9 单据链路改为横向流程图：报价单、销售合同、送货单用圆角卡片和箭头展示，多合同、多送货单按分支排列；手机端使用紧凑卡片。<br>
      v1.9.10 报价单直转的送货单统一放到第三列；报价单转送货单时检查链路已有送货单并提示，继续生成自动使用未占用编号。<br>
      v1.10.0 单据中心按业务链分组，同一报价及合同、送货单折叠在“关联单据”标题下；组内按报价 → 合同 → 送货单排列，“关联”列显示直接上下游关系。<br>
      v1.10.1 修复单据中心每页只显示 5 张的问题，恢复为每页 20 张，关联单据通常能整组放在同一页。<br>
      v1.11.0 单据中心单击查看详情、双击进入编辑；详情流程图双击报价单或销售合同卡片也进入编辑。<br>
      v1.12.0 已生成下游单据的上游单据锁定客户、明细、金额等关键字段，只保留状态、备注和附件；列表按业务链分页，同一链不跨页；新增日期、客户和待转合同/待送货等快捷筛选。<br>
      v1.13.0 单据编辑器增加本地草稿自动暂存与恢复，按账号和单据隔离；崩溃或误关后重新打开可恢复，保存成功自动清除，14 天过期。<br>
      v1.14.0 回收站单据增加“查看”，永久删除前可只读核对客户、金额、明细、备注、附件、删除人和剩余保留天数。</div>
    </div>

    <div class="card" style="margin-top:14px"><h3>数据备份</h3>
      <div class="card-sub">导出客户、货品、单据与公司主体为 JSON；普通账号只导出本人数据，管理员默认导出全部成员。上传的文件实体在服务器 data/files 目录，请一并复制备份。</div>
      <button class="btn" id="btnExportData">导出数据 JSON</button>
    </div>

    <div class="card" style="margin-top:14px"><h3>关于</h3>
      <div class="tiny" style="line-height:2">CRM系统 v1.14.0 · Node.js 22 + SQLite · 数据目录 data/（app.db 与 files/）<br>
      建议每天备份 data 目录；部署到 NAS 用 Docker 挂载 /app/data 即可。</div>
    </div>`, 'settings', '系统设置');

  const coBox = v.querySelector('#coBox');
  coBox.innerHTML = state.companies.map((c) => `<div class="card" style="box-shadow:none">
      <div style="display:flex;gap:12px;align-items:center">
        <div style="width:46px;height:46px;border-radius:9px;background:#eef4ff;display:flex;align-items:center;justify-content:center;font-weight:700;color:#1e4b8f">${esc(c.code.toUpperCase())}</div>
        <div style="flex:1"><b>${esc(c.short_name || c.name)}</b><div class="tiny">${esc(c.name)}</div></div>
      </div>
      <div class="field" style="margin-top:12px"><label>公司全称</label><input class="input" data-co="${c.id}" data-k="name" value="${esc(c.name)}"></div>
      <div class="grid2">
        <div class="field"><label>简称</label><input class="input" data-co="${c.id}" data-k="short_name" value="${esc(c.short_name)}"></div>
        <div class="field"><label>代表人</label><input class="input" data-co="${c.id}" data-k="rep" value="${esc(c.rep)}"></div>
        <div class="field"><label>电话</label><input class="input" data-co="${c.id}" data-k="phone" value="${esc(c.phone)}"></div>
        <div class="field"><label>传真</label><input class="input" data-co="${c.id}" data-k="fax" value="${esc(c.fax)}"></div>
        <div class="field" style="grid-column:1/-1"><label>地址</label><input class="input" data-co="${c.id}" data-k="addr" value="${esc(c.addr)}"></div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:4px">
        <div style="flex:1"><div class="tiny">Logo</div>${c.logo_file_id ? `<img src="${fileUrl(c.logo_file_id)}" style="height:34px;margin-top:4px">` : '<div class="tiny">未上传</div>'}</div>
        <div style="flex:1"><div class="tiny">电子章</div>${c.stamp_file_id ? `<img src="${fileUrl(c.stamp_file_id)}" style="height:44px;margin-top:4px">` : '<div class="tiny">未上传</div>'}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn sm" data-up="${c.id}" data-kind="logo">上传 Logo</button>
        <button class="btn sm" data-up="${c.id}" data-kind="stamp">上传电子章</button>
        <button class="btn sm primary" data-save="${c.id}">保存</button>
      </div>
    </div>`).join('');

  coBox.querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
    const id = Number(b.dataset.save);
    const body = {};
    coBox.querySelectorAll(`[data-co="${id}"]`).forEach((inp) => { body[inp.dataset.k] = inp.value; });
    try { await api('/companies/' + id, { method: 'PUT', body }); state.companies = await api('/companies'); toast('已保存'); rerender(); } catch (e) { toast(e.message, true); }
  });
  coBox.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    document.body.appendChild(input);
    input.onchange = async () => {
      if (!input.files[0]) return;
      const fd = new FormData(); fd.append('file', input.files[0]);
      try { await api(`/companies/${b.dataset.up}/${b.dataset.kind}`, { method: 'POST', body: fd }); state.companies = await api('/companies'); toast('已上传'); rerender(); } catch (e) { toast(e.message, true); }
      input.remove();
    };
    input.click();
  });

  const impInput = v.querySelector('#impInput');
  v.querySelector('#impBox').onclick = () => impInput.click();
  impInput.onchange = async () => {
    if (!impInput.files[0]) return;
    const fd = new FormData(); fd.append('file', impInput.files[0]);
    const box = v.querySelector('#impResult');
    box.textContent = '正在导入…';
    try {
      const r = await api('/import/legacy', { method: 'POST', body: fd });
      box.innerHTML = `<b>导入完成</b>：客户 ${r.customers} 家，货品 ${r.products} 条，单据 ${r.documents} 张，跳过 ${r.skipped} 张。
        ${r.errors && r.errors.length ? '<br>提示：' + r.errors.slice(0, 5).map(esc).join('；') : ''}`;
      state.customers = await api('/customers'); state.products = await api('/products');
      toast('导入完成');
    } catch (e) { box.textContent = ''; toast(e.message, true); }
  };

  v.querySelector('#btnExportData').onclick = async () => {
    try {
      const data = await api('/export/backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'CRM系统备份_' + today() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('已导出备份');
    } catch (e) { toast(e.message, true); }
  };
}

export { pageSettings };
