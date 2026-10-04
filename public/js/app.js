import { store, parseHash, loadSubjects, navigate, setThemeBase, setThemeAccent } from './store.js';
import { ICONS } from './icons.js?v=4';
import DashView from './views/dashboard.js?v=4';
import PlanView from './views/plan.js?v=4';
import MaterialsView from './views/materials.js?v=4';
import VideosView from './views/videos.js?v=4';
import FrontierView from './views/frontier.js?v=4';
import CaptureView from './views/capture.js?v=4';
import SettingsView from './views/settings.js?v=4';
import MsrPlayer from './msr.js?v=4';
import CheckinDialog from './checkin.js?v=4';
import HomeView from './views/home.js?v=4';

const { createApp, computed } = Vue;

const VIEWS = {
  home: { comp: HomeView, label: '主菜单' },
  dashboard: { comp: DashView, label: '终端' },
  plan: { comp: PlanView, label: '学习计划' },
  materials: { comp: MaterialsView, label: '资料库' },
  videos: { comp: VideosView, label: '视频库' },
  frontier: { comp: FrontierView, label: '专业前沿' },
  capture: { comp: CaptureView, label: '采集中心' },
  settings: { comp: SettingsView, label: '设置' },
};

const App = {
  setup() {
    const current = computed(() => VIEWS[store.route.view] || VIEWS.home);
    const isHome = computed(() => store.route.view === 'home');
    const go = (v) => navigate(v);
    return { store, VIEWS, current, isHome, go, setThemeBase, setThemeAccent };
  },
  template: `
  <div class="layout" :class="{ 'is-home': isHome }">
    <aside class="sidebar" v-if="!isHome">
      <div class="logo">
        <div class="t">为了明日</div>
        <div class="s">FOR TOMORROW</div>
      </div>
      <button v-for="(v, key) in VIEWS" :key="key" class="nav-item" :class="{active: store.route.view === key}" @click="go(key)">
        <span class="ico"><nav-icon :name="key"/></span>{{ v.label }}
      </button>

      <div class="theme-row" title="切换明暗与配色">
        <button :class="{on: store.theme.base==='dark'}" @click="setThemeBase('dark')">深</button>
        <button :class="{on: store.theme.base==='light'}" @click="setThemeBase('light')">浅</button>
        <button :class="{on: store.theme.accent==='cyan'}" @click="setThemeAccent('cyan')" style="color:#3fc1ff">青</button>
        <button :class="{on: store.theme.accent==='amber'}" @click="setThemeAccent('amber')" style="color:#ffc82c">黄</button>
      </div>

      <div class="foot">数据保存在本地 data/ 文件夹<br>备份复制该文件夹即可</div>
    </aside>

    <main class="main"><div class="page">
      <component :is="current.comp" />
    </div></main>

    <nav class="bottomnav" v-if="!isHome">
      <button v-for="(v, key) in VIEWS" :key="key" :class="{on: store.route.view === key}" @click="go(key)">
        <span class="ico"><nav-icon :name="key"/></span>{{ v.label }}
      </button>
    </nav>

    <div class="toasts">
      <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.type">{{ t.msg }}</div>
    </div>

    <msr-player />
    <task-checkin />
  </div>`,
};

const app = createApp(App);
// 细线条图标组件
app.component('nav-icon', {
  props: { name: String },
  computed: { svg() { return ICONS[this.name] || ''; } },
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="svg"></svg>`,
});
app.component('chapter-node', PlanView.chapterNode);
app.component('msr-player', MsrPlayer);
app.component('task-checkin', CheckinDialog);
app.directive('focus', { mounted: (el) => el.focus() });
app.config.errorHandler = (err, inst, info) => {
  console.error('[vue]', err, info);
  document.title = 'VUE_ERR: ' + (err && err.message);
};
app.mount('#app');

window.addEventListener('hashchange', () => { store.route = parseHash(); });
store.route = parseHash();
loadSubjects();

// 全局秒表：计时运行时每秒自增，驱动所有页面的计时显示
setInterval(() => { if (store.timer.running) store.tick += 1; }, 1000);
