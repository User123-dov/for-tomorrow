// B站视频信息：公开 API（无需登录），支持 BV / av 号 / b23.tv 短链
const { fetchPage } = require('./fetcher');

const BILI_HOSTS = ['bilibili.com', 'b23.tv'];

function isBilibili(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BILI_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

function parseVideoId(url) {
  const bv = /(BV[0-9A-Za-z]{10})/.exec(url);
  if (bv) return { bvid: bv[1] };
  const av = /av(\d+)/i.exec(url);
  if (av) return { aid: av[1] };
  return null;
}

async function fetchVideoMeta(id) {
  const qs = id.bvid ? `bvid=${id.bvid}` : `aid=${id.aid}`;
  // 注意：B站 WAF 会拦截带 Referer 的 API 请求（实测返回 412），这里刻意不发送 Referer
  const res = await fetchPage(`https://api.bilibili.com/x/web-interface/view?${qs}`);
  if (res.status !== 200 || !res.text) throw new Error('B站接口请求失败（HTTP ' + res.status + '）');
  let body;
  try { body = JSON.parse(res.text); } catch { throw new Error('B站接口返回内容异常'); }
  if (body.code !== 0) {
    const msgs = { '-400': '视频链接有误', '-404': '视频不存在（可能已删除）', '62002': '视频不可见（稿件不可见）' };
    throw new Error('B站接口错误：' + (msgs[String(body.code)] || body.message));
  }
  const d = body.data;
  return {
    bvid: d.bvid,
    title: d.title,
    coverUrl: d.pic,
    summary: (d.desc || '').slice(0, 1000),
    upName: d.owner ? d.owner.name : '',
    duration: d.duration || 0,
    site: 'bilibili.com',
    pages: (d.pages || []).map(p => ({ page: p.page, part: p.part, duration: p.duration })),
    playUrl: `https://www.bilibili.com/video/${d.bvid}`,
  };
}

// b23.tv 短链 → 真实视频地址
async function resolveShortLink(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
    // 不需要 body，只要最终 URL
    await res.arrayBuffer().catch(() => {});
    return res.url || url;
  } catch { return url; }
}

// ---------- 按名称搜索B站视频（官方接口 + wbi 签名） ----------
const crypto = require('node:crypto');
const MIXIN_KEY_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
let wbiCache = { keys: null, cookie: null, ts: 0 };

async function biliGet(url, cookie) {
  const res = await fetch(url, { headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/', ...(cookie ? { Cookie: cookie } : {}) } });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function biliBootstrap(force = false) {
  if (!force && wbiCache.keys && Date.now() - wbiCache.ts < 3600000) return wbiCache;
  const home = await fetch('https://www.bilibili.com/', { headers: { 'User-Agent': BILI_UA } });
  const cookie = (home.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).filter(c => /^(buvid3|buvid4)/.test(c)).join('; ');
  await home.arrayBuffer().catch(() => { /* 只要 Cookie */ });
  const nav = await biliGet('https://api.bilibili.com/x/web-interface/nav', cookie);
  const wbi = nav.json?.data?.wbi_img || {};
  const imgKey = (wbi.img_url || '').split('/').pop().split('.')[0];
  const subKey = (wbi.sub_url || '').split('/').pop().split('.')[0];
  if (!imgKey || !subKey) throw new Error('无法获取B站搜索凭证');
  wbiCache = { keys: { imgKey, subKey }, cookie, ts: Date.now() };
  return wbiCache;
}

function wbiSign(params, keys) {
  const mixin = MIXIN_KEY_TAB.map(i => (keys.imgKey + keys.subKey)[i]).join('').slice(0, 32);
  const withTs = { ...params, wts: Math.floor(Date.now() / 1000) };
  const qs = Object.keys(withTs).sort()
    .map(k => k + '=' + encodeURIComponent(String(withTs[k]).replace(/[!'()*]/g, '')))
    .join('&');
  return qs + '&w_rid=' + crypto.createHash('md5').update(qs + mixin).digest('hex');
}

function parseDuration(str) {
  const parts = String(str || '').split(':').map(Number).filter(n => !Number.isNaN(n));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// 搜索B站视频：[{bvid, title, cover, up, duration, playUrl}]
async function searchVideos(keyword, page = 1) {
  const boot = await biliBootstrap();
  const qs = wbiSign({ keyword, search_type: 'video', page }, boot.keys);
  const res = await biliGet('https://api.bilibili.com/x/web-interface/search/type?' + qs, boot.cookie);
  if (res.json?.code !== 0) throw new Error('B站搜索失败：' + (res.json?.message || res.json?.code));
  return (res.json.data?.result || []).map(v => ({
    bvid: v.bvid,
    title: (v.title || '').replace(/<[^>]+>/g, '').trim(),
    cover: v.pic && v.pic.startsWith('//') ? 'https:' + v.pic : (v.pic || ''),
    up: v.author || '',
    duration: parseDuration(v.duration),
    play: v.play || 0,
    playUrl: `https://www.bilibili.com/video/${v.bvid}`,
  }));
}

module.exports = { isBilibili, parseVideoId, fetchVideoMeta, resolveShortLink, searchVideos };
