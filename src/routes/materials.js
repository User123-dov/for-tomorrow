// 资料库 API：列表/详情/编辑/删除 + 文件上传
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const Busboy = require('busboy');
const { db, FILES_DIR } = require('../db');

const router = express.Router();

const LIST_COLS = `id, type, title, source_url, site, cover_url, summary, local_path, file_size,
                   subject_id, tags, note, bvid, up_name, duration, watch_status, created_at`;

router.get('/materials', (req, res) => {
  const { type = '', subject_id = '', tag = '', q = '' } = req.query;
  const limit = Math.min(200, Number(req.query.limit) || 100);
  const offset = Number(req.query.offset) || 0;
  let sql = `SELECT ${LIST_COLS} FROM materials WHERE 1=1`;
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (subject_id) { sql += ' AND subject_id = ?'; params.push(subject_id); }
  if (tag) { sql += " AND (',' || tags || ',') LIKE ?"; params.push(`%,${tag},%`); }
  if (q) {
    sql += ' AND (title LIKE ? OR summary LIKE ? OR note LIKE ? OR tags LIKE ? OR content_text LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/materials/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '资料不存在' });
  res.json(row);
});

router.patch('/materials/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: '资料不存在' });
  const b = req.body;
  db.prepare(`UPDATE materials SET title = ?, note = ?, tags = ?, subject_id = ?, watch_status = ? WHERE id = ?`)
    .run(
      b.title !== undefined ? String(b.title).trim() : m.title,
      b.note !== undefined ? String(b.note) : m.note,
      b.tags !== undefined ? String(b.tags).split(/[,，\s]+/).filter(Boolean).join(',') : m.tags,
      b.subject_id !== undefined ? (b.subject_id || null) : m.subject_id,
      b.watch_status !== undefined ? b.watch_status : m.watch_status,
      m.id,
    );
  res.json(db.prepare('SELECT * FROM materials WHERE id = ?').get(m.id));
});

router.delete('/materials/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: '资料不存在' });
  db.prepare('DELETE FROM materials WHERE id = ?').run(m.id);
  if (m.local_path) {
    const abs = path.join(FILES_DIR, m.local_path);
    if (abs.startsWith(FILES_DIR) && fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch { /* 文件被占用时忽略 */ }
    }
  }
  res.json({ ok: true });
});

// 直接创建条目（不抓取网页）：论文收藏、目标院校链接等
router.post('/materials', (req, res) => {
  const { type = 'link', title, source_url = '', summary = '', tags = '', note = '', subject_id = null } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: '标题不能为空' });
  if (source_url && !/^(https?:\/\/|\/)/i.test(source_url)) return res.status(400).json({ error: '网址格式无效' });
  const info = db.prepare(`INSERT INTO materials (type, title, source_url, site, summary, subject_id, tags, note)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      ['link', 'article'].includes(type) ? type : 'link',
      title.trim(),
      String(source_url),
      (() => { try { return new URL(source_url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
      String(summary).slice(0, 2000),
      subject_id || null,
      String(tags).split(/[,，\s]+/).filter(Boolean).join(','),
      String(note),
    );
  res.json(db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid));
});

// 文件上传（PDF/文档等）
router.post('/upload', (req, res) => {
  let bb;
  try { bb = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: 500 * 1024 * 1024 } }); }
  catch { return res.status(400).json({ error: '请求格式错误，请用表单上传' }); }

  const fields = {};
  let fileInfo = null;
  const done = new Promise((resolve) => {
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const orig = path.basename(info.filename || 'file');
      const safe = orig.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'file';
      const rel = path.join('uploads', `${Date.now()}_${safe}`).replace(/\\/g, '/');
      const abs = path.join(FILES_DIR, rel);
      const out = fs.createWriteStream(abs);
      let size = 0;
      stream.on('data', d => { size += d.length; });
      stream.pipe(out);
      out.on('finish', () => { fileInfo = { rel, size, safe }; });
      out.on('error', () => { fileInfo = null; });
    });
    bb.on('close', resolve);
    bb.on('error', resolve);
  });
  req.pipe(bb);
  done.then(() => {
    if (!fileInfo) return res.status(400).json({ error: '未收到文件或保存失败' });
    const info = db.prepare(`
      INSERT INTO materials (type, title, source_url, local_path, file_size, subject_id, tags, summary)
      VALUES ('file', ?, '', ?, ?, ?, ?, ?)
    `).run(
      fileInfo.safe, fileInfo.rel, fileInfo.size,
      fields.subject_id || null,
      String(fields.tags || '').split(/[,，\s]+/).filter(Boolean).join(','),
      `本地上传（${(fileInfo.size / 1024 / 1024).toFixed(1)} MB）`,
    );
    res.json(db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid));
  });
});

module.exports = router;
