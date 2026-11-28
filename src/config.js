import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const WEB_DIR = path.join(ROOT, 'web');
export const PORT = Number(process.env.PORT || 8099);
export const HOST = process.env.HOST || '0.0.0.0';
export const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

fs.mkdirSync(FILES_DIR, { recursive: true });

function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const f = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

export const SECRET = loadSecret();
export const TOKEN_TTL = 7 * 24 * 3600 * 1000; // 7 天
export const MAX_UPLOAD = 100 * 1024 * 1024;  // 单文件 100MB
