// 共享状态 / API 封装 / 工具函数
const { reactive } = Vue;

export const store = reactive({
  route: { view: 'dashboard', query: {} },
  subjects: [],
  toasts: [],
  checkin: { task: null, onChanged: null },
  // 学习计时器（全局，仪表盘 + 计划页共用）
  timer: { running: false, taskId: null, taskTitle: '', subjectId: null, baseSeconds: 0, startedAt: null },
  tick: 0, // 每秒自增，驱动计时显示刷新
  theme: {
    base: localStorage.getItem('yt_base') || 'dark',
    accent: localStorage.getItem('yt_accent') || 'cyan',
  },
});

// 打开任务打卡对话框（仪表盘 / 计划页共用）
export function openCheckin(task, onChanged = null) {
  store.checkin.task = task;
  store.checkin.onChanged = onChanged;
}

// ---- 全局学习计时器：可归属到某个任务，仪表盘和计划页共用 ----
export function timerElapsedSeconds() {
  const t = store.timer;
  return t.baseSeconds + (t.running && t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0);
}
export function startTimer({ taskId = null, taskTitle = '', subjectId = null } = {}) {
  const t = store.timer;
  if (t.running) return;
  if (taskId !== null) { t.taskId = taskId; t.taskTitle = taskTitle; }
  if (subjectId !== null) t.subjectId = subjectId;
  t.startedAt = Date.now();
  t.running = true;
}
export function pauseTimer() {
  const t = store.timer;
  if (!t.running) return;
  t.baseSeconds = timerElapsedSeconds();
  t.startedAt = null;
  t.running = false;
}
export function resetTimer() {
  const t = store.timer;
  t.running = false;
  t.startedAt = null;
  t.baseSeconds = 0;
}
// 结束并记录：把本次时长写入学习记录（带任务归属）
export async function finishTimer({ refresh = null } = {}) {
  const t = store.timer;
  const minutes = Math.round(timerElapsedSeconds() / 60);
  const taskId = t.taskId;
  const taskTitle = t.taskTitle;
  const subjectId = t.subjectId;
  resetTimer();
  if (minutes < 1) return { minutes: 0, taskTitle };
  await api('/logs', { method: 'POST', body: { minutes, task_id: taskId, subject_id: subjectId, note: taskTitle ? '计时：' + taskTitle : '计时记录' } });
  if (refresh) refresh();
  return { minutes, taskTitle };
}

export function fmtMinutes(m) {
  m = Math.round(Number(m) || 0);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + 'h' + r + 'm' : h + 'h';
}

export function setThemeBase(b) {
  store.theme.base = b;
  localStorage.setItem('yt_base', b);
  document.body.dataset.base = b;
}
export function setThemeAccent(a) {
  store.theme.accent = a;
  localStorage.setItem('yt_accent', a);
  document.body.dataset.accent = a;
}

export async function api(path, opts = {}) {
  const init = { ...opts };
  if (init.body && !(init.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  const res = await fetch('/api' + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('请求失败（' + res.status + '）'));
  return data;
}

export function toast(msg, type = 'info') {
  const id = Date.now() + Math.random();
  store.toasts.push({ id, msg, type });
  setTimeout(() => { const i = store.toasts.findIndex(t => t.id === id); if (i >= 0) store.toasts.splice(i, 1); }, 3200);
}

export async function loadSubjects() {
  try { store.subjects = await api('/subjects'); } catch { /* 启动时网络错误则下次再取 */ }
}

export function navigate(view, query = {}) {
  const qs = Object.entries(query).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  location.hash = '#/' + view + (qs ? '?' + qs : '');
}

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { view: path || 'home', query };
}

export function fmtDuration(sec) {
  sec = Math.round(Number(sec) || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}

export function fmtSize(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('sv');
}

export const TYPE_META = {
  article: { icon: '📄', label: '文章', bg: '#eef1ff' },
  link:    { icon: '🔗', label: '链接', bg: '#f0f4f8' },
  file:    { icon: '📎', label: '文件', bg: '#fdf0e7' },
  video:   { icon: '🎬', label: '视频', bg: '#fdeef2' },
};
