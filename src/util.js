import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

export const bad = (msg) => new HttpError(400, msg, 'bad_request');
export const unauthorized = (msg = '请先登录') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = '没有权限执行此操作') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = '资源不存在') => new HttpError(404, msg, 'not_found');

export function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function ymd(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

export function today(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function nowISO() { return new Date().toISOString(); }

/** 金额：保留两位小数的数字 */
export function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function str(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

export function randomName(ext) {
  const id = crypto.randomUUID().replace(/-/g, '');
  return ext ? `${id}${ext}` : id;
}

export function extOf(name) {
  const m = String(name || '').toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
  return m ? m[1] : '';
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 人民币大写（支持角分，最大到兆） */
export function rmbUpper(n) {
  const amount = money(n);
  if (amount === 0) return '零元整';
  const negative = amount < 0;
  let abs = Math.abs(amount);
  const fraction = ['角', '分'];
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const unit = [['元', '万', '亿', '兆'], ['', '拾', '佰', '仟']];
  let s = '';
  for (let i = 0; i < fraction.length; i++) {
    s += (digit[Math.floor(abs * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, '');
  }
  s = s || '整';
  abs = Math.floor(abs);
  for (let i = 0; i < unit[0].length && abs > 0; i++) {
    let p = '';
    for (let j = 0; j < unit[1].length && abs > 0; j++) {
      p = digit[abs % 10] + unit[1][j] + p;
      abs = Math.floor(abs / 10);
    }
    s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s;
  }
  return (negative ? '负' : '') + s
    .replace(/(零.)*零元/, '元')
    .replace(/(零.)+/g, '零')
    .replace(/^整$/, '零元整');
}

export function sumItems(items = []) {
  return money(items.reduce((s, it) => {
    const qty = Number(it.qty);
    const price = Number(it.price);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return s;
    return s + qty * price;
  }, 0));
}
