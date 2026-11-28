import fs from 'node:fs';
import { all, get } from '../db.js';
import { bad, notFound, str } from '../util.js';
import { saveUpload, absFile, fileById } from '../service.js';
import { assertOwner, isAdmin, isCompanyAsset, requestedOwner } from '../scope.js';
import { softDeleteFile } from '../recycle.js';

function sendFile(ctx, attachment) {
  const row = fileById(Number(ctx.params.id));
  if (!row) throw notFound('文件不存在');
  if (row.deleted_at) throw notFound('文件已删除');
  if (!isAdmin(ctx.user) && !isCompanyAsset(row.id)) assertOwner(ctx.user, row);
  const full = absFile(row);
  if (!fs.existsSync(full)) throw notFound('文件已丢失');
  const name = encodeURIComponent(row.name);
  ctx.res.writeHead(200, {
    'Content-Type': row.mime || 'application/octet-stream',
    'Content-Length': row.size,
    'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
    'Cache-Control': 'private, max-age=86400',
  });
  fs.createReadStream(full).pipe(ctx.res);
}

export function register(router) {
  router.post('/api/files', async (ctx) => {
    const form = await ctx.form();
    const files = (form || []).filter((p) => p.filename);
    if (!files.length) throw bad('没有收到文件');
    const category = str(ctx.query.get('category'), 30) || 'other';
    return files.map((f) => fileById(saveUpload(f, ctx.user.id, category)));
  });

  router.get('/api/files', (ctx) => {
    const q = String(ctx.query.get('q') || '').trim();
    const category = String(ctx.query.get('category') || '').trim();
    const owner = requestedOwner(ctx.user, ctx.query);
    const where = ['files.deleted_at IS NULL'];
    const params = [];
    if (owner) { where.push('files.owner_id=?'); params.push(owner); }
    if (q) { where.push('files.name LIKE ?'); params.push(`%${q}%`); }
    if (category) { where.push('files.category=?'); params.push(category); }
    return all(`SELECT files.id,files.name,files.mime,files.size,files.category,files.created_at,
        u.name AS owner_name, u.username AS owner_username,
        (SELECT COUNT(*) FROM document_files df WHERE df.file_id=files.id) AS doc_count
      FROM files LEFT JOIN users u ON u.id=files.owner_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY files.id DESC LIMIT 500`, ...params);
  });

  router.get('/api/files/:id/raw', (ctx) => sendFile(ctx, false), { auth: true });
  router.get('/api/files/:id/download', (ctx) => sendFile(ctx, true), { auth: true });

  router.del('/api/files/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const row = get('SELECT * FROM files WHERE id=?', id);
    if (!row) throw notFound('文件不存在');
    if (row.deleted_at) throw notFound('文件已删除');
    if (!isAdmin(ctx.user) && !isCompanyAsset(id)) assertOwner(ctx.user, row);
    const used = get('SELECT document_id FROM document_files WHERE file_id=? LIMIT 1', id)
      || get('SELECT customer_id FROM customer_files WHERE file_id=? LIMIT 1', id)
      || get('SELECT id FROM companies WHERE logo_file_id=? OR stamp_file_id=? LIMIT 1', id, id);
    if (used) throw bad('该文件已被单据、客户档案或公司主体引用，不能删除');
    softDeleteFile(id, ctx.user.id);
    return { ok: true, recycled: true };
  });
}
