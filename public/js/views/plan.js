// 学习计划：任务 / 章节树 / 学习记录
import { store, api, toast, todayStr, loadSubjects, openCheckin, startTimer, finishTimer, fmtMinutes } from '../store.js';

const { ref, reactive, computed, watch, onMounted } = Vue;

// 递归章节节点（全局注册为 chapter-node）
const chapterNode = {
  name: 'ChapterNode',
  props: { node: Object, kids: Array, ui: Object },
  emits: ['refresh'],
  setup(props, { emit }) {
    const { node, ui } = props;
    const hasKids = computed(() => props.kids && props.kids.length > 0);
    const statusMeta = [
      { cls: 'st0', label: '未学' },
      { cls: 'st1', label: '学习中' },
      { cls: 'st2', label: '已掌握' },
    ];

    function toggle() {
      if (ui.expanded.has(node.id)) ui.expanded.delete(node.id);
      else ui.expanded.add(node.id);
    }
    async function cycleStatus() {
      const next = (Number(node.status) + 1) % 3;
      await api('/chapters/' + node.id, { method: 'PATCH', body: { status: next } });
      emit('refresh');
    }
    async function saveEdit() {
      const t = (ui.editText || '').trim();
      ui.editing = null;
      if (t && t !== node.title) await api('/chapters/' + node.id, { method: 'PATCH', body: { title: t } });
      emit('refresh');
    }
    async function saveAdd() {
      const t = (ui.addingText || '').trim();
      ui.addingTo = null;
      ui.addingText = '';
      if (!t) return;
      await api('/chapters', { method: 'POST', body: { subject_id: node.subject_id, parent_id: node.id, title: t } });
      ui.expanded.add(node.id);
      emit('refresh');
    }
    async function remove() {
      if (!confirm('删除章节「' + node.title + '」？其子章节也会一并删除')) return;
      await api('/chapters/' + node.id, { method: 'DELETE' });
      emit('refresh');
    }
    return { node, ui, hasKids, toggle, cycleStatus, saveEdit, saveAdd, remove, statusMeta };
  },
  template: `
  <div class="tree-node">
    <div class="tree-row">
      <span class="tw" @click="toggle" :style="hasKids ? '' : 'visibility:hidden'">{{ ui.expanded.has(node.id) ? '▼' : '▶' }}</span>
      <template v-if="ui.editing === node.id">
        <input class="input" style="max-width:340px" v-model="ui.editText" @keyup.enter="saveEdit" @keyup.esc="ui.editing = null">
        <button class="btn sm" @click="saveEdit">保存</button>
      </template>
      <template v-else>
        <span class="tt" @dblclick="ui.editing = node.id; ui.editText = node.title" title="双击重命名">{{ node.title }}</span>
      </template>
      <span class="status-pill" :class="statusMeta[node.status].cls" @click="cycleStatus" title="点击切换状态">{{ statusMeta[node.status].label }}</span>
      <button class="btn sm plain" title="添加子章节" @click="ui.addingTo = node.id; ui.addingText = ''">＋</button>
      <button class="btn sm plain" title="删除" @click="remove">✕</button>
    </div>
    <div v-if="ui.addingTo === node.id" class="tree-kids">
      <div class="row" style="padding:4px 0">
        <input class="input" style="max-width:340px" placeholder="子章节名称，回车保存" v-model="ui.addingText" @keyup.enter="saveAdd" @keyup.esc="ui.addingTo = null" v-focus>
        <button class="btn sm" @click="saveAdd">添加</button>
      </div>
    </div>
    <div v-if="hasKids && ui.expanded.has(node.id)" class="tree-kids">
      <chapter-node v-for="k in kids" :key="k.id" :node="k" :kids="ui.childrenMap[k.id] || []" :ui="ui" @refresh="$emit('refresh')"></chapter-node>
    </div>
  </div>`,
};

