// 抓取服务：带浏览器 UA、站点 Cookie、GBK 等编码识别的页面抓取
const { getSetting } = require('../db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 站点 Cookie 存于设置 site_cookies: [{host, cookie}]
function cookieFor(url) {
  let list = [];
  try { list = JSON.parse(getSetting('site_cookies', '[]')); } catch { /* 忽略损坏的配置 */ }
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  const hit = list.find(c => host === c.host.toLowerCase() || host.endsWith('.' + c.host.toLowerCase()));
  return hit ? hit.cookie.trim() : '';
}

function sniffCharset(buffer, contentType = '') {
  let m = /charset=([\w-]+)/i.exec(contentType);
  if (m) return m[1].toLowerCase();
  const head = buffer.subarray(0, 2048).toString('latin1');
  m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : 'utf-8';
}

// 抓取页面，自动识别编码（中文站常见 GBK），返回解码后的文本与最终 URL（跟随短链跳转）
async function fetchPage(url, { timeoutMs = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        ...(cookieFor(url) ? { 'Cookie': cookieFor(url) } : {}),
        ...headers,
      },
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    const charset = sniffCharset(buffer, res.headers.get('content-type') || '');
    let text = null;
    if (/html|json|text|xml/i.test(res.headers.get('content-type') || 'text/html')) {
      try { text = new TextDecoder(charset).decode(buffer); }
      catch { text = buffer.toString('utf-8'); }
    }
    return { finalUrl: res.url || url, status: res.status, contentType: res.headers.get('content-type') || '', buffer, text };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(raw) {
  let u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const parsed = new URL(u); return parsed.href; } catch { return null; }
}

module.exports = { fetchPage, cookieFor, normalizeUrl, UA };
