// 为了明日 · 考研学习终端 — 服务器入口
const express = require('express');
const http = require('node:http');
const compression = require('compression');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const { exec } = require('node:child_process');
const { getSetting, FILES_DIR } = require('./src/db');

const app = express();
const PORT = Number(process.env.PORT) || 5175;
// 手机远程访问（SSH 隧道）专用端口：只监听本机，且永远要求密码
const PUBLIC_PORT = PORT + 1;

// gzip 压缩：JS/CSS/HTML 传输体积大幅减小（隧道或手机访问时明显更快）
app.use(compression({ threshold: 512 }));
app.use(express.json({ limit: '2mb' }));

// 极简 cookie 解析（只用到 ftm_token）
app.use((req, res, next) => {
  req.cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]),
  );
  next();
});

// ---- 局域网访问密码（本机 127.0.0.1 永远放行） ----
const tokenOf = (pwd) => crypto.createHash('sha256').update('fortomorrow-hub|' + pwd).digest('hex');
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
// 经公网专口进来的请求（隧道转发）即使源地址是 127.0.0.1 也按外部处理
const isPublicPort = (req) => req.socket.localPort === PUBLIC_PORT;
const isLocal = (req) => isLoopback(req) && !isPublicPort(req);

app.use((req, res, next) => {
  const pwd = getSetting('access_password', '');
  if (isPublicPort(req) && !pwd) {
    // 公网专口必须设密码，未设则直接拒绝（防止裸奔）
    return res.status(403).send('远程访问需要先在电脑上设置访问密码');
  }
  if (!pwd || isLocal(req)) return next();

  // 已通过验证的请求：/login 直接回首页，其余放行（必须放在 /login 分支之前，否则登录后无限停留）
  const authed = req.cookies?.ftm_token === tokenOf(pwd) || req.query.token === tokenOf(pwd);
  if (authed) {
    if (req.path === '/login') return res.redirect('/');
    return next();
  }

  if (req.path === '/login') return res.send(LOGIN_HTML);
  if (req.path === '/api/auth' && req.method === 'POST') {
    if (String(req.body.password || '') === pwd) {
      res.setHeader('Set-Cookie', `ftm_token=${tokenOf(pwd)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
      return res.json({ ok: true });
    }
    return res.status(401).json({ error: '密码不正确' });
  }
  if (req.cookies?.ftm_token === tokenOf(pwd) || req.query.token === tokenOf(pwd)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '需要访问密码' });
  return res.redirect('/login');
});

const LOGIN_HTML = `<!doctype html><html lang="zh"><meta charset="utf-8">
<title>为了明日 · 访问验证</title>
<body style="font-family:'Source Han Sans CN','Microsoft YaHei',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b0d12">
<div style="background:#151924;border:1px solid #262d3b;padding:40px 48px;text-align:center;clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px))">
<div style="font-size:11px;letter-spacing:3px;color:#8792a6;font-family:Consolas,monospace;margin-bottom:6px">FOR TOMORROW TERMINAL</div>
<h2 style="margin:0 0 4px;color:#e8ecf4;letter-spacing:2px">// 为了明日</h2>
<p style="color:#8792a6;margin:0 0 18px;font-size:13px">此站点已开启访问密码验证，请输入</p>
<form onsubmit="fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:this.pw.value})}).then(r=>r.ok?location.replace('/'):alert('密码不正确'));return false">
<input name="pw" type="password" placeholder="访问密码" style="padding:10px 14px;border:1px solid #262d3b;background:#0d1017;color:#e8ecf4;font-size:15px;outline:none;width:180px" autofocus>
<button style="padding:10px 20px;border:1px solid #3fc1ff;background:#3fc1ff;color:#0b0d12;font-size:14px;font-weight:700;cursor:pointer;margin-left:8px">进入</button>
</form></div></body></html>`;

// ---- 静态资源 ----
// 字体 / 图标 / vue 运行时很少变：长缓存，减少重复传输（隧道下尤其明显）
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), { maxAge: '30d', immutable: true }));
app.use('/icons', express.static(path.join(__dirname, 'public', 'icons'), { maxAge: '30d', immutable: true }));
// 其余（页面/脚本/样式）：no-cache，改完即生效
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.get('/vendor/vue.js', (req, res) => {
  const vueDist = path.join(__dirname, 'node_modules', 'vue', 'dist', 'vue.global.prod.js');
  if (!fs.existsSync(vueDist)) return res.status(404).end('vue 未安装，请先 npm install');
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  res.type('application/javascript').end(fs.readFileSync(vueDist));
});
app.use('/files', express.static(FILES_DIR, { maxAge: '1d', acceptRanges: true }));

// ---- API 路由 ----
app.use('/api', require('./src/routes/plans'));
app.use('/api', require('./src/routes/materials'));
app.use('/api', require('./src/routes/videos'));
app.use('/api', require('./src/routes/capture'));
app.use('/api', require('./src/routes/settings'));
app.use('/api', require('./src/routes/lingxian'));
app.use('/api', require('./src/routes/papers'));
app.use('/api', require('./src/routes/search'));
app.use('/api', require('./src/routes/msr'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---- 统一错误处理 ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  const lans = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) {
        // Tailscale 虚拟网卡使用 100.64.0.0/10 段
        const m = /^100\.(\d+)\./.exec(net.address);
        const kind = m && Number(m[1]) >= 64 && Number(m[1]) <= 127 ? 'tailscale' : 'lan';
        lans.push({ ip: net.address, kind });
      }
    }
  }
  console.log('');
  console.log('  为了明日 · 考研学习终端 已启动');
  console.log('  本机访问：   http://localhost:' + PORT);
  for (const { ip, kind } of lans) {
    const tag = kind === 'tailscale' ? 'Tailscale 远程访问（任何网络）' : '局域网访问（同一WiFi，手机用）';
    console.log(`  ${tag}： http://${ip}:${PORT}`);
  }
  console.log('  数据保存在 data/ 文件夹，备份直接复制即可；Ctrl+C 退出');
  console.log('');
  if (process.env.OPEN_BROWSER === '1' && process.platform === 'win32') {
    exec(`start http://localhost:${PORT}`);
  }
});

// 手机远程访问专用端口：独立实例，只绑本机回环，由 SSH 隧道转发进入，永远校验密码
const publicServer = http.createServer(app);
publicServer.on('error', (err) => {
  console.error('[远程访问端口] 启动失败：' + err.message + '（不影响本机使用）');
});
publicServer.listen(PUBLIC_PORT, '127.0.0.1');

// 捕获未处理的异步错误，避免进程崩溃
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

function shutdown() {
  try { publicServer.close(); } catch { /* 忽略 */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
