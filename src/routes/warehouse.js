import { all, get, run } from '../db.js';
import { audit } from '../auth.js';
import { bad, forbidden, notFound, str } from '../util.js';
import { isWarehouse } from '../scope.js';

const W_LABEL = { none: '未提交', pending: '待接收', received: '处理中', done: '已完成' };

function loadDelivery(id) {
  const d = get('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL', id);
  if (!d) throw notFound('送货单不存在');
  if (d.type !== 'delivery') throw bad('只有送货单可以走仓库流程');
  return d;
}

export function register(router) {
  /* 仓库工作台：管理员只读查看，仓库账号接收/编辑/完成 */
  router.get('/api/warehouse/deliveries', (ctx) => {
    const status = str(ctx.query.get('status'), 20) || 'pending';
    const keyword = str(ctx.query.get('q'), 80);
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(ctx.query.get('page_size')) || 20));
    const where = ["d.type='delivery'", 'd.deleted_at IS NULL', "d.warehouse_status<>'none'"];
    const params = [];
    if (['pending', 'received', 'done'].includes(status)) { where.push('d.warehouse_status=?'); params.push(status); }
    if (keyword) {
      where.push('(d.doc_no LIKE ? OR d.title LIKE ? OR c.name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const sqlWhere = 'WHERE ' + where.join(' AND ');
    const total = get(`SELECT COUNT(*) AS c FROM documents d LEFT JOIN customers c ON c.id=d.customer_id ${sqlWhere}`, ...params).c;
    const items = all(`SELECT d.id,d.doc_no,d.type,d.status,d.doc_date,d.amount,d.title,
        d.warehouse_status,d.warehouse_at,d.warehouse_received_at,c.name AS customer_name,
        u.name AS owner_name,u.username AS owner_username
      FROM documents d
      LEFT JOIN customers c ON c.id=d.customer_id
      LEFT JOIN users u ON u.id=d.owner_id
      ${sqlWhere}
      ORDER BY CASE d.warehouse_status WHEN 'pending' THEN 0 WHEN 'received' THEN 1 ELSE 2 END,
        d.warehouse_at ASC, d.id DESC
      LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
    const stats = Object.fromEntries(['pending', 'received', 'done'].map((s) => [s,
      get("SELECT COUNT(*) AS c FROM documents WHERE type='delivery' AND deleted_at IS NULL AND warehouse_status=?", s).c]));
    return { items, total, page, page_size: pageSize, stats, labels: W_LABEL };
  }, { roles: ['admin', 'warehouse'] });

  /* 送货单提交 / 接收 / 完成 / 撤回 */
  router.post('/api/documents/:id/warehouse', (ctx) => {
    const id = Number(ctx.params.id);
    const d = loadDelivery(id);
    const action = str(ctx.body.action, 20);
    const now = new Date().toISOString();
    const isOwner = Number(d.owner_id) === Number(ctx.user.id);

    if (action === 'send') {
      if (!isOwner) throw forbidden('只能提交自己的送货单');
      if (d.status === 'canceled') throw bad('已取消的送货单不能提交仓库');
      if (['pending', 'received', 'done'].includes(d.warehouse_status)) throw bad('这张送货单已在仓库流程中');
      run(`UPDATE documents SET warehouse_status='pending', warehouse_at=?, warehouse_by=?,
        warehouse_received_at=NULL, warehouse_received_by=NULL, updated_at=? WHERE id=?`, now, ctx.user.id, now, id);
      audit(ctx.user.id, 'warehouse.send', d.doc_no, '提交仓库', ctx.req.socket.remoteAddress);
      return { ok: true, warehouse_status: 'pending' };
    }

    if (action === 'withdraw') {
      if (!isOwner) throw forbidden('只能撤回自己的送货单');
      if (d.warehouse_status !== 'pending') throw bad('仓库已接收，不能撤回');
      run("UPDATE documents SET warehouse_status='none', warehouse_at=NULL, warehouse_by=NULL, updated_at=? WHERE id=?", now, id);
      audit(ctx.user.id, 'warehouse.withdraw', d.doc_no, '撤回仓库提交', ctx.req.socket.remoteAddress);
      return { ok: true, warehouse_status: 'none' };
    }

    if (!isWarehouse(ctx.user)) throw forbidden('只有仓库账号可以接收、编辑、打印或完成送货单');

    if (action === 'receive') {
      if (d.warehouse_status !== 'pending') throw bad('只有待接收的送货单可以接收');
      run(`UPDATE documents SET warehouse_status='received', warehouse_received_at=?, warehouse_received_by=?, updated_at=? WHERE id=?`,
        now, ctx.user.id, now, id);
      audit(ctx.user.id, 'warehouse.receive', d.doc_no, '仓库接收', ctx.req.socket.remoteAddress);
      return { ok: true, warehouse_status: 'received' };
    }

    if (action === 'done') {
      if (d.warehouse_status !== 'received') throw bad('只有处理中的送货单可以完成');
      run("UPDATE documents SET warehouse_status='done', updated_at=? WHERE id=?", now, id);
      audit(ctx.user.id, 'warehouse.done', d.doc_no, '仓库完成', ctx.req.socket.remoteAddress);
      return { ok: true, warehouse_status: 'done' };
    }

    throw bad('不支持的仓库操作');
  });
}
