// 视频库：B站/YouTube 收藏、嵌入播放、观看状态、yt-dlp 下载
import { store, api, toast, fmtDuration, navigate } from '../store.js';

const { ref, reactive, computed, onMounted, onBeforeUnmount } = Vue;

export default {
  setup() {
    const list = ref([]);
    const jobs = ref([]);
    const url = ref('');
    const subjectId = ref(null);
    const q = ref('');
    const ytdlpReady = ref(null); // null=未检测

    const player = ref(null);     // 正在播放的视频
    const playerNote = ref('');
    const watchMeta = ref(null);  // 分P信息展示

    const searchName = ref('');
    function searchByName() {
      if (!searchName.value.trim()) { toast('输入视频或课程关键词'); return; }
      navigate('capture', { vq: searchName.value.trim() });
    }

    async function load() {
      list.value = await api('/videos' + (q.value ? '?q=' + encodeURIComponent(q.value) : ''));
    }
    async function loadJobs() {
      jobs.value = await api('/videos/jobs');
    }

    async function addVideo() {
      if (!url.value.trim()) return;
      try {
        const m = await api('/videos', { method: 'POST', body: { url: url.value, subject_id: subjectId.value } });
        toast('已收录：' + (m.title || '').slice(0, 40), 'ok');
        url.value = '';
        load();
      } catch (e) { toast(e.message, 'err'); }
    }

    const playing = computed(() => {
      const m = player.value;
      if (!m) return null;
      if (m.local_path) return { kind: 'local', src: '/files/' + m.local_path };
      if (/csslcloud\.net/.test(m.source_url || '')) return { kind: 'cc', src: m.source_url };
      if (/^BV[0-9A-Za-z]{10}$/.test(m.bvid || '')) return { kind: 'bilibili', src: 'https://player.bilibili.com/player.html?bvid=' + m.bvid + '&page=1&autoplay=0&high_quality=1&danmaku=0' };
      const yt = /(?:v=|youtu\.be\/)([\w-]{11})/.exec(m.source_url || '');
      if (yt) return { kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/' + yt[1] };
      return { kind: 'external', src: m.source_url };
    });

    async function openPlayer(m) {
      player.value = m;
      playerNote.value = m.note || '';
      watchMeta.value = m.pages && m.pages !== '[]' ? JSON.parse(m.pages) : null;
      if (!ytdlpReady.value) {
        const s = await api('/settings?check=1');
        ytdlpReady.value = !!s.ytdlp;
      }
    }

    async function setWatch(m, status) {
      await api('/materials/' + m.id, { method: 'PATCH', body: { watch_status: status } });
      m.watch_status = status;
      if (player.value && player.value.id === m.id) player.value.watch_status = status;
      load();
    }
    async function saveNote() {
      if (!player.value) return;
      await api('/materials/' + player.value.id, { method: 'PATCH', body: { note: playerNote.value } });
      toast('笔记已保存', 'ok');
    }
    async function download(m) {
      try {
        await api('/videos/' + m.id + '/download', { method: 'POST' });
        toast('已加入下载队列', 'ok');
        loadJobs();
        pollJobs();
      } catch (e) { toast(e.message, 'err'); }
    }
    async function cancelJob(j) {
      await api('/videos/jobs/' + j.id + '/cancel', { method: 'POST' });
      loadJobs();
    }

    let pollTimer = null;
    onBeforeUnmount(() => clearInterval(pollTimer));
    function pollJobs() {
      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        const active = jobs.value.some(j => j.status === 'running' || j.status === 'pending');
        await loadJobs();
        if (!active && !jobs.value.some(j => j.status === 'running' || j.status === 'pending')) clearInterval(pollTimer);
      }, 1500);
    }

    const WATCH_META = {
      unwatched: { label: '未看', cls: 'gray' },
      watching: { label: '在看', cls: 'blue' },
      watched: { label: '看完', cls: 'ok' },
    };

    onMounted(async () => {
      await load();
      loadJobs();
      const openId = store.route.query.open;
      if (openId) {
        const m = list.value.find(x => String(x.id) === String(openId));
        if (m) openPlayer(m);
      }
    });

    return {
      list, jobs, url, subjectId, q, load, addVideo, searchName, searchByName,
      player, playerNote, watchMeta, playing, openPlayer, setWatch, saveNote, download, cancelJob,
      store, fmtDuration, WATCH_META, ytdlpReady,
    };
  },
  template: `
  <div>
    <div class="page-title">视频库</div>
    <div class="page-sub">粘贴 B站 / YouTube 链接自动收录，站内播放；可选下载到本地</div>

    <div class="card" style="margin-bottom:14px">
      <div class="row wrap">
        <input class="input" style="flex:2;min-width:220px" placeholder="粘贴视频链接，如 https://www.bilibili.com/video/BV…" v-model="url" @keyup.enter="addVideo">
        <select class="select" style="width:130px" v-model="subjectId">
          <option :value="null">不限科目</option>
          <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button class="btn" @click="addVideo">收录视频</button>
        <input class="input" style="width:170px" placeholder="搜索视频…" v-model="q" @keyup.enter="load">
      </div>
      <div class="row wrap" style="margin-top:10px">
        <input class="input" style="flex:2;min-width:200px" placeholder="没有链接？输入名称帮你找B站视频，如：材料科学基础 王永欣" v-model="searchName" @keyup.enter="searchByName">
        <button class="btn ghost" @click="searchByName">🔍 按名称找视频</button>
      </div>
    </div>

    <!-- 下载任务 -->
    <div v-if="jobs.length" class="card" style="margin-bottom:14px">
      <h3>⬇️ 下载任务</h3>
      <div v-for="j in jobs" :key="j.id" class="row wrap" style="padding:6px 0;gap:12px">
        <span style="flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ j.material_title }}</span>
        <div class="bar" style="max-width:220px"><i :style="{width: j.progress + '%', background: j.status === 'error' ? 'var(--danger)' : j.status === 'done' ? 'var(--ok)' : 'var(--primary)'}"></i></div>
        <span class="muted small" style="width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          {{ j.status === 'done' ? '✅ 完成' : j.status === 'error' ? '❌ ' + j.message : j.status === 'running' ? Math.round(j.progress) + '%' : '排队中' }}
        </span>
        <button v-if="j.status === 'running' || j.status === 'pending'" class="btn sm plain" @click="cancelJob(j)">取消</button>
      </div>
    </div>

    <div v-if="!list.length" class="card"><div class="empty"><span class="big">🎬</span>还没有视频<br>粘贴一个 B站 链接试试吧</div></div>

    <div class="vgrid">
      <div v-for="m in list" :key="m.id" class="vcard" @click="openPlayer(m)">
        <div class="vcover">
          <img v-if="m.cover_url" :src="m.cover_url" loading="lazy" referrerpolicy="no-referrer" @error="$event.target.style.display='none'">
          <span v-if="m.duration" class="dur">{{ fmtDuration(m.duration) }}</span>
        </div>
        <div class="vinfo">
          <div class="vt">{{ m.title }}</div>
          <div class="row" style="margin-top:8px;justify-content:space-between">
            <span class="muted small">{{ m.up_name || m.site }}</span>
            <span class="badge" :class="WATCH_META[m.watch_status]?.cls">{{ WATCH_META[m.watch_status]?.label }}</span>
          </div>
          <div v-if="m.local_path" class="badge ok" style="margin-top:6px">已下载本地</div>
        </div>
      </div>
    </div>

    <!-- 播放器 -->
    <div v-if="player" class="overlay" @click.self="player = null">
      <div class="modal wide">
        <div class="modal-h">
          <b style="font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ player.title }}</b>
          <button class="x" @click="player = null">×</button>
        </div>
        <div class="modal-b">
          <div class="player-wrap">
            <iframe v-if="playing.kind === 'bilibili' || playing.kind === 'youtube' || playing.kind === 'cc'" :src="playing.src" allowfullscreen allow="autoplay; fullscreen"></iframe>
            <video v-else-if="playing.kind === 'local'" :src="playing.src" controls autoplay></video>
            <div v-else style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff">
              <a :href="playing.src" target="_blank" style="color:#9db1ff">此视频不支持站内播放，去原网站观看 →</a>
            </div>
          </div>

          <div class="row wrap" style="margin:14px 0 4px;gap:8px">
            <span class="muted small">观看状态：</span>
            <button v-for="(wm, key) in WATCH_META" :key="key" class="btn sm" :class="player.watch_status === key ? '' : 'plain'" @click="setWatch(player, key)">{{ wm.label }}</button>
            <span style="flex:1"></span>
            <a v-if="player.source_url" :href="player.source_url" target="_blank" class="btn sm plain">原网页</a>
            <button v-if="!player.local_path && playing.kind !== 'cc'" class="btn sm ghost" :disabled="ytdlpReady === false" @click="download(player)" :title="ytdlpReady === false ? '未安装 yt-dlp，见设置页' : ''">⬇️ 下载到本地</button>
          </div>

          <div v-if="watchMeta && watchMeta.length > 1" class="muted small" style="margin:6px 0">
            共 {{ watchMeta.length }} 个分P：{{ watchMeta.slice(0, 8).map(p => p.part).join(' / ') }}{{ watchMeta.length > 8 ? ' …' : '' }}（站内默认播 P1，多P 请去原网页）
          </div>

          <textarea class="textarea" style="margin-top:10px" placeholder="学习笔记：这一节讲了什么？哪些地方要回头复习？" v-model="playerNote"></textarea>
          <div class="row" style="justify-content:flex-end;margin-top:10px">
            <button class="btn sm" @click="saveNote">保存笔记</button>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
