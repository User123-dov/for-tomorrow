// 采集管线：URL → 类型识别（B站视频 / YouTube / 文件直链 / 网页文章）→ 抓取 → 入库
const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { fetchPage, normalizeUrl, cookieFor } = require('./fetcher');
const { extractArticle } = require('./extractor');
const bilibili = require('./bilibili');
const { db, FILES_DIR } = require('../db');

const FILE_EXTS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.rar', '.7z', '.mp3', '.mp4', '.epub', '.txt', '.csv'];

function detectType(url) {
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return 'article'; }
  if (FILE_EXTS.some(ext => pathname.endsWith(ext))) return 'file';
  if (bilibili.isBilibili(url)) return 'video';
  if (/(youtube\.com\/watch|youtu\.be\/)/i.test(url)) return 'video';
  return 'article';
}

function safeName(name) {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'file';
}

function insertMaterial(m) {
  const info = db.prepare(`
    INSERT INTO materials (type, title, source_url, site, cover_url, summary, content_html, content_text,
                           local_path, file_size, subject_id, tags, bvid, up_name, duration, pages, watch_status)
    VALUES (@type, @title, @source_url, @site, @cover_url, @summary, @content_html, @content_text,
            @local_path, @file_size, @subject_id, @tags, @bvid, @up_name, @duration, @pages, 'unwatched')
  `).run({
    type: m.type, title: m.title, source_url: m.source_url || '', site: m.site || '',
    cover_url: m.coverUrl || '', summary: m.summary || '', content_html: m.contentHtml || '',
    content_text: m.contentText || '', local_path: m.localPath || '', file_size: m.fileSize || 0,
    subject_id: m.subjectId || null, tags: m.tags || '', bvid: m.bvid || '', up_name: m.upName || '',
    duration: m.duration || 0, pages: JSON.stringify(m.pages || []),
  });
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid);
}

// 下载文件直链到本地资料库
async function downloadFile(url, { subjectId, tags } = {}) {
  const res = await fetchPage(url, { timeoutMs: 120000 });
  if (res.status !== 200) throw new Error('下载失败（HTTP ' + res.status + '）');
  let name = '';
  try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { name = ''; }
  const finalName = safeName(name || `file_${Date.now()}`);
  const relPath = path.join('downloads', `${Date.now()}_${finalName}`);
  const absPath = path.join(FILES_DIR, relPath);
  await pipeline(require('node:stream').Readable.from(res.buffer), fs.createWriteStream(absPath));
  const size = fs.statSync(absPath).size;
  return insertMaterial({
    type: 'file', title: finalName.replace(/^\d+_/, ''), source_url: url,
    site: new URL(url).hostname.replace(/^www\./, ''), summary: `文件 ${finalName}（${(size / 1024 / 1024).toFixed(1)} MB）`,
    localPath: relPath.replace(/\\/g, '/'), fileSize: size, subjectId, tags,
  });
}

async function captureYouTube(url, { subjectId, tags } = {}) {
  const api = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetchPage(api, { timeoutMs: 10000 });
  let meta = {};
  try { meta = JSON.parse(res.text); } catch { /* 取不到元数据就按收藏链接保存 */ }
  return insertMaterial({
    type: 'video', title: meta.title || url, source_url: url, site: 'youtube.com',
    coverUrl: meta.thumbnail_url || '', summary: meta.author_name ? `UP主：${meta.author_name}` : '',
    subjectId, tags,
  });
}

// 单个 URL 的完整采集流程
async function captureUrl(rawUrl, { subjectId = null, tags = '' } = {}) {
  let url = normalizeUrl(rawUrl);
  if (!url) throw new Error('URL 格式无效');
  if (/b23\.tv/i.test(url)) url = await bilibili.resolveShortLink(url);

  const type = detectType(url);
  if (type === 'video' && bilibili.isBilibili(url)) {
    const id = bilibili.parseVideoId(url);
    if (!id) throw new Error('未能从链接中识别出 B站视频 ID');
    const meta = await bilibili.fetchVideoMeta(id);
    return insertMaterial({
      type: 'video', title: meta.title, source_url: meta.playUrl, site: meta.site,
      coverUrl: meta.coverUrl, summary: meta.summary, upName: meta.upName, duration: meta.duration,
      pages: meta.pages, bvid: meta.bvid, subjectId, tags,
    });
  }
  if (type === 'video') return captureYouTube(url, { subjectId, tags });
  if (type === 'file') return downloadFile(url, { subjectId, tags });

  // 网页文章
  const res = await fetchPage(url);
  if (res.status !== 200 || !res.text) throw new Error('页面抓取失败（HTTP ' + res.status + '）');
  const art = extractArticle(res.text, res.finalUrl);
  const looksLikeArticle = art.contentText.length > 200;
  return insertMaterial({
    type: looksLikeArticle ? 'article' : 'link',
    title: art.title || url, source_url: res.finalUrl, site: art.site,
    coverUrl: art.coverUrl, summary: art.summary || art.contentText.slice(0, 200),
    contentHtml: art.contentHtml, contentText: art.contentText, subjectId, tags,
  });
}

module.exports = { captureUrl, detectType, cookieFor };
