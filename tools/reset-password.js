// 用法：node tools/reset-password.js <账号> <新密码>
// 例：  node tools/reset-password.js admin NewPass123
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/password.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const username = process.argv[2] || 'admin';
const password = process.argv[3];

if (!password || password.length < 6) {
  console.error('用法：node tools/reset-password.js <账号> <新密码（至少6位）>');
  process.exit(1);
}

const db = new DatabaseSync(path.join(dataDir, 'app.db'));
const row = db.prepare('SELECT id FROM users WHERE username=?').get(username);
if (!row) {
  console.error('账号不存在：' + username);
  process.exit(1);
}
db.prepare('UPDATE users SET password=?, active=1 WHERE id=?').run(hashPassword(password), row.id);
console.log(`已重置 ${username} 的密码，并恢复启用状态。`);
