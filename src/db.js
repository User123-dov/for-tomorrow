// 数据库层：基于 Node 24 内置 node:sqlite，零原生依赖
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
for (const dir of [DATA_DIR, FILES_DIR, path.join(FILES_DIR, 'uploads'), path.join(FILES_DIR, 'downloads'), path.join(FILES_DIR, 'videos')]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new DatabaseSync(path.join(DATA_DIR, 'studyhub.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4f6ef2',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,  -- 0未学 1学习中 2已掌握
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  due_date TEXT,                      -- YYYY-MM-DD，空=无截止
  priority INTEGER NOT NULL DEFAULT 1, -- 0低 1中 2高
  status TEXT NOT NULL DEFAULT 'todo', -- todo / done
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS study_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  minutes INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  log_date TEXT NOT NULL,             -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                 -- link / article / file / video
  title TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  local_path TEXT NOT NULL DEFAULT '',  -- 相对 data/files 的路径
  file_size INTEGER NOT NULL DEFAULT 0,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '',        -- 逗号分隔
  note TEXT NOT NULL DEFAULT '',
  -- 视频扩展字段
  bvid TEXT NOT NULL DEFAULT '',
  up_name TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL DEFAULT 0, -- 秒
  pages TEXT NOT NULL DEFAULT '[]',    -- B站分P列表 [{page,part,duration}]
  watch_status TEXT NOT NULL DEFAULT 'unwatched', -- unwatched / watching / watched
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_materials_type ON materials(type);
CREATE INDEX IF NOT EXISTS idx_materials_subject ON materials(subject_id);

CREATE TABLE IF NOT EXISTS download_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending / running / done / error
  progress REAL NOT NULL DEFAULT 0,       -- 0~100
  message TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 任务打卡配图：完成/进行中的任务可以附上图片（笔记、进度、计时截图等）
CREATE TABLE IF NOT EXISTS task_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,                 -- 相对 data/files 的路径
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_task_images_task ON task_images(task_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

// ---- 兼容旧库：给 study_logs 补 task_id 列（计时器可归属到具体任务） ----
const logCols = db.prepare('PRAGMA table_info(study_logs)').all().map(c => c.name);
if (!logCols.includes('task_id')) {
  db.exec('ALTER TABLE study_logs ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL');
}

// ---- 种子数据 ----
function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

if (db.prepare('SELECT COUNT(*) AS n FROM subjects').get().n === 0) {
  const insert = db.prepare('INSERT INTO subjects (name, color, sort) VALUES (?, ?, ?)');
  insert.run('数学', '#4f6ef2', 0);
  insert.run('英语', '#e8590c', 1);
  insert.run('政治', '#0ca678', 2);
  insert.run('专业课', '#9c36b5', 3);
}

if (getSetting('exam_date') === '') {
  setSetting('exam_date', '2026-12-19'); // 2027 考研初试（可在设置中修改）
}
if (getSetting('site_cookies') === '') {
  setSetting('site_cookies', '[]'); // [{host, cookie}]
}
if (getSetting('access_password') === '') {
  setSetting('access_password', ''); // 空=不启用访问密码（仅本机）；设置后局域网访问需输入
}

module.exports = { db, DATA_DIR, FILES_DIR, getSetting, setSetting };
