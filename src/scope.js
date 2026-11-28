import { get } from './db.js';
import { num, notFound } from './util.js';

export function isAdmin(user) {
  return !!user && user.role === 'admin';
}

export function isWarehouse(user) {
  return !!user && user.role === 'warehouse';
}

/** 单据访问：本人 / 管理员 / 仓库角色对已提交仓库的送货单 */
export function canAccessDocument(user, row) {
  if (!user || !row) return false;
  if (isAdmin(user)) return true;
  if (Number(row.owner_id) === Number(user.id)) return true;
  return isWarehouse(user) && row.type === 'delivery'
    && !!row.warehouse_status && row.warehouse_status !== 'none';
}

export function assertDocumentAccess(user, row) {
  if (!row) throw notFound();
  if (!canAccessDocument(user, row)) throw notFound();
  return row;
}

/** 管理员：不带 owner / owner=all 表示全量；带数字表示查看某个成员。普通用户强制本人。 */
export function requestedOwner(user, query) {
  if (!user) return null;
  if (!isAdmin(user)) return Number(user.id);
  const raw = query && query.get('owner');
  if (!raw || raw === 'all') return null;
  return num(raw) || null;
}

export function ownerCondition(alias, ownerId) {
  return ownerId ? { sql: ` AND ${alias}.owner_id=?`, params: [ownerId] } : { sql: '', params: [] };
}

export function assertOwner(user, row, field = 'owner_id') {
  if (!row) throw notFound();
  if (!isAdmin(user) && Number(row[field]) !== Number(user.id)) throw notFound();
  return row;
}

/** 公司 Logo / 电子章属于全公司共用资源，不受个人文件库隔离影响。 */
export function isCompanyAsset(fileId) {
  return !!get('SELECT id FROM companies WHERE logo_file_id=? OR stamp_file_id=? LIMIT 1', fileId);
}
