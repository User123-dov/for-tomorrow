// 设置：考研日期 / 科目 / 站点 Cookie / 局域网 / yt-dlp
import { store, api, toast, loadSubjects, setThemeBase, setThemeAccent } from '../store.js';

const { ref, reactive, onMounted } = Vue;

export default {
  setup() {
    const settings = ref({});
    const examDate = ref('');
    const password = ref('');
    const toolInfo = ref(null);

    // 科目编辑
    const editingSubjects = reactive({});
    const newName = ref('');
    const newColor = ref('#4f6ef2');

    // 站点 Cookie
    const cookies = ref([]);
    const newCookie = reactive({ host: '', cookie: '' });
    const testing = ref('');
    const testResult = ref(null);

    async function load(checkTools = false) {
      settings.value = await api('/settings' + (checkTools ? '?check=1' : ''));
      examDate.value = settings.value.exam_date || '';
      cookies.value = (settings.value.site_cookies || []).map(c => ({ ...c }));
      if (checkTools) toolInfo.value = { ytdlp: settings.value.ytdlp, ffmpeg: settings.value.ffmpeg };
    }

    async function saveExam() {
      await api('/settings', { method: 'PUT', body: { exam_date: examDate.value } });
      toast('考研日期已保存', 'ok');
    }
    async function savePassword() {
      await api('/settings', { method: 'PUT', body: { access_password: password.value } });
      password.value = '';
      await load();
      toast(settings.value.access_password_set ? '访问密码已开启，手机首次访问需输入' : '访问密码已关闭', 'ok');
    }

    async function addSubject() {
      if (!newName.value.trim()) return;
      await api('/subjects', { method: 'POST', body: { name: newName.value, color: newColor.value } });
      newName.value = '';
      await loadSubjects();
      toast('科目已添加', 'ok');
    }
    async function saveSubject(s) {
      const e = editingSubjects[s.id];
      await api('/subjects/' + s.id, { method: 'PATCH', body: { name: e?.name || s.name, color: e?.color || s.color } });
      delete editingSubjects[s.id];
      await loadSubjects();
      toast('已保存', 'ok');
    }
    async function delSubject(s) {
      if (!confirm('删除科目「' + s.name + '」？章节树会一并删除')) return;
      await api('/subjects/' + s.id, { method: 'DELETE' });
      await loadSubjects();
      load();
    }

    async function saveCookies() {
      await api('/settings/cookies', { method: 'PUT', body: { cookies: cookies.value } });
      toast('Cookie 配置已保存', 'ok');
    }
    function addCookie() {
      if (!newCookie.host.trim() || !newCookie.cookie.trim()) { toast('站点和 Cookie 都要填'); return; }
      cookies.value.push({ ...newCookie });
      newCookie.host = '';
      newCookie.cookie = '';
      saveCookies();
    }
    async function removeCookie(i) {
      cookies.value.splice(i, 1);
      await saveCookies();
    }
    async function testCookie(c) {
      testing.value = c.host;
      testResult.value = null;
      try {
        const r = await api('/settings/test-cookie', { method: 'POST', body: { url: 'https://' + c.host } });
        testResult.value = { host: c.host, ...r };
      } catch (e) { testResult.value = { host: c.host, ok: false, title: e.message }; }
      testing.value = '';
    }

    // ---- 数据备份与恢复 ----
    const restoreFile = ref(null);
    const restoring = ref(false);

    function exportBackup() { location.href = '/api/backup'; }

    async function importBackup(e) {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (!f.name.endsWith('.zip')) { toast('请选择导出生成的 zip 备份文件'); return; }
      if (!confirm('导入会覆盖当前全部数据（任务/资料/照片/设置），当前数据会先自动备份一份。确定继续吗？')) return;
      restoring.value = true;
      try {
        const fd = new FormData();
        fd.append('file', f, f.name);
        const r = await api('/restore', { method: 'POST', body: fd });
        toast('恢复完成！' + (r.note || ''), 'ok');
        setTimeout(() => location.reload(), 1500);
      } catch (err) { toast(err.message, 'err'); restoring.value = false; }
    }

    // ---- 主菜单壁纸 ----
    const wallFile = ref(null);
    const wallBusy = ref(false);

    async function uploadWall(e) {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (!/^image/.test(f.type)) { toast('只能上传图片'); return; }
      wallBusy.value = true;
      try {
        const fd = new FormData();
        fd.append('image', f, f.name);
        await api('/wallpaper', { method: 'POST', body: fd });
        toast('壁纸已更新，回主菜单看看', 'ok');
        await load();
      } catch (err) { toast(err.message, 'err'); }
      wallBusy.value = false;
    }
    async function resetWall() {
      await api('/wallpaper', { method: 'DELETE' });
      toast('已恢复默认背景', 'ok');
      await load();
    }

    // ---- 手机远程访问（SSH 隧道） ----
    const tunnelState = ref({ running: false, url: '', qr: '', error: '' });
    const tunnelBusy = ref(false);

    async function loadTunnel() {
      try { tunnelState.value = await api('/tunnel/status'); } catch { /* 忽略 */ }
    }
    async function toggleTunnel() {
      if (tunnelState.value.running) {
        tunnelBusy.value = true;
        await api('/tunnel/stop', { method: 'POST' });
        tunnelState.value = { running: false, url: '', qr: '', error: '' };
        tunnelBusy.value = false;
        toast('已关闭远程访问');
        return;
      }
      tunnelBusy.value = true;
      try {
        const r = await api('/tunnel/start', { method: 'POST' });
        tunnelState.value = r;
        if (r.url) toast('手机现在可以访问了', 'ok');
        else if (r.error) toast(r.error, 'err');
      } catch (e) { toast(e.message, 'err'); }
      tunnelBusy.value = false;
    }
    function copyUrl() {
      navigator.clipboard?.writeText(tunnelState.value.url);
      toast('地址已复制，发给自己就能在手机上打开', 'ok');
    }

    onMounted(() => { load(true); loadTunnel(); });

    return {
      settings, examDate, password, toolInfo, load,
      editingSubjects, newName, newColor, addSubject, saveSubject, delSubject,
      cookies, newCookie, addCookie, removeCookie, saveCookies, testCookie, testing, testResult, saveExam, savePassword,
      store, setThemeBase, setThemeAccent,
      wallFile, wallBusy, uploadWall, resetWall,
      tunnelState, tunnelBusy, toggleTunnel, copyUrl,
      restoreFile, restoring, exportBackup, importBackup,
    };
  },
  template: `
  <div>
    <div class="page-title">设置</div>
    <div class="page-sub">考研目标、科目、站点 Cookie 与工具状态</div>

    <div class="card" style="margin-bottom:16px">
      <h3>🎨 外观</h3>
      <div class="row wrap" style="gap:14px">
        <div class="row" style="gap:6px">
          <span class="muted small">明暗</span>
          <button class="btn sm" :class="store.theme.base==='dark' ? '' : 'plain'" @click="setThemeBase('dark')">深色</button>
          <button class="btn sm" :class="store.theme.base==='light' ? '' : 'plain'" @click="setThemeBase('light')">浅色</button>
        </div>
        <div class="row" style="gap:6px">
          <span class="muted small">配色</span>
          <button class="btn sm" :class="store.theme.accent==='cyan' ? '' : 'plain'" @click="setThemeAccent('cyan')">青蓝</button>
          <button class="btn sm" :class="store.theme.accent==='amber' ? '' : 'plain'" @click="setThemeAccent('amber')">琥珀</button>
        </div>
        <span class="muted small">选择会自动保存，手机端同样生效</span>
      </div>
      <div class="row wrap" style="margin-top:12px">
        <span class="muted small">主菜单壁纸</span>
        <span class="badge" :class="settings.wallpaper_set ? 'ok' : 'gray'">{{ settings.wallpaper_set ? '已设置' : '默认背景' }}</span>
        <button class="btn sm ghost" :disabled="wallBusy" @click="$refs.wallFile.click()">{{ wallBusy ? '上传中…' : '上传图片' }}</button>
        <button class="btn sm plain" v-if="settings.wallpaper_set" @click="resetWall">恢复默认</button>
        <input ref="wallFile" type="file" accept="image/*" style="display:none" @change="uploadWall">
        <span class="muted small">建议 1920×1080，深色调更清晰</span>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>💾 数据备份与恢复（手机 ↔ 电脑同步用这个）</h3>
      <div class="row wrap">
        <button class="btn ghost" @click="exportBackup">⬇️ 导出备份（下载 zip）</button>
        <button class="btn plain" :disabled="restoring" @click="$refs.restoreFile.click()">⬆️ 导入恢复</button>
        <input ref="restoreFile" type="file" accept=".zip" style="display:none" @change="importBackup">
      </div>
      <div class="muted small" style="margin-top:8px">
        备份包含：全部任务 / 学习记录 / 资料与论文 / 打卡照片 / 音乐 / 设置。<br>
        <b>多设备同步用法</b>：电脑上导出 → 传到手机（微信文件传输助手即可）→ 手机上导入；反过来同理。<br>
        <span style="color:var(--warn)">导入会覆盖当前设备的全部数据</span>（覆盖前自动备份一份到 data/backup-before-restore-*）。
      </div>
      <div v-if="restoring" class="muted small" style="margin-top:6px">恢复中，取决于备份大小，可能需要几十秒…</div>
    </div>

    <div class="grid two-col" style="align-items:start">
      <div class="card">
        <h3>🎯 考研目标日期</h3>
        <div class="row">
          <input class="input" type="date" style="width:180px" v-model="examDate">
          <button class="btn" @click="saveExam">保存</button>
          <span class="muted small">仪表盘倒计时以此为准</span>
        </div>
      </div>

      <div class="card">
        <h3>🌐 手机 / 远程访问</h3>
        <div v-if="settings.lan_addresses?.length" class="small" style="margin-bottom:8px">
          <div v-for="a in settings.lan_addresses" :key="a.ip" style="margin-bottom:6px">
            <a :href="'http://' + a.ip + ':5175'" target="_blank" class="kbd" style="text-decoration:none">http://{{ a.ip }}:5175</a>
            <span class="badge" :class="a.kind === 'tailscale' ? 'ok' : 'gray'" style="margin-left:6px">
              {{ a.kind === 'tailscale' ? 'Tailscale · 任何网络都能连' : (a.adapter || '本机网卡') }}
            </span>
          </div>
        </div>
        <div v-else class="muted small" style="margin-bottom:8px">未检测到可用网卡地址</div>
        <div class="row" style="margin-top:10px">
          <input class="input" type="password" style="width:180px" placeholder="设置访问密码（可留空关闭）" v-model="password">
          <button class="btn plain" @click="savePassword">应用</button>
        </div>
        <div class="muted small" style="margin-top:6px">当前状态：{{ settings.access_password_set ? '✅ 已开启密码保护' : '未开启' }}。校园网环境强烈建议开启。</div>
        <div class="card" style="margin-top:14px;background:var(--card2)">
          <div class="row wrap" style="justify-content:space-between">
            <b class="small">📱 手机远程访问（不用装 App）</b>
            <button class="btn sm" :disabled="tunnelBusy" @click="toggleTunnel">
              {{ tunnelBusy ? '处理中…' : (tunnelState.running ? '关闭远程访问' : '开启远程访问') }}
            </button>
          </div>
          <div v-if="tunnelState.running && tunnelState.url" style="margin-top:12px;text-align:center">
            <div class="row" style="justify-content:center;gap:8px">
              <a :href="tunnelState.url" target="_blank" class="kbd" style="font-size:13px">{{ tunnelState.url }}</a>
              <button class="btn sm plain" @click="copyUrl">复制</button>
            </div>
            <img v-if="tunnelState.qr" :src="tunnelState.qr" style="width:180px;height:180px;margin-top:10px;border:6px solid #fff;border-radius:4px">
            <div class="muted small" style="margin-top:6px">手机相机 / 微信扫一扫这个二维码即可打开<br>任何网络都行：校园 WiFi、流量都可以</div>
          </div>
          <div v-else-if="tunnelState.error" class="small" style="color:var(--danger);margin-top:8px">{{ tunnelState.error }}</div>
          <div v-else class="muted small" style="margin-top:8px">
            开启后会生成一个公网地址（走 SSH 加密隧道到这台电脑），手机浏览器直接打开即可，无需安装任何软件。<br>
            需要先设置上面的「访问密码」——公网地址必须加锁。
          </div>
        </div>

        <div class="cap-result" style="margin-top:12px;display:block">
          <b>📱 其他方式</b>
          <div class="small" style="line-height:1.9;margin-top:6px">
            <b>① 手机热点 / USB 共享（免安装、免联网）</b><br>
            手机开个人热点（或用数据线连电脑开「USB 网络共享」）→ 电脑连上后，上方会出现新的 <span class="kbd">192.168.x.x</span> 地址，手机访问即可<br>
            <span class="muted">校园网有线和无线通常互相隔离，电脑插网线 + 手机连校园 WiFi 这种组合一般连不通，所以需要这条本地通路或上面的远程访问。</span><br><br>
            <b>② Tailscale（需要能装 App 时）</b><br>
            电脑和手机都装 Tailscale 并登录同一账号，之后任何网络都能通过 <span class="kbd">100.x.x.x</span> 访问。<br>
            <span class="muted">注意：国内应用商店一般没有，Android 需要自行下载 APK 安装（约 100MB），iOS 需要外区 Apple ID。</span><br><br>
            <b>装到手机桌面：</b>用手机浏览器打开后，选「添加到主屏幕」，以后像 App 一样点开即用（自动全屏、深色主题）
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>📚 科目管理</h3>
      <div v-for="s in store.subjects" :key="s.id" class="set-row">
        <input type="color" :value="s.color" style="width:34px;height:34px;border:none;background:none;cursor:pointer"
          @input="editingSubjects[s.id] = { ...(editingSubjects[s.id] || {}), color: $event.target.value }">
        <input class="input" style="width:160px" :value="s.name"
          @input="editingSubjects[s.id] = { ...(editingSubjects[s.id] || {}), name: $event.target.value }">
        <span class="muted small">章节进度 {{ s.progress }}%</span>
        <button class="btn sm ghost" @click="saveSubject(s)">保存</button>
        <button class="btn sm plain" @click="delSubject(s)">删除</button>
      </div>
      <div class="set-row">
        <input type="color" v-model="newColor" style="width:34px;height:34px;border:none;background:none;cursor:pointer">
        <input class="input" style="width:160px" placeholder="新科目名称" v-model="newName" @keyup.enter="addSubject">
        <button class="btn sm" @click="addSubject">＋ 添加科目</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>🔐 站点 Cookie（用于抓取你已登录/已购课的站点）</h3>
      <p class="muted small" style="margin-bottom:12px">
        获取方法：电脑浏览器登录该网站 → 按 <span class="kbd">F12</span> → Network（网络）标签 → 刷新页面 → 点击第一个请求 → 在 Request Headers（请求标头）里找到 <span class="kbd">Cookie:</span>，复制冒号后的整串内容。
        仅用于抓取你自己的账号有权限访问的内容。
      </p>
      <div v-for="(c, i) in cookies" :key="i" class="set-row" style="align-items:flex-start">
        <input class="input" style="width:180px" placeholder="站点域名，如 lingxianvip.com" v-model="c.host">
        <textarea class="textarea" style="flex:1;min-height:60px;font-family:ui-monospace,Consolas,monospace;font-size:12px" placeholder="Cookie 内容" v-model="c.cookie"></textarea>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn sm ghost" @click="saveCookies">保存</button>
          <button class="btn sm plain" :disabled="testing === c.host" @click="testCookie(c)">{{ testing === c.host ? '测试中…' : '测试' }}</button>
          <button class="btn sm plain" @click="removeCookie(i)">删除</button>
        </div>
      </div>
      <div class="set-row" style="align-items:flex-start">
        <input class="input" style="width:180px" placeholder="站点域名，如 lingxianvip.com" v-model="newCookie.host">
        <textarea class="textarea" style="flex:1;min-height:60px;font-family:ui-monospace,Consolas,monospace;font-size:12px" placeholder="粘贴 Cookie 内容" v-model="newCookie.cookie"></textarea>
        <button class="btn sm" @click="addCookie">＋ 添加</button>
      </div>
      <div v-if="testResult" class="cap-result" :class="testResult.ok && !testResult.maybe_need_login ? 'ok' : 'err'" style="margin-top:12px">
        <div style="flex:1">
          <b>{{ testResult.host }}</b> — {{ testResult.ok ? 'HTTP ' + testResult.status : '访问失败' }}
          <div v-if="testResult.title" class="small">页面标题：{{ testResult.title }}</div>
          <div v-if="testResult.maybe_need_login" class="small" style="color:var(--warn)">⚠️ 页面疑似登录页，Cookie 可能已失效，请重新复制</div>
          <div v-else-if="testResult.ok" class="small" style="color:var(--ok)">看起来正常，可以去「采集中心」试试抓取该站的页面了</div>
        </div>
      </div>
    </div>

    <div class="grid two-col" style="margin-top:16px;align-items:start">
      <div class="card">
        <h3>⬇️ 视频下载（yt-dlp）</h3>
        <template v-if="toolInfo">
          <div v-if="toolInfo.ytdlp" class="badge ok" style="margin-bottom:10px">已安装 v{{ toolInfo.ytdlp.version }}</div>
          <div v-else class="badge gray" style="margin-bottom:10px">未安装</div>
          <div class="small" style="line-height:1.9">
            安装方法：打开
            <a href="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" target="_blank">yt-dlp.exe 官方下载直链</a>
            ，把下载的 <span class="kbd">yt-dlp.exe</span> 放到本程序目录的 <span class="kbd">tools</span> 文件夹里，然后刷新本页。<br>
            可选：再下载 <a href="https://github.com/BtbN/FFmpeg-Builds/releases/latest" target="_blank">ffmpeg</a>（解压出 ffmpeg.exe 放入同一文件夹）可获得更高清晰度；B站视频未登录账号最高 480P，清晰度由平台决定。<br>
            <span class="muted">下载功能仅限个人学习使用；受版权保护/加密的内容无法下载。</span>
          </div>
        </template>
        <div v-else class="muted">检测中…</div>
      </div>

      <div class="card">
        <h3>💾 数据与备份</h3>
        <div class="small" style="line-height:1.9">
          所有数据（数据库、上传和下载的文件）都保存在程序目录的 <span class="kbd">data/</span> 文件夹。<br>
          备份 = 关闭程序后复制整个 <span class="kbd">data/</span> 文件夹；恢复 = 把备份的文件夹复制回来。<br>
          <span class="muted">建议每周备份一次，防止误删。</span>
        </div>
      </div>
    </div>
  </div>`,
};
