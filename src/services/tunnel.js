// 手机远程访问：用系统自带 SSH 建立反向隧道，得到一个公网 https 地址，
// 手机浏览器直接打开即可，无需安装任何 App。serveo 优先，localhost.run 兜底。
const { spawn } = require('node:child_process');
const { getSetting } = require('../db');

let proc = null;
let pending = null;              // 启动阶段的服务商切换句柄
let state = { running: false, url: '', error: '', provider: '', startedAt: null };
const listeners = new Set();

function emit() { for (const fn of listeners) { try { fn({ ...state }); } catch { /* 忽略 */ } } }
const PORT = () => Number(process.env.PORT) || 5175;
// 隧道转发到「公网专口」，该端口永远要求密码（见 server.js）

// 隧道服务商及各自的地址格式
// localhost.run 没有浏览器提示页，体验最顺；serveo 兜底（免费版会先弹一次「Continue to Site」）
const PROVIDERS = [
  { name: 'localhost.run', host: 'nokey@localhost.run', re: /https:\/\/[a-z0-9-]+\.lhr\.life/i },
  { name: 'serveo', host: 'serveo.net', re: /https:\/\/[a-zA-Z0-9-]+\.serveousercontent\.com/i },
];

function stop() {
  if (pending) { clearTimeout(pending); pending = null; }
  if (proc) { try { proc.kill(); } catch { /* 已退出 */ } proc = null; }
  state = { running: false, url: '', error: state.error, provider: '', startedAt: null };
  emit();
}

function fail(msg) {
  if (pending) { clearTimeout(pending); pending = null; }
  if (proc) { try { proc.kill(); } catch { /* 已退出 */ } proc = null; }
  state = { ...state, running: false, url: '', error: msg };
  emit();
}

function spawnTunnel(index) {
  const provider = PROVIDERS[index];
  const child = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ConnectTimeout=15',
    '-R', '80:127.0.0.1:' + (PORT() + 1),
    provider.host,
  ], { windowsHide: true });
  proc = child;

  // 该服务商超时未给地址 → 换下一个
  pending = setTimeout(() => {
    pending = null;
    try { child.kill(); } catch { /* 已退出 */ }
    if (index + 1 < PROVIDERS.length) {
      proc = null;
      spawnTunnel(index + 1);
    } else {
      fail('隧道建立超时（两个服务商都没响应），请检查网络后重试');
    }
  }, 25000);

  const onData = (buf) => {
    const text = buf.toString();
    if (state.url) return;
    const m = provider.re.exec(text);
    if (m) {
      if (pending) { clearTimeout(pending); pending = null; }
      state = { running: true, url: m[0], error: '', provider: provider.name, startedAt: state.startedAt || Date.now() };
      emit();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => {
    if (pending) { clearTimeout(pending); pending = null; }
    if (e.code === 'ENOENT') return fail('系统未找到 ssh 命令（Windows 10/11 自带，请在「设置 → 应用 → 可选功能」里安装 OpenSSH 客户端）');
    if (index + 1 < PROVIDERS.length) { proc = null; spawnTunnel(index + 1); }
    else fail('启动失败：' + e.message);
  });
  child.on('close', () => {
    if (pending) return;           // 启动阶段退出，交给 fallback 处理
    if (!state.url) return;
    proc = null;
    state = { ...state, running: false, url: '' };
    emit();
  });
}

function start() {
  if (proc) return { ...state };
  if (!getSetting('access_password', '')) {
    state = { ...state, running: false, url: '', error: '请先在「访问密码」中设置密码 —— 公网地址任何人都可能打开，必须先加锁' };
    emit();
    return { ...state };
  }
  state = { running: false, url: '', error: '', provider: '', startedAt: Date.now() };
  emit();
  spawnTunnel(0);
  return { ...state };
}

function status() { return { ...state }; }

// ---- 二维码 ----
let QRCode = null;
try { QRCode = require('qrcode'); } catch { /* 未安装则前端不显示二维码 */ }

async function qrDataUrl(text) {
  if (!QRCode || !text) return '';
  try {
    return await QRCode.toDataURL(text, { margin: 1, width: 300, color: { dark: '#0b0d12', light: '#ffffff' } });
  } catch { return ''; }
}

process.on('exit', () => { if (proc) { try { proc.kill(); } catch { /* 忽略 */ } } });

module.exports = { start, stop, status, qrDataUrl };
