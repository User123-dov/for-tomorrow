// yt-dlp 视频下载：可选组件。检测 tools/ 目录与 PATH，维护下载队列（最多2个并行），解析进度
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { db, FILES_DIR } = require('../db');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const VIDEOS_DIR = path.join(FILES_DIR, 'videos');

function probe(cmd, args = ['--version']) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { windowsHide: true }); }
    catch { return resolve(null); }
    let out = '';
    child.stdout?.on('data', d => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', code => resolve(code === 0 ? out.trim().split('\n')[0] : null));
    setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } resolve(null); }, 8000).unref?.();
  });
}

async function findYtDlp() {
  for (const p of [path.join(TOOLS_DIR, 'yt-dlp.exe'), path.join(TOOLS_DIR, 'yt-dlp')]) {
    if (fs.existsSync(p)) {
      const v = await probe(p);
      if (v) return { path: p, version: v };
    }
  }
  const v = await probe('yt-dlp');
  return v ? { path: 'yt-dlp', version: v } : null;
}

async function findFfmpeg() {
  for (const p of [path.join(TOOLS_DIR, 'ffmpeg.exe'), path.join(TOOLS_DIR, 'ffmpeg')]) {
    if (fs.existsSync(p)) return p;
  }
  const v = await probe('ffmpeg', ['-version']);
  return v ? 'ffmpeg' : null;
}

const running = new Map(); // jobId -> child
const queue = [];
let runningCount = 0;
const MAX_CONCURRENT = 2;

function updateJob(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE download_jobs SET ${sets} WHERE id = @id`).run({ ...fields, id });
}

function startNext() {
  if (runningCount >= MAX_CONCURRENT || queue.length === 0) return;
  const jobId = queue.shift();
  runningCount += 1;
  runJob(jobId).catch(err => {
    updateJob(jobId, { status: 'error', message: String(err.message || err) });
  }).finally(() => {
    runningCount -= 1;
    startNext();
  });
}

async function runJob(jobId) {
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId);
  if (!job) return;
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(job.material_id);
  if (!material) { updateJob(jobId, { status: 'error', message: '资料不存在' }); return; }

  const ytdlp = await findYtDlp();
  if (!ytdlp) { updateJob(jobId, { status: 'error', message: '未检测到 yt-dlp，请到 设置 页查看安装指引' }); return; }
  const ffmpeg = await findFfmpeg();

  updateJob(jobId, { status: 'running', progress: 0, message: '正在启动下载…' });
  const url = material.bvid ? `https://www.bilibili.com/video/${material.bvid}` : material.source_url;
  const args = [
    '--newline', '--no-playlist', '--no-mtime',
    '-f', ffmpeg ? 'bv*+ba/b' : 'b',
    ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
    '-o', path.join(VIDEOS_DIR, '%(id)s.%(ext)s'),
    '--print', 'after_move:filepath', '--no-simulate',
    url,
  ];

  const child = spawn(ytdlp.path, args, { windowsHide: true });
  running.set(jobId, child);
  let lastLines = [];
  const startedAt = Date.now();

  child.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n|\r/)) {
      if (!line.trim()) continue;
      lastLines.push(line);
      if (lastLines.length > 30) lastLines.shift();
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m) updateJob(jobId, { progress: Math.min(99.9, parseFloat(m[1])), message: line.trim().slice(0, 200) });
    }
  });
  child.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) lastLines.push('[stderr] ' + line);
    if (lastLines.length > 30) lastLines.shift();
  });

  await new Promise((resolve) => {
    child.on('error', (err) => { updateJob(jobId, { status: 'error', message: '启动失败：' + err.message }); resolve(); });
    child.on('close', (code) => {
      running.delete(jobId);
      if (code === 0) {
        // 优先用 --print 输出的最终文件路径；找不到则按时间扫描目录
        let filePath = '';
        for (const line of lastLines) {
          const t = line.trim();
          if (!t.startsWith('[') && !t.startsWith('WARNING') && fs.existsSync(t)) filePath = t;
        }
        if (!filePath) {
          const files = fs.readdirSync(VIDEOS_DIR).map(f => ({
            f, t: fs.statSync(path.join(VIDEOS_DIR, f)).mtimeMs,
          })).filter(x => x.t >= startedAt - 2000).sort((a, b) => b.t - a.t);
          if (files.length) filePath = path.join(VIDEOS_DIR, files[0].f);
        }
        if (filePath && fs.existsSync(filePath)) {
          const rel = path.relative(FILES_DIR, filePath).replace(/\\/g, '/');
          const size = fs.statSync(filePath).size;
          db.prepare('UPDATE materials SET local_path = ?, file_size = ? WHERE id = ?').run(rel, size, material.id);
          updateJob(jobId, { status: 'done', progress: 100, file_path: rel, message: '下载完成' });
        } else {
          updateJob(jobId, { status: 'error', message: '下载结束但未找到输出文件' });
        }
      } else {
        const errLine = [...lastLines].reverse().find(l => /ERROR|error/i.test(l)) || lastLines[lastLines.length - 1] || `退出码 ${code}`;
        updateJob(jobId, { status: 'error', message: String(errLine).slice(0, 500) });
      }
      resolve();
    });
  });
}

// 创建下载任务并进入队列
async function enqueue(materialId) {
  const info = db.prepare('INSERT INTO download_jobs (material_id) VALUES (?)').run(materialId);
  queue.push(Number(info.lastInsertRowid));
  startNext();
  return info.lastInsertRowid;
}

function cancel(jobId) {
  const child = running.get(jobId);
  if (child) { try { child.kill(); } catch { /* 已退出 */ } }
  updateJob(jobId, { status: 'error', message: '已取消' });
  const qi = queue.indexOf(jobId);
  if (qi >= 0) queue.splice(qi, 1);
}

module.exports = { findYtDlp, findFfmpeg, enqueue, cancel };
