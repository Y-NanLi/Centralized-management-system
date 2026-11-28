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
      普通账号只能看到自己的工作台、客户、货品、单据和文件；管理员可查看全部成员，并在工作台按成员切换。</div>
    </div>

    <div class="card" style="margin-top:14px"><h3>数据备份</h3>
      <div class="card-sub">导出客户、货品、单据与公司主体为 JSON；普通账号只导出本人数据，管理员默认导出全部成员。上传的文件实体在服务器 data/files 目录，请一并复制备份。</div>
      <button class="btn" id="btnExportData">导出数据 JSON</button>
    </div>

    <div class="card" style="margin-top:14px"><h3>关于</h3>
      <div class="tiny" style="line-height:2">集中管理系统 v1.7 · Node.js 22 + SQLite · 数据目录 data/（app.db 与 files/）<br>
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
      a.download = '集中管理系统备份_' + today() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('已导出备份');
    } catch (e) { toast(e.message, true); }
  };
}

export { pageSettings };
