// 学习计划 API：科目 / 章节树 / 任务 / 学习记录 / 统计
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const Busboy = require('busboy');
const { db, FILES_DIR } = require('../db');

const router = express.Router();
const today = () => new Date().toLocaleDateString('sv'); // 本地时区 YYYY-MM-DD
const TASK_IMG_DIR = path.join(FILES_DIR, 'tasks');

// 给任务列表批量附加打卡图 + 用时（今日 / 累计）
function attachImages(rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const imgs = db.prepare(
    `SELECT id, task_id, rel_path, created_at FROM task_images
     WHERE task_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
  ).all(...ids);
  const map = {};
  for (const im of imgs) (map[im.task_id] = map[im.task_id] || []).push({ id: im.id, url: '/files/' + im.rel_path, created_at: im.created_at });

  const ph = ids.map(() => '?').join(',');
  const perTask = (where, args) => {
    const out = {};
    for (const r of db.prepare(
      `SELECT task_id, SUM(minutes) AS m FROM study_logs WHERE task_id IN (${ph}) ${where} GROUP BY task_id`
    ).all(...ids, ...args)) out[r.task_id] = r.m;
    return out;
  };
  const todayMap = perTask('AND log_date = ?', [today()]);
  const totalMap = perTask('', []);

  return rows.map(r => ({
    ...r,
    images: map[r.id] || [],
    minutes_today: todayMap[r.id] || 0,
    minutes_total: totalMap[r.id] || 0,
  }));
}

// 上传打卡图（支持多张）
router.post('/tasks/:id/images', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  fs.mkdirSync(TASK_IMG_DIR, { recursive: true });

  let bb;
  try { bb = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: 20 * 1024 * 1024, files: 9 } }); }
  catch { return res.status(400).json({ error: '请求格式错误' }); }

  const saved = [];
  const pending = [];
  bb.on('file', (name, stream, info) => {
    const ext = (path.extname(info.filename || '.jpg') || '.jpg').toLowerCase();
    if (!/\.(jpe?g|png|gif|webp)$/.test(ext)) { stream.resume(); return; }
    const rel = path.join('tasks', `${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`).replace(/\\/g, '/');
    const abs = path.join(FILES_DIR, rel);
    const out = fs.createWriteStream(abs);
    let size = 0;
    stream.on('data', d => { size += d.length; });
    stream.pipe(out);
    pending.push(new Promise((resolve) => {
      out.on('finish', () => {
        const info = db.prepare('INSERT INTO task_images (task_id, rel_path, file_size) VALUES (?, ?, ?)')
          .run(task.id, rel, size);
        saved.push({ id: Number(info.lastInsertRowid), url: '/files/' + rel, size });
        resolve();
      });
      out.on('error', () => { try { fs.unlinkSync(abs); } catch { /* 忽略 */ } resolve(); });
    }));
  });
  bb.on('close', async () => {
    await Promise.all(pending);
    if (!saved.length) return res.status(400).json({ error: '没有收到有效图片（支持 jpg/png/gif/webp）' });
    res.json({ ok: true, images: saved });
  });
  bb.on('error', () => res.status(400).json({ error: '上传出错' }));
  req.pipe(bb);
});

// 删除某张打卡图
router.delete('/tasks/images/:imgId', (req, res) => {
  const img = db.prepare('SELECT * FROM task_images WHERE id = ?').get(req.params.imgId);
  if (!img) return res.status(404).json({ error: '图片不存在' });
  db.prepare('DELETE FROM task_images WHERE id = ?').run(img.id);
  const abs = path.join(FILES_DIR, img.rel_path);
  if (abs.startsWith(FILES_DIR) && fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch { /* 文件占用时忽略 */ }
  }
  res.json({ ok: true });
});

// ---- 科目 ----
router.get('/subjects', (req, res) => {
  const subjects = db.prepare('SELECT * FROM subjects ORDER BY sort, id').all();
  const progress = db.prepare(`
    SELECT subject_id, COUNT(*) AS leaves, AVG(CASE WHEN status = 2 THEN 1.0 ELSE 0.0 END) AS pct
    FROM chapters
    WHERE id NOT IN (SELECT DISTINCT parent_id FROM chapters WHERE parent_id IS NOT NULL)
    GROUP BY subject_id
  `).all();
  const map = Object.fromEntries(progress.map(p => [p.subject_id, p]));
  res.json(subjects.map(s => ({
    ...s,
    leaf_count: map[s.id]?.leaves || 0,
    progress: map[s.id] ? Math.round(map[s.id].pct * 100) : 0,
  })));
});

router.post('/subjects', (req, res) => {
  const { name, color = '#4f6ef2' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '科目名称不能为空' });
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM subjects').get().m;
  const info = db.prepare('INSERT INTO subjects (name, color, sort) VALUES (?, ?, ?)').run(name.trim(), color, maxSort + 1);
  res.json(db.prepare('SELECT * FROM subjects WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/subjects/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '科目不存在' });
  const { name = s.name, color = s.color, sort = s.sort } = req.body;
  db.prepare('UPDATE subjects SET name = ?, color = ?, sort = ? WHERE id = ?').run(String(name).trim(), color, sort, s.id);
  res.json(db.prepare('SELECT * FROM subjects WHERE id = ?').get(s.id));
});

router.delete('/subjects/:id', (req, res) => {
  db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- 章节树 ----
router.get('/chapters', (req, res) => {
  if (!req.query.subject_id) return res.status(400).json({ error: '缺少 subject_id' });
  res.json(db.prepare('SELECT * FROM chapters WHERE subject_id = ? ORDER BY sort, id').all(req.query.subject_id));
});

router.post('/chapters', (req, res) => {
  const { subject_id, parent_id = null, title } = req.body;
  if (!subject_id || !title?.trim()) return res.status(400).json({ error: '缺少科目或标题' });
  const info = db.prepare('INSERT INTO chapters (subject_id, parent_id, title) VALUES (?, ?, ?)')
    .run(subject_id, parent_id, title.trim());
  res.json(db.prepare('SELECT * FROM chapters WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/chapters/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '章节不存在' });
  const { title = c.title, status = c.status, sort = c.sort, parent_id = c.parent_id } = req.body;
  if (Number(parent_id) === c.id) return res.status(400).json({ error: '不能把自己设为父章节' });
  db.prepare('UPDATE chapters SET title = ?, status = ?, sort = ?, parent_id = ? WHERE id = ?')
    .run(String(title).trim(), Number(status), sort, parent_id, c.id);
  res.json(db.prepare('SELECT * FROM chapters WHERE id = ?').get(c.id));
});

router.delete('/chapters/:id', (req, res) => {
  db.prepare('DELETE FROM chapters WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- 任务 ----
router.get('/tasks', (req, res) => {
  const view = req.query.view || 'today';
  const base = `SELECT t.*, s.name AS subject_name, s.color AS subject_color
                FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id`;
  let rows;
  if (view === 'done') {
    rows = db.prepare(`${base} WHERE t.status = 'done' ORDER BY t.completed_at DESC LIMIT 100`).all();
  } else if (view === 'week') {
    const end = new Date(); end.setDate(end.getDate() + 7);
    rows = db.prepare(`${base} WHERE t.status = 'todo' AND t.due_date IS NOT NULL AND t.due_date <= ? ORDER BY (t.priority = 2) DESC, t.due_date`)
      .all(end.toLocaleDateString('sv'));
  } else if (view === 'all') {
    rows = db.prepare(`${base} WHERE t.status = 'todo' ORDER BY (t.due_date IS NULL), t.due_date, (t.priority = 2) DESC`).all();
  } else {
    rows = db.prepare(`${base} WHERE t.status = 'todo' AND t.due_date IS NOT NULL AND t.due_date <= ? ORDER BY t.due_date, (t.priority = 2) DESC`)
      .all(today());
  }
  res.json(attachImages(rows));
});

router.post('/tasks', (req, res) => {
  const { title, subject_id = null, due_date = null, priority = 1, note = '' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: '任务内容不能为空' });
  const info = db.prepare('INSERT INTO tasks (title, subject_id, due_date, priority, note) VALUES (?, ?, ?, ?, ?)')
    .run(title.trim(), subject_id || null, due_date || null, Number(priority), note);
  res.json({ ...db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid), images: [], minutes_today: 0, minutes_total: 0 });
});

router.patch('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  const b = req.body;
  const status = b.status === 'done' ? 'done' : (b.status === 'todo' ? 'todo' : t.status);
  db.prepare(`UPDATE tasks SET title = ?, note = ?, due_date = ?, priority = ?, subject_id = ?, status = ?,
              completed_at = CASE WHEN ? = 'done' AND completed_at IS NULL THEN datetime('now','localtime')
                                  WHEN ? = 'todo' THEN NULL ELSE completed_at END
              WHERE id = ?`)
    .run(
      b.title !== undefined ? String(b.title).trim() : t.title,
      b.note !== undefined ? String(b.note) : t.note,
      b.due_date !== undefined ? (b.due_date || null) : t.due_date,
      b.priority !== undefined ? Number(b.priority) : t.priority,
      b.subject_id !== undefined ? (b.subject_id || null) : t.subject_id,
      status, status, status, t.id,
    );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
});

router.post('/tasks/:id/snooze', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(tomorrow.toLocaleDateString('sv'), t.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
});

router.delete('/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- 学习记录 ----
router.post('/logs', (req, res) => {
  const { subject_id = null, task_id = null, minutes, note = '', log_date = today() } = req.body;
  const m = Number(minutes);
  if (!m || m < 1 || m > 1440) return res.status(400).json({ error: '时长需在 1~1440 分钟之间' });
  const info = db.prepare('INSERT INTO study_logs (subject_id, task_id, minutes, note, log_date) VALUES (?, ?, ?, ?, ?)')
    .run(subject_id || null, task_id || null, Math.round(m), String(note), log_date);
  res.json(db.prepare('SELECT * FROM study_logs WHERE id = ?').get(info.lastInsertRowid));
});

router.get('/logs', (req, res) => {
  const { from = '', to = '', subject_id = '', task_id = '' } = req.query;
  let sql = `SELECT l.*, s.name AS subject_name, s.color AS subject_color, t.title AS task_title
             FROM study_logs l
             LEFT JOIN subjects s ON s.id = l.subject_id
             LEFT JOIN tasks t ON t.id = l.task_id
             WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND l.log_date >= ?'; params.push(from); }
  if (to) { sql += ' AND l.log_date <= ?'; params.push(to); }
  if (subject_id) { sql += ' AND l.subject_id = ?'; params.push(subject_id); }
  if (task_id) { sql += ' AND l.task_id = ?'; params.push(task_id); }
  sql += ' ORDER BY l.log_date DESC, l.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// ---- 统计（仪表盘） ----
router.get('/stats/weekly', (req, res) => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString('sv'));
  }
  const rows = db.prepare(
    `SELECT log_date, SUM(minutes) AS minutes FROM study_logs WHERE log_date >= ? GROUP BY log_date`
  ).all(days[0]);
  const map = Object.fromEntries(rows.map(r => [r.log_date, r.minutes]));
  res.json({
    week: days.map(d => ({ date: d, minutes: map[d] || 0 })),
    today_minutes: map[today()] || 0,
    today: today(),
  });
});

module.exports = router;
