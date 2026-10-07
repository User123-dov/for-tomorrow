// 主菜单大厅：方舟式沉浸主界面
// 大背景（可用自己的图） + 右上角资源条 + 右下角斜杠菜单 + 底部滚动公告
import { store, api, navigate, fmtMinutes, startTimer, pauseTimer, finishTimer, timerElapsedSeconds, openCheckin } from '../store.js';

const { ref, computed, onMounted, onBeforeUnmount } = Vue;

// 菜单项：主题化名称 + 对应功能说明
const MENU = [
  { key: 'dashboard', zh: '终端', en: 'TERMINAL', sub: '今日总览' },
  { key: 'plan', zh: '作战', en: 'OPERATION', sub: '学习计划' },
  { key: 'materials', zh: '仓库', en: 'DEPOT', sub: '资料库' },
  { key: 'videos', zh: '档案', en: 'ARCHIVE', sub: '视频课程' },
  { key: 'frontier', zh: '情报', en: 'INTELLIGENCE', sub: '论文 · 院校' },
  { key: 'capture', zh: '采集', en: 'SUPPLY', sub: '采集中心' },
  { key: 'settings', zh: '设定', en: 'SETTINGS', sub: '设置' },
];

export default {
  setup() {
    const examDate = ref('');
    const daysLeft = ref(null);
    const todayMinutes = ref(0);
    const taskCount = ref(0);
    const todayTasks = ref([]);
    const todayUpdates = ref({ materials: 0, videos: 0, done: 0, photos: 0, minutes: 0 });
    const panelMin = ref(localStorage.getItem('yt_panel_min') === '1');
    function togglePanel() {
      panelMin.value = !panelMin.value;
      localStorage.setItem('yt_panel_min', panelMin.value ? '1' : '0');
    }

    // 计时器：完全走全局 store（与终端页同一份状态，天然同步）
    const timerRunning = computed(() => store.timer.running);
    const elapsed = computed(() => { void store.tick; return Math.floor(timerElapsedSeconds()); });
    const mmss = computed(() => {
      const t = elapsed.value;
      return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    });
    function timerToggle() {
      if (store.timer.running) pauseTimer(); else startTimer();
    }
    async function timerStop() {
      const r = await finishTimer({ refresh: () => refreshTasks() });
      if (!r.minutes) { toast('学习不足 1 分钟，未记录'); return; }
      toast('已记录 ' + r.minutes + ' 分钟' + (r.taskTitle ? ' · ' + r.taskTitle : ''), 'ok');
    }

    // 点击面板外部（如屏幕中心、右侧菜单）→ 简报自动收起
    function onDocClick(e) {
      if (panelMin.value) return;
      if (e.target.closest('.home-panel') || e.target.closest('.home-panel-tab')) return;
      togglePanel();
    }
    onMounted(() => document.addEventListener('click', onDocClick));
    onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
    async function refreshTasks() {
      const tasks = await api('/tasks?view=today');
      todayTasks.value = tasks;
      taskCount.value = tasks.length;
      const st = await api('/stats/weekly');
      todayMinutes.value = st.today_minutes || 0;
    }
    async function toggleTask(t) {
      await api('/tasks/' + t.id, { method: 'PATCH', body: { status: t.status === 'done' ? 'todo' : 'done' } });
      await refreshTasks();
    }
    function taskCheckin(t) { openCheckin(t, refreshTasks); }
    function taskStart(t) {
      store.timer.taskId = t.id;
      store.timer.taskTitle = t.title;
      store.timer.subjectId = t.subject_id || null;
      if (!store.timer.running) startTimer();
    }
    const materialCount = ref(0);
    const videoCount = ref(0);
    const ticker = ref([]);
    const hasBg = ref(true);
    const bgTs = Date.now(); // 每次进页取新壁纸（上传后立即生效）
    const ready = ref(false);

    function go(key) { navigate(key); }

    onMounted(async () => {
      const results = await Promise.allSettled([
        api('/settings'),
        api('/stats/weekly'),
        api('/tasks?view=today'),
        api('/materials?limit=200'),
        api('/videos'),
      ]);
      const [s, st, tasks, mats, vids] = results.map(r => r.status === 'fulfilled' ? r.value : null);

      if (s?.exam_date) {
        examDate.value = s.exam_date;
        daysLeft.value = Math.ceil((new Date(s.exam_date) - new Date(new Date().toLocaleDateString('sv'))) / 86400000);
      }
      if (st) { todayMinutes.value = st.today_minutes || 0; todayUpdates.value.minutes = st.today_minutes || 0; }
      if (tasks) { todayTasks.value = tasks; taskCount.value = tasks.length; }
      if (mats) materialCount.value = mats.length;
      if (vids) videoCount.value = vids.length;

      // 今日更新：今天新增的资料/视频、完成的任务
      const day = new Date().toLocaleDateString('sv');
      if (mats) {
        const t = mats.filter(m => (m.created_at || '').startsWith(day));
        todayUpdates.value.materials = t.filter(m => m.type !== 'video').length;
        todayUpdates.value.videos = t.filter(m => m.type === 'video').length;
      }
      try {
        const done = await api('/tasks?view=done');
        todayUpdates.value.done = (done || []).filter(t => (t.completed_at || '').startsWith(day)).length;
      } catch { /* 忽略 */ }

      // 底部滚动：最近收藏 + 今日任务
      const lines = [];
      if (tasks?.length) lines.push('今日待办 ' + tasks.length + ' 项：' + tasks.slice(0, 3).map(t => t.title).join(' / '));
      if (mats?.length) lines.push('最近收藏：' + mats.slice(0, 4).map(m => m.title.slice(0, 26)).join(' · '));
      if (vids?.length) lines.push('档案库共 ' + vids.length + ' 个课时，可站内观看回放');
      ticker.value = lines.length ? lines : ['为了明日 —— 距离目标还有 ' + (daysLeft.value ?? '—') + ' 天，开始今天的学习吧'];
      ready.value = true;
    });

    return { store, MENU, examDate, bgTs, daysLeft, todayMinutes, taskCount, materialCount, videoCount, ticker, hasBg, ready, go, fmtMinutes,
             todayTasks, todayUpdates, timerRunning, elapsed, mmss, timerToggle, timerStop, toggleTask, taskCheckin, taskStart,
             panelMin, togglePanel };
  },
  template: `
  <div class="home">
    <!-- 背景：可用自己的图（放 data/files/home-bg.jpg 即自动生效），否则用几何斜切底 -->
    <div class="home-bg">
      <img v-if="hasBg" :src="'/files/home-bg.jpg?v=' + bgTs" alt="" @error="hasBg = false">
      <div class="home-veil"></div>
      <div class="home-grid"></div>
    </div>

    <!-- 左上：标识 -->
    <div class="home-brand">
      <div class="t">为了明日</div>
      <div class="s">FOR TOMORROW · 考研学习终端</div>
    </div>

    <!-- 右上：资源条（对应方舟的资源栏） -->
    <div class="home-stats">
      <div class="home-stat" title="距离初试">
        <span class="k">倒计时</span>
        <span class="v big">{{ daysLeft === null ? '—' : daysLeft }}<i>天</i></span>
      </div>
      <div class="home-stat" title="今日学习时长">
        <span class="k">今日</span>
        <span class="v">{{ fmtMinutes(todayMinutes) }}</span>
      </div>
      <div class="home-stat" title="今日待办">
        <span class="k">待办</span>
        <span class="v">{{ taskCount }}</span>
      </div>
      <div class="home-stat" title="资料与档案">
        <span class="k">资料</span>
        <span class="v">{{ materialCount }}</span>
      </div>
    </div>

    <!-- 左侧：今日简报面板 -->
    <button class="home-panel-tab" v-if="panelMin" @click="togglePanel" title="展开今日简报">▤ 简报</button>
    <div class="home-panel" :class="{min: panelMin}" v-if="ready">
      <button class="hp-min" @click="togglePanel" :title="panelMin ? '展开' : '收起简报'">{{ panelMin ? '›' : '‹' }}</button>
      <div class="hp-count">
        <div class="num">{{ daysLeft === null ? '—' : (daysLeft > 0 ? daysLeft : 0) }}<i>天</i></div>
        <div class="lbl">距离 {{ examDate || '—' }} 初试</div>
      </div>

      <div class="hp-timer">
        <span class="t" :class="{run: timerRunning}">{{ mmss }}</span>
        <span class="own" v-if="store.timer.taskTitle" :title="store.timer.taskTitle">{{ store.timer.taskTitle }}</span>
        <span class="grow"></span>
        <button class="hp-btn" @click="timerToggle" :title="timerRunning ? '暂停' : '继续'">{{ timerRunning ? '❚❚' : '▶' }}</button>
        <button class="hp-btn" @click="timerStop" title="结束并记录">■</button>
      </div>

      <div class="hp-tasks">
        <div class="hp-h">今日任务 <b>{{ todayTasks.length }}</b></div>
        <template v-for="t in todayTasks.slice(0, 5)" :key="t.id">
          <div class="hp-task">
            <span class="cb" :class="{on: t.status === 'done'}" @click="toggleTask(t)">✓</span>
            <span class="tt" :title="t.title">{{ t.title }}</span>
            <span class="tm" v-if="t.minutes_today" :title="'今日已学 ' + t.minutes_today + ' 分钟'">{{ fmtMinutes(t.minutes_today) }}</span>
            <button class="hp-ico" @click="taskStart(t)" :title="'开始计时这个任务'">▶</button>
            <button class="hp-ico" @click="taskCheckin(t)" title="打卡配图">📷</button>
          </div>
        </template>
        <div v-if="!todayTasks.length" class="none">今天还没有安排任务 · 去作战里计划一下</div>

        <div class="hp-h" style="margin-top:16px">今日更新 <b>{{ (todayUpdates.materials + todayUpdates.videos + todayUpdates.done) || '' }}</b></div>
        <div class="hp-updates">
          <span v-if="todayUpdates.materials" class="hp-up">＋{{ todayUpdates.materials }} 资料</span>
          <span v-if="todayUpdates.videos" class="hp-up">＋{{ todayUpdates.videos }} 视频</span>
          <span v-if="todayUpdates.done" class="hp-up ok">✓ {{ todayUpdates.done }} 任务完成</span>
          <span v-if="todayUpdates.minutes" class="hp-up">⏱ 学习 {{ fmtMinutes(todayUpdates.minutes) }}</span>
          <span v-if="!(todayUpdates.materials + todayUpdates.videos + todayUpdates.done)" class="muted small">今天还没有新入库的内容</span>
        </div>
      </div>
    </div>

    <!-- 右下：斜杠菜单 -->
    <nav class="home-menu">
      <button v-for="(m, i) in MENU" :key="m.key"
              class="home-item" :style="{ animationDelay: (i * 60 + 120) + 'ms' }"
              @click="go(m.key)">
        <span class="slash">//</span>
        <span class="zh">{{ m.zh }}</span>
        <span class="en">{{ m.en }}</span>
        <span class="sub">{{ m.sub }}</span>
        <span class="arrow">›</span>
      </button>
    </nav>

    <!-- 底部：滚动公告 -->
    <div class="home-ticker">
      <span class="tag">公告</span>
      <div class="rail">
        <div class="run">
          <span v-for="(t, i) in ticker" :key="'a'+i">{{ t }}<em>◆</em></span>
          <span v-for="(t, i) in ticker" :key="'b'+i">{{ t }}<em>◆</em></span>
        </div>
      </div>
    </div>
  </div>`,
};
