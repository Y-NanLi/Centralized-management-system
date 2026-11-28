import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { hashPassword } from './password.js';
import { nowISO } from './util.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales',
  phone TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT DEFAULT '',
  addr TEXT DEFAULT '',
  rep TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  fax TEXT DEFAULT '',
  logo_file_id INTEGER,
  stamp_file_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  addr TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  fax TEXT DEFAULT '',
  tax_no TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  spec TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  price REAL DEFAULT 0,
  note TEXT DEFAULT '',
  owner_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  company_id INTEGER,
  customer_id INTEGER,
  owner_id INTEGER,
  doc_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  title TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  parent_id INTEGER,
  root_id INTEGER,
  warehouse_status TEXT NOT NULL DEFAULT 'none',
  warehouse_at TEXT,
  warehouse_by INTEGER,
  warehouse_received_at TEXT,
  warehouse_received_by INTEGER,
  deleted_at TEXT,
  deleted_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_no ON documents(doc_no);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type, status);
CREATE INDEX IF NOT EXISTS idx_documents_customer ON documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stored TEXT NOT NULL,
  mime TEXT DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT DEFAULT '',
  category TEXT DEFAULT 'other',
  owner_id INTEGER,
  deleted_at TEXT,
  deleted_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);

CREATE TABLE IF NOT EXISTS document_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  category TEXT DEFAULT 'attachment',
  created_at TEXT NOT NULL,
  UNIQUE(document_id, file_id)
);

CREATE TABLE IF NOT EXISTS number_seq (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
`);

const seeds = [
  ['jxt', '苏州捷信通信息技术有限公司', '捷信通', '', '司婷婷', '18915588129', '0512-68138215'],
  ['yzl', '苏州悦智乐智能科技有限公司', '悦智乐', '', '', '', ''],
  ['ac', '苏州安驰电子科技有限公司', '安驰', '', '', '0512-68128072', ''],
];

if (db.prepare('SELECT COUNT(*) AS c FROM companies').get().c === 0) {
  const ins = db.prepare('INSERT INTO companies (code,name,short_name,addr,rep,phone,fax,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const s of seeds) ins.run(...s, nowISO(), nowISO());
}

if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
  db.prepare('INSERT INTO users (username,name,password,role,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('admin', '系统管理员', hashPassword('admin123'), 'admin', '', 1, nowISO(), nowISO());
}

/* ---------- v1.7 多用户隔离迁移 ---------- */
const productCols = db.prepare('PRAGMA table_info(products)').all();
if (!productCols.some((c) => c.name === 'owner_id')) {
  db.exec('ALTER TABLE products ADD COLUMN owner_id INTEGER');
}
const fallbackOwner = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();

/* 旧货品没有 owner_id：优先按历史单据明细认领给单据 owner，剩下才回填管理员 */
for (const p of db.prepare('SELECT id,name,spec FROM products WHERE owner_id IS NULL').all()) {
  let ownerId = 0;
  const docs = db.prepare('SELECT owner_id,payload FROM documents WHERE owner_id IS NOT NULL AND payload LIKE ? ORDER BY id DESC LIMIT 30').all(`%${p.name}%`);
  for (const d of docs) {
    let items = [];
    try { items = (JSON.parse(d.payload || '{}').items) || []; } catch { items = []; }
    if (items.some((it) => String(it.name || '').trim() === String(p.name || '').trim()
      && (!p.spec || String(it.spec || '').trim() === String(p.spec || '').trim()))) {
      ownerId = d.owner_id;
      break;
    }
  }
  if (ownerId) db.prepare('UPDATE products SET owner_id=? WHERE id=?').run(ownerId, p.id);
}

if (fallbackOwner) {
  db.prepare('UPDATE customers SET created_by=? WHERE created_by IS NULL').run(fallbackOwner.id);
  db.prepare('UPDATE products SET owner_id=? WHERE owner_id IS NULL').run(fallbackOwner.id);
  db.prepare('UPDATE documents SET owner_id=? WHERE owner_id IS NULL').run(fallbackOwner.id);
  db.prepare('UPDATE files SET owner_id=? WHERE owner_id IS NULL').run(fallbackOwner.id);
}
db.exec('DROP INDEX IF EXISTS idx_customers_name');
db.exec('DROP INDEX IF EXISTS idx_products_name_spec');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_owner_name ON customers(created_by, name)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_owner_name_spec ON products(owner_id, name, spec)');
db.exec('CREATE INDEX IF NOT EXISTS idx_products_owner ON products(owner_id)');

/* ---------- v1.8 仓库流转 / 回收站迁移 ---------- */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('documents', 'warehouse_status', "warehouse_status TEXT NOT NULL DEFAULT 'none'");
ensureColumn('documents', 'warehouse_at', 'warehouse_at TEXT');
ensureColumn('documents', 'warehouse_by', 'warehouse_by INTEGER');
ensureColumn('documents', 'warehouse_received_at', 'warehouse_received_at TEXT');
ensureColumn('documents', 'warehouse_received_by', 'warehouse_received_by INTEGER');
ensureColumn('documents', 'deleted_at', 'deleted_at TEXT');
ensureColumn('documents', 'deleted_by', 'deleted_by INTEGER');
ensureColumn('files', 'deleted_at', 'deleted_at TEXT');
ensureColumn('files', 'deleted_by', 'deleted_by INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_documents_warehouse ON documents(warehouse_status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(deleted_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(deleted_at)');

export function all(sql, ...params) {
  return db.prepare(sql).all(...params).map((r) => ({ ...r }));
}

export function get(sql, ...params) {
  const r = db.prepare(sql).get(...params);
  return r ? { ...r } : null;
}

export function run(sql, ...params) {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
