// 数据备份与恢复：导出整个 data/ 为 zip，或从 zip 恢复（覆盖当前数据，自动留安全备份）
const express = require('express');
const Busboy = require('busboy');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { db, DATA_DIR, FILES_DIR } = require('../db');

const router = express.Router();
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

// 导出：打包整个 data/ 目录（先做 WAL 检查点，保证数据库文件完整）
router.get('/backup', async (req, res) => {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    // zip 输出到 data 目录之外：tar 打包 data/ 时若输出文件也在其中，会把自己打包进去并出错
    const os = require('node:os');
    const zipPath = path.join(os.tmpdir(), 'fortomorrow-backup.zip');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    await execFileAsync(TAR, ['-a', '-c', '-f', zipPath, '--exclude', 'backup-*', '--exclude', 'restore-tmp', '-C', DATA_DIR, '.'], { timeout: 180000 });
    if (!fs.existsSync(zipPath)) throw new Error('打包失败');
    res.download(zipPath, `为了明日-备份-${stamp()}.zip`);
  } catch (err) { res.status(500).json({ error: '导出失败：' + err.message }); }
});

// 恢复：上传导出的 zip → 备份当前数据 → 覆盖恢复（数据库内容 + 打卡照片/音乐等文件）
router.post('/restore', (req, res) => {
  let bb;
  try { bb = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } }); }
  catch { return res.status(400).json({ error: '请求格式错误' }); }

  let zipPath = null;
  bb.on('file', (name, stream, info) => {
    if (!/\.zip$/i.test(info.filename || '')) { stream.resume(); return; }
    zipPath = path.join(DATA_DIR, 'restore-upload.zip');
    stream.pipe(fs.createWriteStream(zipPath));
  });
  bb.on('close', async () => {
    if (!zipPath || !fs.existsSync(zipPath)) return res.status(400).json({ error: '没有收到 zip 文件' });
    try {
      const restoreTmp = path.join(DATA_DIR, 'restore-tmp');
      fs.rmSync(restoreTmp, { recursive: true, force: true });
      fs.mkdirSync(restoreTmp, { recursive: true });
      await execFileAsync(TAR, ['-xf', zipPath, '-C', restoreTmp], { timeout: 300000 });
      if (!fs.existsSync(path.join(restoreTmp, 'studyhub.db'))) {
        fs.rmSync(restoreTmp, { recursive: true, force: true });
        return res.status(400).json({ error: '压缩包里没有找到 studyhub.db——请上传本应用导出的备份文件' });
      }

      // 安全网：先把当前数据完整备份一份
      const safetyDir = path.join(DATA_DIR, '..', 'backup-before-restore-' + stamp()); // 放 data 外，避免自嵌套
      fs.cpSync(DATA_DIR, safetyDir, { recursive: true, force: true });
      fs.rmSync(path.join(safetyDir, 'restore-upload.zip'), { force: true });
      fs.rmSync(path.join(safetyDir, 'restore-tmp'), { recursive: true, force: true });

      // 数据库内容恢复（ATTACH 上传的库，逐表替换；事务保证原子性）
      const tables = ['settings', 'subjects', 'chapters', 'tasks', 'task_images', 'study_logs', 'materials', 'download_jobs'];
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const restoreDb = path.join(restoreTmp, 'studyhub.db');
      db.exec(`ATTACH DATABASE '${restoreDb.replace(/'/g, "''")}' AS rsrc`);
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN');
      try {
        for (const t of [...tables].reverse()) db.exec(`DELETE FROM main.${t}`);
        for (const t of tables) {
          const srcTable = `rsrc.${t}`;
          const exists = db.prepare(`SELECT name FROM rsrc.sqlite_master WHERE type='table' AND name=?`).get(t);
          if (exists) db.exec(`INSERT INTO main.${t} SELECT * FROM ${srcTable}`);
        }
        for (const t of tables) {
          try { db.exec(`UPDATE main.sqlite_sequence SET seq = (SELECT MAX(id) FROM main.${t}) WHERE name = '${t}'`); } catch { /* 无自增记录则忽略 */ }
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      db.exec('PRAGMA foreign_keys = ON');
      db.exec('DETACH DATABASE rsrc');

      // 文件（打卡图/音乐/视频等）：用备份包里的 files/ 覆盖本地
      const srcFiles = path.join(restoreTmp, 'files');
      if (fs.existsSync(srcFiles)) {
        fs.rmSync(FILES_DIR, { recursive: true, force: true });
        fs.cpSync(srcFiles, FILES_DIR, { recursive: true });
      }

      fs.rmSync(restoreTmp, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
      res.json({ ok: true, note: '已恢复。恢复前的数据备份在 data/backup-before-restore-' + stamp() + '，确认无误后可删除' });
    } catch (err) {
      res.status(500).json({ error: '恢复失败：' + err.message + '（当前数据未受影响，安全备份在 data/backup-before-restore-*）' });
    }
  });
  bb.on('error', () => res.status(400).json({ error: '上传出错' }));
  req.pipe(bb);
});

module.exports = router;
