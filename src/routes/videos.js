// 视频库 + 下载队列 API
const express = require('express');
const { db } = require('../db');
const { captureUrl, detectType } = require('../services/crawler');
const ytdlp = require('../services/ytdlp');

const router = express.Router();

const LIST_COLS = `id, type, title, source_url, site, cover_url, summary, local_path, file_size,
                   subject_id, tags, note, bvid, up_name, duration, pages, watch_status, created_at`;

router.get('/videos', (req, res) => {
  const { subject_id = '', q = '' } = req.query;
  let sql = `SELECT ${LIST_COLS} FROM materials WHERE type = 'video'`;
  const params = [];
  if (subject_id) { sql += ' AND subject_id = ?'; params.push(subject_id); }
  if (q) { sql += ' AND (title LIKE ? OR up_name LIKE ? OR tags LIKE ?)'; const like = `%${q}%`; params.push(like, like, like); }
  sql += ' ORDER BY id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...params));
});

// 添加视频：粘贴任意视频链接，自动识别 B站/YouTube
router.post('/videos', async (req, res, next) => {
  try {
    const { url, subject_id = null, tags = '' } = req.body;
    const normalized = String(url || '').trim();
    if (!normalized) return res.status(400).json({ error: '请粘贴视频链接' });
    if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
    if (detectType(normalized) !== 'video') {
      return res.status(400).json({ error: '这不是视频链接。文章/文件请在「采集中心」页保存' });
    }
    const material = await captureUrl(normalized, { subjectId: subject_id, tags });
    res.json(material);
  } catch (err) { next(err); }
});

// 下载任务
router.post('/videos/:id/download', async (req, res, next) => {
  try {
    const m = db.prepare("SELECT * FROM materials WHERE id = ? AND type = 'video'").get(req.params.id);
    if (!m) return res.status(404).json({ error: '视频不存在' });
    const ytdlpInfo = await ytdlp.findYtDlp();
    if (!ytdlpInfo) {
      return res.status(400).json({ error: '未检测到 yt-dlp。请到「设置」页查看安装指引：下载 yt-dlp.exe 放入 tools 文件夹' });
    }
    const active = db.prepare("SELECT COUNT(*) AS n FROM download_jobs WHERE material_id = ? AND status IN ('pending','running')").get(m.id).n;
    if (active) return res.status(400).json({ error: '该视频已在下载队列中' });
    const jobId = await ytdlp.enqueue(m.id);
    res.json({ ok: true, job_id: jobId });
  } catch (err) { next(err); }
});

router.get('/videos/jobs', (req, res) => {
  const jobs = db.prepare(`
    SELECT j.*, m.title AS material_title, m.cover_url AS material_cover
    FROM download_jobs j JOIN materials m ON m.id = j.material_id
    ORDER BY j.id DESC LIMIT 20
  `).all();
  res.json(jobs);
});

router.post('/videos/jobs/:id/cancel', (req, res) => {
  ytdlp.cancel(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
