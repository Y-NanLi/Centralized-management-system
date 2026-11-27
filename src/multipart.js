import { bad } from './util.js';

/** 解析 multipart/form-data，返回 [{name, filename, contentType, data:Buffer}] */
export function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw bad('上传格式不正确（缺少 boundary）');
  const boundary = (m[1] || m[2] || '').trim();
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let idx = buffer.indexOf(delim);
  let guard = 0;

  while (idx >= 0 && guard++ < 1000) {
    let start = idx + delim.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const headEnd = buffer.indexOf('\r\n\r\n', start);
    if (headEnd < 0) break;
    const headerText = buffer.slice(start, headEnd).toString('utf8');
    const dataStart = headEnd + 4;
    const next = buffer.indexOf(delim, dataStart);
    if (next < 0) break;
    let dataEnd = next;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;
    const headers = {};
    headerText.split('\r\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).toLowerCase().trim()] = line.slice(i + 1).trim();
    });
    const cd = headers['content-disposition'] || '';
    const nameM = /name="([^"]*)"/i.exec(cd);
    const starM = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
    const fileM = /filename="((?:\\"|[^"])*)"/i.exec(cd);
    let filename = '';
    if (starM) filename = decodeURIComponent(starM[1]);
    else if (fileM) filename = fileM[1].replace(/\\"/g, '"');
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: filename || null,
      contentType: headers['content-type'] || '',
      data: buffer.slice(dataStart, dataEnd),
    });
    idx = next;
  }
  return parts;
}
