// 音乐：塞壬唱片（鹰角 MSR）曲库 + 本地音乐文件，统一成一个可增删的歌单
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const Busboy = require('busboy');
const { getSetting, setSetting, FILES_DIR } = require('../db');

const router = express.Router();
const MSR = 'https://monster-siren.hypergryph.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
const MUSIC_DIR = path.join(FILES_DIR, 'music');
const AUDIO_EXT = ['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.aac', '.opus'];

const albumCache = new Map();      // cid -> detail (24h)
const songCache = new Map();       // cid -> {name, artist, sourceUrl} (6h，CDN 链接带时效)
let albumsCache = { ts: 0, list: null };

async function msrJson(p) {
  const res = await fetch(MSR + p, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('塞壬唱片接口 HTTP ' + res.status);
  const body = await res.json();
  if (body.code !== 0) throw new Error('塞壬唱片接口错误：' + (body.msg || body.code));
  return body.data;
}

async function allAlbums() {
  if (albumsCache.list && Date.now() - albumsCache.ts < 86400000) return albumsCache.list;
  albumsCache = { ts: Date.now(), list: await msrJson('/api/albums') };
  return albumsCache.list;
}
async function albumDetail(cid) {
  const hit = albumCache.get(cid);
  if (hit && Date.now() - hit.ts < 86400000) return hit.data;
  const data = await msrJson(`/api/album/${cid}/detail`);
  albumCache.set(cid, { ts: Date.now(), data });
  return data;
}
async function songDetail(cid) {
  const hit = songCache.get(cid);
  if (hit && Date.now() - hit.ts < 6 * 3600000) return hit;
  const d = await msrJson(`/api/song/${cid}`);
  const info = { cid, name: d.name || '未命名', artist: (d.artistes && d.artistes.join(', ')) || d.artist || '塞壬唱片', sourceUrl: d.sourceUrl || '' };
  songCache.set(cid, info);
  return info;
}

// ---- 歌单存储（settings.music_playlist：JSON 数组） ----
function readPlaylist() {
  try { return JSON.parse(getSetting('music_playlist', '[]') || '[]'); } catch { return []; }
}
function writePlaylist(list) { setSetting('music_playlist', JSON.stringify(list)); }
function nextId(list) { return 'm' + (list.reduce((n, e) => Math.max(n, parseInt(String(e.id).replace(/\D/g, ''), 10) || 0), 0) + 1); }

// 首次使用：用《生命流》所在专辑铺底
async function ensurePlaylist() {
  let list = readPlaylist();
  if (list.length) return list;
  const seedCid = getSetting('msr_seed_album', '');
  if (!seedCid) return list;
  try {
    const d = await albumDetail(seedCid);
    list = (d.songs || []).map(s => ({ id: 'm' + s.cid, type: 'msr', cid: s.cid, name: s.name, artist: s.artist || '塞壬唱片' }));
    writePlaylist(list);
  } catch { /* 拿不到就留空 */ }
  return list;
}

// 歌单（CDN 播放地址不在此处解析——前端播放每首时会经 /msr/song/:cid 按需换取，
//  避免每次打开歌单都对全部曲目发起十几次外部请求）
router.get('/msr/playlist', async (req, res, next) => {
  try {
    const list = await ensurePlaylist();
    const songs = list.map(e => e.type === 'local'
      ? { ...e, url: '/files/' + e.path, album: '本地音乐' }
      : { ...e, url: '', album: e.album || '' });
    res.json({ songs, total: list.length });
  } catch (err) { next(err); }
});

// 搜索专辑（本地过滤，只请求一次专辑列表）
router.get('/msr/albums', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const list = await allAlbums();
    const hit = (q ? list.filter(a => (a.name || '').toLowerCase().includes(q)) : list).slice(0, 30);
    res.json({ albums: hit.map(a => ({ cid: a.cid, name: a.name, cover: a.coverUrl, artistes: a.artistes })) });
  } catch (err) { next(err); }
});

