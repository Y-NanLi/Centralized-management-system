import { bad } from './util.js';

export const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,24}$/u;

export function normalizeUsername(value) {
  const v = String(value == null ? '' : value).trim();
  if (!USERNAME_RE.test(v)) throw bad('用户名 2–24 位，可用中文、字母、数字、下划线、点或短横');
  return v;
}
