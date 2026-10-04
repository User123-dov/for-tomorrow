// 仪表盘：倒计时 / 今日任务 / 计时器 / 本周时长 / 最近资料
import { store, api, toast, loadSubjects, navigate, todayStr, openCheckin, startTimer, pauseTimer, finishTimer, timerElapsedSeconds, fmtMinutes } from '../store.js';

const { ref, computed, onMounted } = Vue;

export default {
  setup() {
    const examDate = ref('');
    const todayTasks = ref([]);
    const doneToday = ref([]);
    const stats = ref({ week: [], today_minutes: 0 });
    const recent = ref([]);

    // 计时器（状态在全局 store，跨页面共享）
    const elapsed = computed(() => { void store.tick; return Math.floor(timerElapsedSeconds()); });
    const timerRunning = computed(() => store.timer.running);

    const quickTitle = ref('');
    const quickSubject = ref(null);

    const daysLeft = computed(() => {
      if (!examDate.value) return null;
      const diff = Math.ceil((new Date(examDate.value) - new Date(todayStr())) / 86400000);
      return diff;
    });
    const maxWeek = computed(() => Math.max(60, ...stats.value.week.map(d => d.minutes)));
    const todayDate = todayStr();

    async function refresh() {
      const s = await api('/settings');
      examDate.value = s.exam_date;
      const [tasks, st, done] = await Promise.all([api('/tasks?view=today'), api('/stats/weekly'), api('/tasks?view=done')]);
      todayTasks.value = tasks;
      stats.value = st;
      doneToday.value = (done || []).filter(t => (t.completed_at || '').startsWith(todayStr()));
      recent.value = await api('/materials?limit=6');
    }

    async function quickAdd() {
      if (!quickTitle.value.trim()) return;
      await api('/tasks', { method: 'POST', body: { title: quickTitle.value, subject_id: quickSubject.value, due_date: todayStr() } });
      quickTitle.value = '';
      todayTasks.value = await api('/tasks?view=today');
      toast('已加入今日任务', 'ok');
    }

    function checkin(t) { openCheckin(t, refresh); }

    async function completeTask(t) {
      await api('/tasks/' + t.id, { method: 'PATCH', body: { status: 'done' } });
      todayTasks.value = await api('/tasks?view=today');
      toast('完成 ✓', 'ok');
    }

    const timerTask = ref(null); // 计时归属的任务 id
    function timerStart() {
      const task = todayTasks.value.find(t => t.id === timerTask.value);
      startTimer({ taskId: timerTask.value, taskTitle: task ? task.title : '', subjectId: store.timer.subjectId });
    }
    function timerPause() { pauseTimer(); }
    async function timerStop() {
      const r = await finishTimer({ refresh: async () => { await refresh(); } });
      if (!r.minutes) { toast('学习不足 1 分钟，未记录'); return; }
      toast('已记录 ' + r.minutes + ' 分钟' + (store.timer.taskId ? '' : '学习时长'), 'ok');
      stats.value = await api('/stats/weekly');
    }
    function isTiming(t) { return store.timer.running && store.timer.taskId === t.id; }
    async function timerForTask(t) {
      if (isTiming(t)) { await timerStop(); return; }
      // 正在为别的任务计时：先把上一段结算掉，再为新任务重新开始
      if (store.timer.running) {
        const r = await finishTimer({ refresh: () => refresh() });
        if (r.minutes) toast('已记录 ' + r.minutes + ' 分钟到「' + (r.taskTitle || '上个任务') + '」', 'ok');
      }
      timerTask.value = t.id;
      store.timer.taskId = t.id;
      store.timer.taskTitle = t.title;
      store.timer.subjectId = t.subject_id || null;
      startTimer();
      toast('开始计时：' + t.title, 'ok');
    }
    function setTimerTask(id) {
      timerTask.value = id;
      const t = todayTasks.value.find(x => x.id === id);
      store.timer.taskId = id;
      store.timer.taskTitle = t ? t.title : '';
      if (t && t.subject_id) store.timer.subjectId = t.subject_id;
    }

    function openMaterial(m) { navigate('materials', { open: m.id }); }

    onMounted(refresh);

    return {
      store, examDate, daysLeft, todayTasks, doneToday, stats, recent, maxWeek, todayDate,
      quickTitle, quickSubject, quickAdd, completeTask, checkin,
      timerRunning, elapsed, timerStart, timerPause, timerStop, timerTask, setTimerTask, timerForTask, isTiming, fmtMinutes,
      openMaterial, todayStr,
      fmtMin: (m) => (m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? (m % 60) + 'm' : '') : m + 'm'),
      fmtDur: (sec) => { sec = Math.round(Number(sec) || 0); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h > 0 ? h + 'h' + m + 'm' : m + 'm'; },
      TYPE_META: { article: '📄', link: '🔗', file: '📎', video: '🎬' },
    };
  },
  template: `
  <div>
    <div class="page-title">仪表盘</div>
    <div class="page-sub">{{ todayDate }} · 今天也要加油呀</div>

    <div class="dash-grid">
      <div class="card">
        <h3>🎯 考研倒计时</h3>
        <template v-if="daysLeft !== null">
          <div class="count-num">{{ daysLeft > 0 ? daysLeft : 0 }}<span style="font-size:18px;color:var(--muted);font-weight:500"> 天</span></div>
          <div class="muted small" style="margin-top:6px">距离 {{ examDate }} 初试</div>
          <div class="bar" style="margin-top:12px"><i :style="{width: Math.max(4, 100 - Math.max(0,daysLeft)/3) + '%'}"></i></div>
        </template>
        <div v-else class="muted">请在「设置」中设置考研日期</div>
      </div>

      <div class="card">
        <h3>⏱️ 学习计时</h3>
        <div class="timer-num">{{ String(Math.floor(elapsed/60)).padStart(2,'0') }}:{{ String(elapsed%60).padStart(2,'0') }}</div>
        <div v-if="store.timer.taskTitle" class="small" style="margin-top:4px;color:var(--primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
             :title="store.timer.taskTitle">
          {{ timerRunning ? '计时中' : '归属' }} · {{ store.timer.taskTitle }}
        </div>
        <select class="select" style="margin:10px 0 6px"
                :value="timerTask === null || timerTask === undefined ? '' : String(timerTask)"
                @change="setTimerTask($event.target.value === '' ? null : Number($event.target.value))">
          <option value="">不指定任务（记到科目）</option>
          <option v-for="t in todayTasks" :key="t.id" :value="String(t.id)">📋 {{ t.title }}<template v-if="t.minutes_today">（今日 {{ fmtMinutes(t.minutes_today) }}）</template></option>
        </select>
        <select class="select" style="margin-bottom:10px"
                :value="store.timer.subjectId === null || store.timer.subjectId === undefined ? '' : String(store.timer.subjectId)"
                @change="store.timer.subjectId = $event.target.value === '' ? null : Number($event.target.value)">
          <option value="">不区分科目</option>
          <option v-for="s in store.subjects" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
        </select>
        <div class="row wrap">
          <button v-if="!timerRunning" class="btn sm" @click="timerStart">▶ 开始</button>
          <button v-else class="btn sm plain" @click="timerPause">⏸ 暂停</button>
          <button class="btn sm plain" @click="timerStop">■ 结束并记录</button>
        </div>
      </div>

      <div class="card">
        <h3>📊 本周学习时长</h3>
        <div class="muted small">今日 {{ fmtMin(stats.today_minutes) }}</div>
        <div class="week-chart">
          <div v-for="d in stats.week" :key="d.date" class="col" :class="{today: d.date === todayDate}">
            <div class="v">{{ d.minutes ? d.minutes + "'" : '' }}</div>
            <div class="b" :style="{height: Math.max(2, d.minutes / maxWeek * 100) + '%'}"></div>
            <div class="d">{{ d.date.slice(5) }}</div>
          </div>
        </div>
      </div>

      <div class="card span2">
        <h3>✅ 今日任务 <span class="badge gray">{{ todayTasks.length }}</span></h3>
        <div class="row wrap" style="margin-bottom:8px">
          <input class="input" placeholder="快速添加今日任务，回车确认" v-model="quickTitle" @keyup.enter="quickAdd">
          <select class="select" style="width:110px" v-model="quickSubject">
            <option :value="null">科目</option>
            <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <button class="btn" @click="quickAdd">添加</button>
        </div>
        <div v-if="!todayTasks.length" class="empty"><span class="big">🌤️</span>今日任务都完成了，真棒！</div>
        <template v-for="t in todayTasks" :key="t.id">
        <div class="taskline">
          <div class="checkbox" :title="'完成'" @click="completeTask(t)">✓</div>
          <div style="flex:1">
            {{ t.title }}
            <span v-if="t.due_date && t.due_date < todayDate" class="badge overdue" style="margin-left:6px">已过期</span>
          </div>
          <span v-if="t.subject_name" class="chip"><span class="dot" :style="{background:t.subject_color}"></span>{{ t.subject_name }}</span>
          <span v-if="t.priority === 2" class="flag" title="高优先级">🔥</span>
          <span v-if="isTiming(t)" class="time-badge live" :title="'正在计时，今日已学 ' + (t.minutes_today || 0) + ' 分钟'">
            ⏱ 计时中<template v-if="t.minutes_today"> · 已 {{ fmtMinutes(t.minutes_today) }}</template>
          </span>
          <span v-else-if="t.minutes_today" class="time-badge" :title="'今日已学 ' + t.minutes_today + ' 分钟' + (t.minutes_total > t.minutes_today ? '，累计 ' + t.minutes_total + ' 分钟' : '')">
            ⏱ {{ fmtMinutes(t.minutes_today) }}<template v-if="t.minutes_total > t.minutes_today"> / 共 {{ fmtMinutes(t.minutes_total) }}</template>
          </span>
          <button class="btn sm plain" @click.stop="timerForTask(t)" :title="isTiming(t) ? '结束并记录本次计时' : '开始计时这个任务'">{{ isTiming(t) ? '■' : '▶' }}</button>
          <button class="btn sm plain" @click.stop="checkin(t)" :title="t.images && t.images.length ? '查看打卡图（' + t.images.length + '）' : '上传打卡图'">📷<template v-if="t.images && t.images.length"> {{ t.images.length }}</template></button>
        </div>
        <div v-if="t.images && t.images.length" class="checkin-row">
          <img v-for="img in t.images" :key="img.id" :src="img.url" loading="lazy" class="checkin-mini" @click.stop="checkin(t)">
        </div>
        </template>

        <div v-if="doneToday.length" style="margin-top:14px;border-top:1px dashed var(--line);padding-top:10px">
          <div class="muted small" style="margin-bottom:4px">✅ 今日已完成（{{ doneToday.length }}）· 打卡记录</div>
          <template v-for="t in doneToday" :key="'d' + t.id">
            <div class="taskline">
              <div class="checkbox on">✓</div>
              <div style="flex:1" class="muted">{{ t.title }}</div>
              <span v-if="t.subject_name" class="chip"><span class="dot" :style="{background:t.subject_color}"></span>{{ t.subject_name }}</span>
              <span v-if="t.minutes_total" class="time-badge" :title="'累计学习 ' + t.minutes_total + ' 分钟'">⏱ {{ fmtMinutes(t.minutes_total) }}</span>
              <button class="btn sm plain" @click.stop="checkin(t)">📷<template v-if="t.images && t.images.length"> {{ t.images.length }}</template></button>
            </div>
            <div v-if="t.images && t.images.length" class="checkin-row">
              <img v-for="img in t.images" :key="img.id" :src="img.url" loading="lazy" class="checkin-mini" @click.stop="checkin(t)">
            </div>
          </template>
        </div>
      </div>

      <div class="card">
        <h3>🗂️ 最近收藏</h3>
        <div v-if="!recent.length" class="empty"><span class="big">📭</span>还没有资料<br>去「采集中心」试试</div>
        <div v-for="m in recent" :key="m.id" class="taskline" style="cursor:pointer" @click="openMaterial(m)">
          <span>{{ TYPE_META[m.type] || '📄' }}</span>
          <div style="flex:1;overflow:hidden">
            <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ m.title }}</div>
            <div class="muted small">{{ m.site || '本地' }}<span v-if="m.duration"> · {{ fmtDur(m.duration) }}</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