export default {
  chapterNode,
  setup() {
    const tab = ref('tasks');

    // ---- 任务 ----
    const view = ref('today');
    const tasks = ref([]);
    const doneTasks = ref([]);
    const newTask = reactive({ title: '', subject_id: null, due_date: todayStr(), priority: 1 });
    const showDone = ref(false);

    async function loadTasks() {
      tasks.value = await api('/tasks?view=' + view.value);
      doneTasks.value = await api('/tasks?view=done');
    }
    async function addTask() {
      if (!newTask.title.trim()) return;
      await api('/tasks', { method: 'POST', body: { ...newTask, due_date: newTask.due_date || null } });
      newTask.title = '';
      newTask.priority = 1;
      loadTasks();
      toast('任务已添加', 'ok');
    }
    async function setStatus(t, status) {
      await api('/tasks/' + t.id, { method: 'PATCH', body: { status } });
      loadTasks();
    }
    async function snooze(t) {
      await api('/tasks/' + t.id + '/snooze', { method: 'POST' });
      loadTasks();
      toast('已顺延至明天');
    }
    async function delTask(t) {
      if (!confirm('删除任务「' + t.title + '」？')) return;
      await api('/tasks/' + t.id, { method: 'DELETE' });
      loadTasks();
    }
    // 打卡：打开对话框，上传后刷新列表
    function checkin(t) { openCheckin(t, loadTasks); }

    // 计时联动：任务行直接开始/结束计时
    function isTiming(t) { return store.timer.running && store.timer.taskId === t.id; }
    async function timerForTask(t) {
      if (isTiming(t)) {
        const r = await finishTimer({ refresh: () => { loadTasks(); loadLogs(); } });
        toast(r.minutes ? '已记录 ' + r.minutes + ' 分钟到该任务' : '不足 1 分钟，未记录', r.minutes ? 'ok' : 'info');
        return;
      }
      // 正在为别的任务计时：先结算上一段
      if (store.timer.running) {
        const r0 = await finishTimer({ refresh: () => { loadTasks(); loadLogs(); } });
        if (r0.minutes) toast('已记录 ' + r0.minutes + ' 分钟到「' + (r0.taskTitle || '上个任务') + '」', 'ok');
      }
      store.timer.taskId = t.id;
      store.timer.taskTitle = t.title;
      store.timer.subjectId = t.subject_id || null;
      startTimer();
      toast('开始计时：' + t.title, 'ok');
    }

    const today = todayStr();
    function dueBadge(t) {
      if (!t.due_date) return null;
      if (t.due_date < today) return { cls: 'overdue', text: '已过期 ' + t.due_date.slice(5) };
      if (t.due_date === today) return { cls: 'today', text: '今天' };
      return { cls: 'gray', text: t.due_date.slice(5) };
    }

    // ---- 章节树 ----
    const curSubject = ref(null);
    const childrenMap = reactive({});
    const roots = ref([]);
    const expanded = reactive(new Set());
    const rootTitle = ref('');
    const ui = reactive({ expanded, editing: null, editText: '', childrenMap });
    const subjProgress = computed(() => {
      const s = store.subjects.find(x => x.id === curSubject.value);
      return s ? s.progress : 0;
    });

    async function loadTree() {
      if (!curSubject.value) { roots.value = []; return; }
      const list = await api('/chapters?subject_id=' + curSubject.value);
      for (const k of Object.keys(childrenMap)) delete childrenMap[k];
      for (const c of list) {
        const pid = c.parent_id || 0;
        (childrenMap[pid] = childrenMap[pid] || []).push(c);
      }
      roots.value = childrenMap[0] || [];
      await loadSubjects();
    }
    watch(curSubject, loadTree);

    async function addRoot() {
      if (!curSubject.value) { toast('请先选择科目'); return; }
      if (!rootTitle.value.trim()) { toast('请填写章节名称'); return; }
      await api('/chapters', { method: 'POST', body: { subject_id: curSubject.value, title: rootTitle.value.trim() } });
      rootTitle.value = '';
      loadTree();
    }
    async function delSubject(id) {
      const s = store.subjects.find(x => x.id === id);
      if (!confirm('删除科目「' + s.name + '」？其章节树将一并删除')) return;
      await api('/subjects/' + id, { method: 'DELETE' });
      await loadSubjects();
      if (curSubject.value === id) curSubject.value = store.subjects[0]?.id || null;
      toast('科目已删除');
    }

    // ---- 学习记录 ----
    const logs = ref([]);
    const newLog = reactive({ subject_id: null, minutes: 45, note: '', log_date: todayStr() });
    async function loadLogs() {
      logs.value = await api('/logs?from=' + todayStr(-30));
    }
    async function addLog() {
      const m = Number(newLog.minutes);
      if (!m || m <= 0) { toast('请填写有效分钟数'); return; }
      await api('/logs', { method: 'POST', body: { ...newLog, minutes: m } });
      newLog.note = '';
      loadLogs();
      toast('已记录学习时长', 'ok');
    }
    const logsByDay = computed(() => {
      const map = {};
      for (const l of logs.value) (map[l.log_date] = map[l.log_date] || []).push(l);
      return Object.entries(map).map(([date, items]) => ({ date, items, total: items.reduce((a, b) => a + b.minutes, 0) }));
    });

    onMounted(async () => {
      await loadSubjects();
      curSubject.value = store.subjects[0]?.id || null;
      loadTasks();
      loadLogs();
    });

    return {
      tab, view, tasks, doneTasks, newTask, showDone, loadTasks, addTask, setStatus, snooze, delTask, dueBadge, today, checkin, isTiming, timerForTask, fmtMinutes,
      store, curSubject, roots, ui, subjProgress, rootTitle, addRoot, delSubject, loadTree,
      logs, newLog, addLog, logsByDay,
    };
  },
  template: `
  <div>
    <div class="page-title">学习计划</div>
    <div class="page-sub">任务、章节进度与学习时长</div>

    <div class="tabs">
      <button :class="{on: tab==='tasks'}" @click="tab='tasks'">每日任务</button>
      <button :class="{on: tab==='chapters'}" @click="tab='chapters'">章节进度</button>
      <button :class="{on: tab==='logs'}" @click="tab='logs'">学习记录</button>
    </div>

    <!-- 任务 -->
    <div v-if="tab==='tasks'" class="card">
      <div class="row wrap" style="margin-bottom:14px">
        <input class="input" style="flex:2;min-width:180px" placeholder="任务内容，如：完成英语阅读 2 篇" v-model="newTask.title" @keyup.enter="addTask">
        <select class="select" style="width:110px" v-model="newTask.subject_id">
          <option :value="null">不限科目</option>
          <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input class="input" type="date" style="width:150px" v-model="newTask.due_date">
        <select class="select" style="width:96px" v-model="newTask.priority">
          <option :value="1">普通</option>
          <option :value="2">重要 🔥</option>
        </select>
        <button class="btn" @click="addTask">添加任务</button>
      </div>

      <div class="tabs" style="margin-bottom:6px">
        <button :class="{on: view==='today'}" @click="view='today'; loadTasks()">今日及逾期</button>
        <button :class="{on: view==='week'}" @click="view='week'; loadTasks()">未来一周</button>
        <button :class="{on: view==='all'}" @click="view='all'; loadTasks()">全部</button>
      </div>

      <div v-if="!tasks.length" class="empty"><span class="big">☕️</span>这个视图下没有待办任务</div>
      <div v-for="t in tasks" :key="t.id" class="taskrow">
        <div class="checkbox" @click="setStatus(t, 'done')">✓</div>
        <div class="title">{{ t.title }}</div>
        <span v-if="t.priority === 2" class="flag">🔥</span>
        <span v-if="t.subject_name" class="chip"><span class="dot" :style="{background:t.subject_color}"></span>{{ t.subject_name }}</span>
        <span v-if="dueBadge(t)" class="badge" :class="dueBadge(t).cls">{{ dueBadge(t).text }}</span>
        <span v-if="isTiming(t)" class="time-badge live" :title="'正在计时，今日已学 ' + (t.minutes_today||0) + ' 分钟'">⏱ 计时中<template v-if="t.minutes_today"> · 已 {{ fmtMinutes(t.minutes_today) }}</template></span>
        <span v-else-if="t.minutes_today" class="time-badge" :title="'今日 ' + t.minutes_today + ' 分钟，累计 ' + (t.minutes_total||0) + ' 分钟'">⏱ {{ fmtMinutes(t.minutes_today) }}<template v-if="t.minutes_total > t.minutes_today"> / 共 {{ fmtMinutes(t.minutes_total) }}</template></span>
        <button class="btn sm plain" @click="timerForTask(t)" :title="isTiming(t) ? '结束并记录本次计时' : '开始计时这个任务'">{{ isTiming(t) ? '■' : '▶' }}</button>
        <button class="btn sm plain" @click="checkin(t)" :title="t.images && t.images.length ? '查看打卡图（' + t.images.length + '）' : '上传打卡图'">📷<template v-if="t.images && t.images.length"> {{ t.images.length }}</template></button>
        <button class="btn sm plain" @click="snooze(t)" title="顺延到明天">顺延</button>
        <button class="btn sm plain" @click="delTask(t)">✕</button>
      </div>

      <div style="margin-top:16px">
        <div class="row" style="justify-content:space-between;cursor:pointer" @click="showDone = !showDone">
          <span class="muted small">已完成的任务（{{ doneTasks.length }}）{{ showDone ? '▲' : '▼' }}</span>
        </div>
        <template v-if="showDone">
          <div v-for="t in doneTasks" :key="t.id" class="taskrow">
            <div class="checkbox on" @click="setStatus(t, 'todo')" title="恢复为待办">✓</div>
            <div class="title done-t">{{ t.title }}</div>
            <span v-if="t.subject_name" class="chip"><span class="dot" :style="{background:t.subject_color}"></span>{{ t.subject_name }}</span>
            <span v-if="t.minutes_total" class="time-badge" :title="'累计学习 ' + t.minutes_total + ' 分钟'">⏱ {{ fmtMinutes(t.minutes_total) }}</span>
            <span class="badge gray">{{ (t.completed_at || '').slice(5, 16) }}</span>
            <button class="btn sm plain" @click="checkin(t)" :title="t.images && t.images.length ? '查看打卡图（' + t.images.length + '）' : '上传打卡图'">📷<template v-if="t.images && t.images.length"> {{ t.images.length }}</template></button>
            <button class="btn sm plain" @click="delTask(t)">✕</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 章节树 -->
    <div v-if="tab==='chapters'" class="card">
      <div class="row wrap" style="margin-bottom:14px">
        <select class="select" style="width:150px" v-model="curSubject">
          <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input class="input" style="width:220px" placeholder="一级章节名称" v-model="rootTitle" @keyup.enter="addRoot">
        <button class="btn ghost sm" @click="addRoot">＋ 添加一级章节</button>
        <span v-if="store.subjects.find(s => s.id === curSubject)" class="row" style="gap:8px;margin-left:auto">
          <span class="muted small">总进度 {{ subjProgress }}%</span>
          <div class="bar" style="width:130px"><i :style="{width: subjProgress + '%'}"></i></div>
          <button class="btn sm plain" @click="delSubject(curSubject)">删除科目</button>
        </span>
      </div>

      <div v-if="!roots.length" class="empty"><span class="big">🌱</span>还没有章节，在上面输入名称添加<br><span class="small">例如：第一章 函数与极限 → 再给它添加子章节 1.1 / 1.2 …</span></div>
      <div class="tree">
        <chapter-node v-for="r in roots" :key="r.id" :node="r" :kids="ui.childrenMap[r.id] || []" :ui="ui" @refresh="loadTree"></chapter-node>
      </div>
    </div>

    <!-- 学习记录 -->
    <div v-if="tab==='logs'" class="card">
      <div class="row wrap" style="margin-bottom:14px">
        <select class="select" style="width:130px" v-model="newLog.subject_id">
          <option :value="null">不限科目</option>
          <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input class="input" type="number" min="1" style="width:90px" v-model="newLog.minutes" placeholder="分钟">
        <input class="input" style="flex:1;min-width:160px" placeholder="备注（学了什么）" v-model="newLog.note">
        <input class="input" type="date" style="width:150px" v-model="newLog.log_date">
        <button class="btn" @click="addLog">记录</button>
      </div>

      <div v-if="!logsByDay.length" class="empty"><span class="big">📝</span>还没有学习记录<br>也可以在仪表盘用计时器自动记录</div>
      <div v-for="day in logsByDay" :key="day.date" style="margin-bottom:10px">
        <div class="row" style="justify-content:space-between;margin-bottom:2px">
          <span style="font-weight:600">{{ day.date }}</span>
          <span class="badge blue">共 {{ day.total }} 分钟</span>
        </div>
        <div v-for="l in day.items" :key="l.id" class="taskrow">
          <div class="title">{{ l.minutes }} 分钟 · {{ l.note || '学习' }}<span v-if="l.task_title" class="muted small">（{{ l.task_title }}）</span></div>
          <span v-if="l.subject_name" class="chip"><span class="dot" :style="{background:l.subject_color}"></span>{{ l.subject_name }}</span>
        </div>
      </div>
    </div>
  </div>`,
};
