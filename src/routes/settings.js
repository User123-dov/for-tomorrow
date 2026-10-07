// 设置 API：考研日期 / 站点 Cookie / 访问密码 / yt-dlp 状态 / Cookie 连通性测试
const express = require('express');
const { getSetting, setSetting } = require('../db');
const { fetchPage } = require('../services/fetcher');
const ytdlp = require('../services/ytdlp');

const router = express.Router();

// 本机可访问地址（含 Windows ipconfig 兜底，能识别有线/无线/Tailscale）
const { listLocalAddresses } = require('../services/netinfo');

router.get('/settings', async (req, res, next) => {
  try {
    const withTools = req.query.check === '1';
    const yt = withTools ? await ytdlp.findYtDlp() : null;
    const ffmpeg = withTools ? await ytdlp.findFfmpeg() : null;
    const lan_addresses = await listLocalAddresses();
    res.json({
      exam_date: getSetting('exam_date', ''),
      wallpaper_set: require('node:fs').existsSync(require('node:path').join(FILES_DIR, 'home-bg.jpg')),
      access_password_set: getSetting('access_password', '') !== '',
      site_cookies: JSON.parse(getSetting('site_cookies', '[]') || '[]'),
      lan_addresses: lan_addresses.map(a => ({ ip: a.ip, kind: a.kind, adapter: a.adapter })),
      ytdlp: yt,
      ffmpeg: ffmpeg,
    });
  } catch (err) { next(err); }
});

router.put('/settings', (req, res) => {
  const { exam_date, access_password } = req.body;
  if (exam_date !== undefined) setSetting('exam_date', exam_date || '');
  if (access_password !== undefined) setSetting('access_password', String(access_password || '').trim());
  res.json({ ok: true });
});

router.put('/settings/cookies', (req, res) => {
  const list = Array.isArray(req.body.cookies) ? req.body.cookies : null;
  if (!list) return res.status(400).json({ error: '格式错误，需要 cookies 数组' });
  const clean = list
    .map(c => ({ host: String(c.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), cookie: String(c.cookie || '').trim() }))
    .filter(c => c.host && c.cookie);
  setSetting('site_cookies', JSON.stringify(clean));
  res.json({ ok: true, cookies: clean });
});

// 用当前配置的 Cookie 试抓一个页面，验证是否登录生效
router.post('/settings/test-cookie', async (req, res, next) => {
  try {
    const { url } = req.body;
    const target = String(url || '').trim();
    if (!target) return res.status(400).json({ error: '请填写要测试的页面地址' });
    const page = await fetchPage(/^https?:\/\//i.test(target) ? target : 'https://' + target, { timeoutMs: 15000 });
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(page.text || '')?.[1]?.trim() || '';
    const needLogin = /登录|login|passport|验证码/i.test(title) || /id="login"|class="login"/i.test(page.text || '');
    res.json({ ok: page.status === 200, status: page.status, finalUrl: page.finalUrl, title, maybe_need_login: needLogin });
  } catch (err) { next(err); }
});

// ---- 手机远程访问（SSH 反向隧道） ----
const tunnel = require('../services/tunnel');

router.get('/tunnel/status', async (req, res) => {
  const st = tunnel.status();
  res.json({ ...st, qr: st.url ? await tunnel.qrDataUrl(st.url) : '' });
});

router.post('/tunnel/start', async (req, res) => {
  const st = tunnel.start();
  // 等待最多 25 秒拿到地址
  const deadline = Date.now() + 25000;
  while (!tunnel.status().url && !tunnel.status().error && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
  }
  const now = tunnel.status();
  res.json({ ...now, qr: now.url ? await tunnel.qrDataUrl(now.url) : '' });
});

router.post('/tunnel/stop', (req, res) => {
  tunnel.stop();
  res.json({ ok: true });
});

// ---- 主菜单壁纸：上传 / 恢复默认 ----
const Busboy = require('busboy');
const fs = require('node:fs');
const path = require('node:path');
const { FILES_DIR } = require('../db');
const WALLPAPER = path.join(FILES_DIR, 'home-bg.jpg');

router.get('/wallpaper', (req, res) => {
  res.json({ set: fs.existsSync(WALLPAPER) });
});

router.post('/wallpaper', (req, res) => {
  let bb;
  try { bb = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: 20 * 1024 * 1024, files: 1 } }); }
  catch { return res.status(400).json({ error: '请求格式错误' }); }
  let got = false;
  bb.on('file', (name, stream, info) => {
    if (!/^image\//.test(info.mimeType)) { stream.resume(); return; }
    const out = fs.createWriteStream(WALLPAPER); // 统一存为 home-bg.jpg，前端直接引用
    stream.pipe(out);
    out.on('finish', () => { got = true; });
    out.on('error', () => { got = false; });
  });
  bb.on('close', () => {
    if (!got) return res.status(400).json({ error: '没有收到有效图片' });
    res.json({ ok: true, set: true });
  });
  bb.on('error', () => res.status(400).json({ error: '上传出错' }));
  req.pipe(bb);
});

router.delete('/wallpaper', (req, res) => {
  if (fs.existsSync(WALLPAPER)) { try { fs.unlinkSync(WALLPAPER); } catch { /* 忽略 */ } }
  res.json({ ok: true, set: false });
});

module.exports = router;

// ---- 安卓手机版：Termux 一键安装命令（二维码给手机扫） ----
router.get('/termux/qr', async (req, res) => {
  try {
    // 一条命令完成：装环境 → 授权存储 → 找到最新下载的仓库ZIP → 解压 → 运行安装脚本
    const cmd = [
      'pkg install -y unzip nodejs-lts',
      'termux-setup-storage',
      'sleep 4',
      'Z=$(ls -t /sdcard/Download/*for-tomorrow*.zip 2>/dev/null | head -1)',
      'rm -rf ~/ft-tmp && mkdir -p ~/ft-tmp',
      'unzip -q -o "$Z" -d ~/ft-tmp',
      'cd ~/ft-tmp',
      'D=$(dirname "$(find . -name termux-install.sh | head -1)")',
      'cd "$D"',
      'bash termux-install.sh',
    ].join(' && ');
    const qr = await tunnel.qrDataUrl(cmd);
    res.json({ cmd, qr });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