// 专辑曲目（供挑选添加）
router.get('/msr/album/:cid', async (req, res, next) => {
  try {
    const d = await albumDetail(req.params.cid);
    res.json({
      cid: req.params.cid,
      name: d.name,
      songs: (d.songs || []).map(s => ({ id: 'm' + s.cid, type: 'msr', cid: s.cid, name: s.name, artist: s.artist || '塞壬唱片', album: d.name })),
    });
  } catch (err) { next(err); }
});

// 添加歌曲到歌单（msr 曲目）
router.post('/msr/playlist', async (req, res) => {
  try {
    const items = Array.isArray(req.body.songs) ? req.body.songs : [req.body];
    const list = readPlaylist();
    let added = 0;
    for (const it of items) {
      if (!it || !it.cid || !it.name) continue;
      if (list.some(e => e.type === 'msr' && e.cid === it.cid)) continue; // 去重
      list.push({ id: 'm' + it.cid, type: 'msr', cid: it.cid, name: it.name, artist: it.artist || '塞壬唱片', album: it.album || '' });
      added += 1;
    }
    writePlaylist(list);
    res.json({ ok: true, added, total: list.length });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// 删除歌单条目
router.delete('/msr/playlist/:id', (req, res) => {
  const list = readPlaylist();
  const idx = list.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '歌单里没有这一条' });
  const [removed] = list.splice(idx, 1);
  writePlaylist(list);
  // 本地文件顺手删掉磁盘文件
  if (removed.type === 'local') {
    const abs = path.join(FILES_DIR, removed.path);
    if (abs.startsWith(FILES_DIR) && fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch { /* 占用则忽略 */ } }
  }
  res.json({ ok: true, total: list.length });
});

// 上传自己的音乐
router.post('/msr/upload', (req, res) => {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  let bb;
  try { bb = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: 60 * 1024 * 1024, files: 20 } }); }
  catch { return res.status(400).json({ error: '请求格式错误' }); }

  const added = [];
  const pending = [];
  bb.on('file', (name, stream, info) => {
    const orig = path.basename(info.filename || 'audio');
    const ext = path.extname(orig).toLowerCase();
    if (!AUDIO_EXT.includes(ext)) { stream.resume(); return; }
    const safe = orig.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100);
    const rel = path.join('music', `${Date.now()}_${safe}`).replace(/\\/g, '/');
    const abs = path.join(FILES_DIR, rel);
    const out = fs.createWriteStream(abs);
    stream.pipe(out);
    pending.push(new Promise((resolve) => {
      out.on('finish', () => {
        const list = readPlaylist();
        const entry = { id: nextId(list), type: 'local', path: rel, name: safe.replace(/\.[^.]+$/, ''), artist: '我的音乐' };
        list.push(entry);
        writePlaylist(list);
        added.push(entry);
        resolve();
      });
      out.on('error', () => { try { fs.unlinkSync(abs); } catch { /* 忽略 */ } resolve(); });
    }));
  });
  bb.on('close', async () => {
    await Promise.all(pending);
    if (!added.length) return res.status(400).json({ error: '没收到有效音频（支持 mp3 / m4a / flac / wav / ogg / aac）' });
    res.json({ ok: true, added, total: readPlaylist().length });
  });
  bb.on('error', () => res.status(400).json({ error: '上传出错' }));
  req.pipe(bb);
});

// 试听/播放地址
router.get('/msr/song/:cid', async (req, res, next) => {
  try { const d = await songDetail(req.params.cid); res.json({ ...d, url: d.sourceUrl }); } catch (err) { next(err); }
});

// 清空自定义歌单（恢复默认专辑铺底）
router.post('/msr/playlist/reset', async (req, res, next) => {
  try {
    writePlaylist([]);
    setSetting('msr_seed_album', '');
    // 清掉上传的本地音乐文件
    if (fs.existsSync(MUSIC_DIR)) for (const f of fs.readdirSync(MUSIC_DIR)) { try { fs.unlinkSync(path.join(MUSIC_DIR, f)); } catch { /* 忽略 */ } }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
