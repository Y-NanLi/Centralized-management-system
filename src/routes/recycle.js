import fs from 'node:fs';
import { all, get, run } from '../db.js';
import { notFound } from '../util.js';
import { assertOwner, isAdmin, requestedOwner } from '../scope.js';
import { absFile } from '../service.js';
import { daysLeft, purgeRecycleBin, RECYCLE_DAYS } from '../recycle.js';

export function register(router) {
  router.get('/api/recycle', (ctx) => {
    purgeRecycleBin();
    const owner = requestedOwner(ctx.user, ctx.query);
    const ownerSql = owner ? ' AND owner_id=?' : '';
    const ownerParams = owner ? [owner] : [];
    const docs = all(`SELECT d.id,d.doc_no,d.type,d.status,d.doc_date,d.amount,d.title,d.owner_id,
        d.warehouse_status,d.deleted_at,d.deleted_by,c.name AS customer_name,
        u.name AS owner_name,u.username AS owner_username
      FROM documents d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN users u ON u.id=d.owner_id
      WHERE d.deleted_at IS NOT NULL${ownerSql.replace('owner_id', 'd.owner_id')}
      ORDER BY d.deleted_at DESC LIMIT 500`, ...ownerParams);
    const files = all(`SELECT f.id,f.name,f.mime,f.size,f.category,f.owner_id,f.deleted_at,f.deleted_by,
        u.name AS owner_name,u.username AS owner_username
      FROM files f LEFT JOIN users u ON u.id=f.owner_id
      WHERE f.deleted_at IS NOT NULL${ownerSql.replace('owner_id', 'f.owner_id')}
      ORDER BY f.deleted_at DESC LIMIT 500`, ...ownerParams);
    const decorate = (row) => ({ ...row, days_left: daysLeft(row.deleted_at) });
    return {
      retention_days: RECYCLE_DAYS,
      documents: docs.map(decorate),
      files: files.map(decorate),
      can_filter_owner: isAdmin(ctx.user),
    };
  });

  router.post('/api/recycle/documents/:id/restore', (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT * FROM documents WHERE id=? AND deleted_at IS NOT NULL', id);
    if (!d) throw notFound('回收站里没有这张单据');
    assertOwner(ctx.user, d);
    run('UPDATE documents SET deleted_at=NULL, deleted_by=NULL, updated_at=? WHERE id=?', new Date().toISOString(), id);
    return { ok: true };
  });

  router.post('/api/recycle/files/:id/restore', (ctx) => {
    const id = Number(ctx.params.id);
    const f = get('SELECT * FROM files WHERE id=? AND deleted_at IS NOT NULL', id);
    if (!f) throw notFound('回收站里没有这个文件');
    assertOwner(ctx.user, f);
    run('UPDATE files SET deleted_at=NULL, deleted_by=NULL WHERE id=?', id);
    return { ok: true };
  });

  router.del('/api/recycle/documents/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const d = get('SELECT * FROM documents WHERE id=? AND deleted_at IS NOT NULL', id);
    if (!d) throw notFound('回收站里没有这张单据');
    assertOwner(ctx.user, d);
    run('DELETE FROM document_files WHERE document_id=?', id);
    run('DELETE FROM documents WHERE id=?', id);
    return { ok: true };
  });

  router.del('/api/recycle/files/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const f = get('SELECT * FROM files WHERE id=? AND deleted_at IS NOT NULL', id);
    if (!f) throw notFound('回收站里没有这个文件');
    assertOwner(ctx.user, f);
    try { fs.unlinkSync(absFile(f)); } catch { /* 实体已不存在 */ }
    run('DELETE FROM document_files WHERE file_id=?', id);
    run('DELETE FROM files WHERE id=?', id);
    return { ok: true };
  });
}
