import fs from 'node:fs';
import { all, get, run } from './db.js';
import { absFile } from './service.js';

export const RECYCLE_DAYS = 30;
export const RECYCLE_MS = RECYCLE_DAYS * 24 * 60 * 60 * 1000;

/** 删除超过 30 天的单据与文件做物理清理；单据附件实体不在这里删。 */
export function purgeRecycleBin() {
  const cutoff = new Date(Date.now() - RECYCLE_MS).toISOString();
  const docs = all('SELECT id,doc_no FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?', cutoff);
  for (const d of docs) {
    run('DELETE FROM document_files WHERE document_id=?', d.id);
    run('DELETE FROM documents WHERE id=?', d.id);
  }
  const files = all('SELECT * FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?', cutoff);
  for (const f of files) {
    try { fs.unlinkSync(absFile(f)); } catch { /* 实体已不存在 */ }
    run('DELETE FROM document_files WHERE file_id=?', f.id);
    run('DELETE FROM files WHERE id=?', f.id);
  }
  return { documents: docs.length, files: files.length };
}

/** 已删除条目的剩余保留天数，0 表示到期待清理。 */
export function daysLeft(deletedAt) {
  if (!deletedAt) return RECYCLE_DAYS;
  const left = new Date(deletedAt).getTime() + RECYCLE_MS - Date.now();
  return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}

export function softDeleteDocument(id, userId) {
  const d = get('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL', id);
  if (!d) return false;
  run('UPDATE documents SET deleted_at=?, deleted_by=?, updated_at=? WHERE id=?',
    new Date().toISOString(), userId, new Date().toISOString(), id);
  return true;
}

export function softDeleteFile(id, userId) {
  const f = get('SELECT * FROM files WHERE id=? AND deleted_at IS NULL', id);
  if (!f) return false;
  run('UPDATE files SET deleted_at=?, deleted_by=? WHERE id=?', new Date().toISOString(), userId, id);
  return true;
}
