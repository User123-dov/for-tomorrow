// 网页搜索服务：按名称找链接和文件。百度为主（国内稳定），必应兜底。
// 百度结果里的 /link?url= 跳转地址会被解析成真实网址再返回。
const { fetchPage } = require('./fetcher');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------- 百度 ----------
function parseBaidu(html, limit) {
  const out = [];
  const re = /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (title && /^https?:\/\/(www\.)?baidu\.com\/link/.test(m[1])) out.push({ title, url: m[1], snippet: '' });
  }
  return out;
}

async function searchBaidu(query, limit) {
  const res = await fetchPage('https://www.baidu.com/s?wd=' + encodeURIComponent(query) + '&rn=' + Math.max(10, limit), { timeoutMs: 20000 });
  if (res.status !== 200 || !res.text) throw new Error('百度搜索请求失败（HTTP ' + res.status + '）');
  if (/百度安全验证/.test(res.text)) throw new Error('百度要求人机验证');
  const results = parseBaidu(res.text, limit);
  if (!results.length) throw new Error('百度未返回结果');
  // 跳转链接 → 真实网址（并发解析，响应头到达即中断下载）
  const resolved = await Promise.all(results.map(async (r) => {
    const real = await resolveRedirect(r.url);
    let host = '';
    try { host = new URL(real).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
    return { ...r, url: real, snippet: host };
  }));
  return resolved;
}

async function resolveRedirect(url, hops = 3) {
  try {
    let cur = url;
    for (let i = 0; i < hops; i++) {
      const ctrl = new AbortController();
      const res = await fetch(cur, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA } });
      ctrl.abort(); // 只要响应头，不要正文
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
      return cur;
    }
    return cur;
  } catch (e) {
    if (e.message === 'This operation was aborted' || e.name === 'AbortError') {
      // abort 发生在拿到响应头之后，重新走一遍拿到最终 location 链
      try {
        let cur = url;
        for (let i = 0; i < hops; i++) {
          const res = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': UA } });
          const loc = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
          return cur;
        }
        return cur;
      } catch { return url; }
    }
    return url;
  }
}

// ---------- 必应（兜底） ----------
function parseBing(html, limit) {
  const out = [];
  const blocks = html.split('class="b_algo"').slice(1);
  for (const block of blocks) {
    const linkM = /<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/.exec(block);
    if (!linkM || !/^https?:\/\//.test(linkM[1])) continue;
    const title = linkM[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const snipM = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    const snippet = snipM ? snipM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200) : "";
    out.push({ title, url: linkM[1], snippet });
    if (out.length >= limit) break;
  }
  return out;
}

async function searchBing(query, limit) {
  const res = await fetchPage('https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&mkt=zh-CN&count=' + Math.max(10, limit), { timeoutMs: 20000 });
  if (res.status !== 200 || !res.text) throw new Error('必应搜索请求失败');
  if (/验证|captcha/i.test(res.text.slice(0, 3000)) && !res.text.includes('b_algo')) throw new Error('必应要求人机验证');
  const results = parseBing(res.text, limit);
  if (!results.length) throw new Error('必应未返回结果');
  return results;
}

// ---------- 对外入口：百度优先，必应兜底 ----------
async function searchWeb(query, { limit = 10 } = {}) {
  try { return { engine: 'baidu', results: await searchBaidu(query, limit) }; }
  catch (e1) {
    try { return { engine: 'bing', results: await searchBing(query, limit) }; }
    catch { throw e1; }
  }
}

module.exports = { searchWeb, searchBaidu, searchBing };
