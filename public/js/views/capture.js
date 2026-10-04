// 采集中心：批量 URL 抓取
import { store, api, toast, navigate, TYPE_META, fmtDuration } from '../store.js';

const { ref, reactive, onMounted } = Vue;

export default {
  setup() {
    const text = ref('');
    const subjectId = ref(null);
    const tags = ref('');
    const running = ref(false);
    const results = ref([]);
    const lingxianStatus = ref(null);
    const syncing = ref(false);
    const syncResult = ref(null);

    async function run() {
      if (!text.value.trim()) { toast('请先粘贴要采集的网址'); return; }
      running.value = true;
      results.value = [];
      try {
        const res = await api('/capture', { method: 'POST', body: { text: text.value, subject_id: subjectId.value, tags: tags.value } });
        results.value = res.results;
        const okN = results.value.filter(r => r.ok).length;
        if (okN) toast('成功采集 ' + okN + ' 条', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      running.value = false;
    }

    async function syncLingxian() {
      syncing.value = true;
      syncResult.value = null;
      try {
        const r = await api('/lingxian/sync', { method: 'POST' });
        syncResult.value = r;
        toast('同步完成：' + r.created + ' 新增 / ' + r.updated + ' 更新', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      syncing.value = false;
    }

    // 按名称找视频（B站）
    const videoName = ref('');
    const videoSearching = ref(false);
    const videoResults = ref([]);
    const addingVideo = ref(-1);
    const addedBvids = ref(new Set());

    async function findVideos() {
      const name = videoName.value.trim();
      if (!name) { toast('请输入视频或课程关键词，如：材料科学基础 王永欣'); return; }
      videoSearching.value = true;
      videoResults.value = [];
      try {
        const r = await api('/search/videos?name=' + encodeURIComponent(name));
        videoResults.value = r.videos;
        if (!r.videos.length) toast('没找到相关视频，换个关键词试试', 'err');
      } catch (e) { toast(e.message, 'err'); }
      videoSearching.value = false;
    }
    async function addFoundVideo(v) {
      addingVideo.value = videoResults.value.indexOf(v);
      try {
        await api('/videos', { method: 'POST', body: { url: v.playUrl } });
        addedBvids.value.add(v.bvid);
        toast('已收录到视频库：' + v.title.slice(0, 30), 'ok');
      } catch (e) { toast(e.message, 'err'); }
      addingVideo.value = -1;
    }

    // 粘贴网址（高级选项，默认折叠）
    const showPaste = ref(false);

    const sample = 'https://www.bilibili.com/video/BV1GJ411x7h7\nhttps://www.ruanyifeng.com/blog/2026/09/weekly-issue-413.html';

    // 按名称找学习资料（PDF 等）
    const fileName = ref('');
    const fileSearching = ref(false);
    const fileResults = ref([]);
    const capturingIdx = ref(-1);

    async function findFiles() {
      const name = fileName.value.trim();
      if (!name) { toast('请输入资料名称，如：材料科学基础 真题'); return; }
      fileSearching.value = true;
      fileResults.value = [];
      try {
        const r = await api('/search/files?name=' + encodeURIComponent(name));
        fileResults.value = r.results;
        if (!r.results.length) toast('没找到相关 PDF，换个关键词试试', 'err');
      } catch (e) { toast(e.message, 'err'); }
      fileSearching.value = false;
    }
    async function captureFile(item) {
      capturingIdx.value = fileResults.value.indexOf(item);
      try {
        const r = await api('/capture', { method: 'POST', body: { text: item.url, tags: '资料' } });
        const res = r.results[0];
        if (!res.ok) throw new Error(res.error);
        toast('已入库：' + (res.material.title || '').slice(0, 40), 'ok');
      } catch (e) { toast('采集失败：' + e.message, 'err'); }
      capturingIdx.value = -1;
    }

    onMounted(async () => {
      try { lingxianStatus.value = await api('/lingxian/status'); } catch { lingxianStatus.value = { cookie_configured: false }; }
      const vq = store.route.query.vq;
      if (vq) { videoName.value = String(vq); findVideos(); }
    });

    return { store, text, subjectId, tags, running, results, run, sample, TYPE_META, lingxianStatus, syncing, syncResult, syncLingxian,
             fileName, fileSearching, fileResults, capturingIdx, findFiles, captureFile,
             videoName, videoSearching, videoResults, addingVideo, addedBvids, findVideos, addFoundVideo, showPaste,
             fmtDuration, navigate };
  },
  template: `
  <div>
    <div class="page-title">采集中心</div>
    <div class="page-sub">给名字就帮你找 —— 资料、视频、课程，网址粘贴只在高级选项里</div>

    <div class="card" style="margin-bottom:14px">
      <h3>🔎 按名称找学习资料</h3>
      <div class="row wrap" style="margin-bottom:8px">
        <input class="input" style="flex:2;min-width:200px" placeholder="输入资料名称，如：材料科学基础 真题 / 复合材料 导论 讲义" v-model="fileName" @keyup.enter="findFiles">
        <button class="btn" :disabled="fileSearching" @click="findFiles">{{ fileSearching ? '搜索中…' : '查找 PDF 资料' }}</button>
      </div>
      <div v-for="(item, i) in fileResults" :key="item.url" class="cap-result ok" style="margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;word-break:break-all">
            <a :href="item.url" target="_blank">{{ item.title }}</a>
            <span class="badge" :class="item.kind === 'pdf' ? 'blue' : 'gray'" style="margin-left:8px">{{ item.kind === 'pdf' ? 'PDF' : '网页' }}</span>
          </div>
          <div class="muted small" style="word-break:break-all">{{ item.snippet || item.url }}</div>
        </div>
        <button class="btn sm" :disabled="capturingIdx === i" @click="captureFile(item)">{{ capturingIdx === i ? '入库中…' : '采集入库' }}</button>
      </div>
      <div class="muted small">说明：PDF 会下载保存到资料库；「网页」类结果会抓取正文存为剪藏。需要登录/付费的网站文档无法抓取。</div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>🎬 按名称找视频（B站）</h3>
      <div class="row wrap" style="margin-bottom:8px">
        <input class="input" style="flex:2;min-width:200px" placeholder="视频或课程关键词，如：材料科学基础 王永欣 / 复合材料 导论" v-model="videoName" @keyup.enter="findVideos">
        <button class="btn" :disabled="videoSearching" @click="findVideos">{{ videoSearching ? '搜索中…' : '搜索视频' }}</button>
      </div>
      <div v-for="(v, i) in videoResults" :key="v.bvid" class="cap-result ok" style="margin-bottom:8px">
        <img v-if="v.cover" :src="v.cover" referrerpolicy="no-referrer" style="width:96px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0" loading="lazy">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;word-break:break-all">{{ v.title }}</div>
          <div class="muted small">{{ v.up }}<template v-if="v.duration"> · {{ fmtDuration(v.duration) }}</template><template v-if="v.play"> · {{ v.play }} 播放</template></div>
        </div>
        <button class="btn sm" :disabled="addingVideo === i || addedBvids.has(v.bvid)" @click="addFoundVideo(v)">{{ addedBvids.has(v.bvid) ? '已收录 ✓' : addingVideo === i ? '收录中…' : '+ 收录到视频库' }}</button>
      </div>
      <div class="muted small">收录后到「视频库」站内播放、记笔记、标进度；支持多P课程，也可按老师名字搜。</div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>🎓 领先在线课程同步</h3>
      <div class="muted small" style="margin-bottom:10px">
        一键同步你在领先在线（lingxianvip.com）已购的全部课程和课时到视频库，回放链接自动重建。需要先在「设置 → 站点 Cookie」配置 lingxianvip.com 的 Cookie。
      </div>
      <div class="row wrap">
        <button class="btn" :disabled="syncing || !(lingxianStatus && lingxianStatus.cookie_configured)" @click="syncLingxian">{{ syncing ? '同步中，课程较多约需半分钟…' : '🔄 同步领先课程' }}</button>
        <span v-if="lingxianStatus && !lingxianStatus.cookie_configured" class="badge overdue">未配置 Cookie</span>
        <span v-else-if="lingxianStatus" class="badge ok">Cookie 已配置</span>
        <a href="#/settings" class="btn sm plain">去设置</a>
      </div>
      <div v-if="syncResult" class="cap-result ok" style="margin-top:12px">
        <div style="flex:1">
          ✅ 同步完成：共 {{ syncResult.courses }} 门课程，{{ syncResult.lessons }} 个课时（新增 {{ syncResult.created }}，更新 {{ syncResult.updated }}<template v-if="syncResult.skipped">，跳过 {{ syncResult.skipped }}</template>）
          <div class="small" style="margin-top:4px">课时已进入 <a href="#/videos">视频库</a>，点开即可站内观看回放</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="row" style="justify-content:space-between;cursor:pointer" @click="showPaste = !showPaste">
        <h3 style="margin:0">📋 粘贴网址批量采集<span class="muted small" style="font-weight:400;margin-left:8px">高级选项，默认收起</span></h3>
        <span class="muted">{{ showPaste ? '▲ 收起' : '▼ 展开' }}</span>
      </div>
      <div v-show="showPaste">
      <textarea class="textarea" style="min-height:120px;font-family:ui-monospace,Consolas,monospace;font-size:13px"
        placeholder="每行一个网址，例如：&#10;https://www.bilibili.com/video/BVxxxx&#10;https://example.com/some-article&#10;https://example.com/讲义.pdf"
        v-model="text"></textarea>
      <div class="row wrap" style="margin-top:12px">
        <select class="select" style="width:140px" v-model="subjectId">
          <option :value="null">不限科目</option>
          <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input class="input" style="flex:1;min-width:160px" placeholder="标签，逗号分隔（可选）" v-model="tags">
        <button class="btn" :disabled="running" @click="run">{{ running ? '采集中…' : '🚀 开始采集' }}</button>
        <button class="btn plain" @click="text = sample">填入示例</button>
      </div>
      </div>
    </div>

    <div v-if="results.length" class="grid" style="grid-template-columns:1fr;margin-bottom:14px">
      <div v-for="r in results" :key="r.url" class="cap-result" :class="r.ok ? 'ok' : 'err'">
        <div class="mico" :style="{background: r.ok ? '#e6f7f1' : '#fdecec'}">{{ r.ok ? (TYPE_META[r.material.type]?.icon || '✅') : '❌' }}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;word-break:break-all">
            <template v-if="r.ok">{{ r.material.title }}<span class="badge blue" style="margin-left:8px">{{ TYPE_META[r.material.type]?.label }}</span></template>
            <template v-else>采集失败</template>
          </div>
          <div class="muted small" style="word-break:break-all">{{ r.url }}</div>
          <div v-if="!r.ok" class="small" style="color:var(--danger);margin-top:4px">{{ r.error }}</div>
          <div v-if="r.ok && r.material.type === 'video'" class="small" style="margin-top:4px">已进入视频库 · <a :href="'#/videos?open=' + r.material.id">去查看</a></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>💡 支持的类型</h3>
      <div class="set-row"><span>🎬 <b>B站视频</b></span><span class="muted small">自动抓标题/封面/UP主/时长/分P，进入视频库可站内播放、下载</span></div>
      <div class="set-row"><span>📄 <b>网页文章</b></span><span class="muted small">提取正文存为剪藏，原文失效也能读；正文太少时按普通链接收藏</span></div>
      <div class="set-row"><span>📎 <b>文件直链</b></span><span class="muted small">pdf / doc / ppt / zip 等直接下载存入资料库</span></div>
      <div class="set-row" style="border-bottom:none">
        <span>🔐 <b>需要登录的网站（如领先在线）</b></span>
        <span class="muted small">先到「设置 → 站点 Cookie」配置你账号的 Cookie（你有正规账号即可），之后即可抓取你有权限访问的课程页与讲义</span>
      </div>
    </div>
  </div>`,
};
