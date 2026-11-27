/* 用户管理 */
import { state, api, esc, roleLabel, toast, modal, confirmBox, seq } from '../core.js';
import { view } from '../shell.js';

/* ---------------- 用户 ---------------- */
async function pageUsers(q, my) {
  if (state.user.role !== 'admin') { location.hash = '#/dashboard'; return; }
  const list = await api('/users');
  if (my !== seq) return;
  const rows = list.map((u) => `<tr>
      <td><b>${esc(u.name)}</b><div class="tiny">${esc(u.username)}</div></td>
      <td>${esc(roleLabel(u.role))}</td><td class="mono">${esc(u.phone || '—')}</td>
      <td><span class="badge ${u.active ? 'accepted' : 'closed'}">${u.active ? '启用' : '停用'}</span></td>
      <td class="tiny">${esc(u.created_at.slice(0, 10))}</td>
      <td><a href="#" data-edit="${u.id}">编辑</a> ${u.active ? `<a href="#" data-del="${u.id}" style="color:#c0392b">停用</a>` : ''}</td></tr>`).join('');
  const v = view(`<div class="page-head"><div><h2>用户管理</h2><div class="desc">账号、角色与权限；业务员可开单，主管可删除与导入，管理员可管账号与主体</div></div>
      <div class="actions"><button class="btn primary" id="btnAddUser">+ 新增用户</button></div></div>
    <div class="card"><table class="tb"><thead><tr><th>姓名 / 账号</th><th>角色</th><th>电话</th><th>状态</th><th>创建</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`, 'users', '用户管理');
  v.querySelector('#btnAddUser').onclick = () => userForm();
  v.querySelectorAll('[data-edit]').forEach((a) => a.onclick = (e) => { e.preventDefault(); userForm(list.find((x) => String(x.id) === a.dataset.edit)); });
  v.querySelectorAll('[data-del]').forEach((a) => a.onclick = async (e) => {
    e.preventDefault();
    if (!await confirmBox('停用该账号？停用后不能登录，数据保留。')) return;
    try { await api('/users/' + a.dataset.del, { method: 'DELETE' }); toast('已停用'); route(); } catch (err) { toast(err.message, true); }
  });
}

function userForm(u) {
  const m = modal({
    title: u ? '编辑用户' : '新增用户',
    body: `<div class="grid2">
      <div class="field"><label>账号 ${u ? '（不可改）' : '*'}</label><input class="input" id="ufUser" value="${esc(u && u.username || '')}" ${u ? 'disabled' : ''}></div>
      <div class="field"><label>姓名</label><input class="input" id="ufName" value="${esc(u && u.name || '')}"></div>
      <div class="field"><label>角色</label><select class="input" id="ufRole">${state.meta.roles.map((r) => `<option value="${r.key}" ${u && u.role === r.key ? 'selected' : ''}>${r.label}</option>`).join('')}</select></div>
      <div class="field"><label>电话</label><input class="input" id="ufPhone" value="${esc(u && u.phone || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>密码 ${u ? '（留空不改）' : '*'}</label><input class="input" type="password" id="ufPwd" placeholder="至少 6 位"></div>
      ${u ? `<div class="field"><label>状态</label><select class="input" id="ufActive"><option value="1" ${u.active ? 'selected' : ''}>启用</option><option value="0" ${!u.active ? 'selected' : ''}>停用</option></select></div>` : ''}
    </div>`,
    footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="ufSave">保存</button>',
  });
  m.root.querySelector('#ufSave').onclick = async () => {
    const body = {
      username: m.root.querySelector('#ufUser').value, name: m.root.querySelector('#ufName').value,
      role: m.root.querySelector('#ufRole').value, phone: m.root.querySelector('#ufPhone').value,
      password: m.root.querySelector('#ufPwd').value,
    };
    if (u && m.root.querySelector('#ufActive')) body.active = Number(m.root.querySelector('#ufActive').value);
    try {
      if (u) await api('/users/' + u.id, { method: 'PUT', body });
      else await api('/users', { method: 'POST', body });
      m.close(); toast('已保存'); route();
    } catch (e) { toast(e.message, true); }
  };
}


export { pageUsers };
