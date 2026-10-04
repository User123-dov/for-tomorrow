// 塞壬唱片 + 本地音乐 迷你播放器：右下角悬浮，进站自动播放《生命流》，
// 支持搜索曲库添加歌曲、上传自己的音乐、切歌、暂停、查看歌单
import { api, toast } from './store.js';

const { ref, computed, onMounted, nextTick } = Vue;

export default {
  setup() {
    const songs = ref([]);
    const idx = ref(0);
    const playing = ref(false);
    const loading = ref(true);
    const current = ref({ name: '生命流', artist: '塞壬唱片' });
    const minimized = ref(localStorage.getItem('yt_msr_min') === '1');
    const blocked = ref(false);
    const showList = ref(false);
    const tab = ref('list');           // list | add
    const albums = ref([]);
    const albumQuery = ref('');
    const searching = ref(false);
    const openedAlbum = ref(null);     // {cid, name, songs}
    const uploading = ref(false);
    const fileInput = ref(null);
    let audio = null;
    let retryFor = '';

    function ensureAudio() {
      if (audio) return audio;
      audio = new Audio();
      audio.volume = 0.55;
      audio.addEventListener('ended', () => next());
      audio.addEventListener('playing', () => { playing.value = true; });
      audio.addEventListener('pause', () => { playing.value = false; });
      audio.addEventListener('error', () => {
        // 本地文件或 CDN 链接失效：msr 曲目重取一次，本地文件提示
        const cur = songs.value[idx.value];
        if (!cur) return;
        if (cur.type === 'local') { blocked.value = false; playing.value = false; toast('这个音频文件无法播放：' + cur.name, 'err'); return; }
        if (retryFor !== cur.cid) { retryFor = cur.cid; loadPlaylist().then(() => playIdx(idx.value)); }
      });
      return audio;
    }

    async function loadPlaylist() {
      try {
        const r = await api('/msr/playlist');
        songs.value = r.songs || [];
        return songs.value;
      } catch { return []; }
    }

    async function playIdx(i) {
      const list = songs.value;
      if (!list.length) return;
      idx.value = ((i % list.length) + list.length) % list.length;
      const song = list[idx.value];
      loading.value = true;
      current.value = song;
      try {
        let url = song.url;
        if (!url && song.cid) url = (await api('/msr/song/' + song.cid)).url;
        if (!url) throw new Error('没有播放地址');
        const a = ensureAudio();
        a.src = url;
        await a.play();
        blocked.value = false;
      } catch (e) {
        if (e.name === 'NotAllowedError' || /play\(\)/.test(String(e.message))) {
          blocked.value = true;
          armFirstClick();
        } else if (song.type === 'msr' && retryFor !== song.cid) {
          retryFor = song.cid;
          await loadPlaylist();
          playIdx(idx.value);
        }
      } finally { loading.value = false; }
    }

    let armed = false;
    function armFirstClick() {
      if (armed) return;
      armed = true;
      document.addEventListener('pointerdown', () => { armed = false; if (blocked.value) toggle(); }, { once: true });
    }

    function toggle() {
      const a = ensureAudio();
      if (!a.src) { playIdx(idx.value); return; }
      if (a.paused) a.play().catch(() => { blocked.value = true; armFirstClick(); });
      else a.pause();
    }

    function next() {
      if (songs.value.length < 2) return;
      let n = idx.value;
      while (n === idx.value) n = Math.floor(Math.random() * songs.value.length);
      playIdx(n);
    }

    function minimize(v) {
      minimized.value = v;
      localStorage.setItem('yt_msr_min', v ? '1' : '0');
    }

    // ---- 搜索曲库添加 ----
    async function searchAlbums() {
      searching.value = true;
      openedAlbum.value = null;
      try {
        const r = await api('/msr/albums' + (albumQuery.value.trim() ? '?q=' + encodeURIComponent(albumQuery.value.trim()) : ''));
        albums.value = r.albums;
        if (!r.albums.length) toast('没找到相关专辑，换个关键词试试', 'err');
      } catch (e) { toast(e.message, 'err'); }
      searching.value = false;
    }
    async function openAlbum(al) {
      searching.value = true;
      try {
        openedAlbum.value = await api('/msr/album/' + al.cid);
      } catch (e) { toast(e.message, 'err'); }
      searching.value = false;
    }
    async function addSongs(items) {
      try {
        const r = await api('/msr/playlist', { method: 'POST', body: { songs: items } });
        toast(r.added ? '已加入 ' + r.added + ' 首' : '这些歌都已在歌单里', r.added ? 'ok' : 'info');
        await loadPlaylist();
      } catch (e) { toast(e.message, 'err'); }
    }
    const inPlaylist = computed(() => new Set(songs.value.filter(s => s.cid).map(s => s.cid)));

    // ---- 上传本地音乐 ----
    function pickMusic() { fileInput.value.click(); }
    async function onUpload(e) {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      if (!files.length) return;
      uploading.value = true;
      try {
        const fd = new FormData();
        for (const f of files.slice(0, 20)) fd.append('audio', f, f.name);
        const r = await api('/msr/upload', { method: 'POST', body: fd });
        toast('已添加 ' + r.added.length + ' 首本地音乐', 'ok');
        await loadPlaylist();
        tab.value = 'list';
      } catch (err) { toast(err.message, 'err'); }
      uploading.value = false;
    }

    async function removeSong(song, ev) {
      if (ev) ev.stopPropagation();
      if (!confirm('从歌单移除「' + song.name + '」？' + (song.type === 'local' ? '（本地文件也会删除）' : ''))) return;
      try {
        await api('/msr/playlist/' + song.id, { method: 'DELETE' });
        const wasCurrent = idx.value === songs.value.findIndex(s => s.id === song.id);
        await loadPlaylist();
        if (wasCurrent) { idx.value = 0; if (songs.value.length) playIdx(0); else { ensureAudio().pause(); current.value = { name: '歌单为空', artist: '' }; } }
        toast('已移除');
      } catch (e) { toast(e.message, 'err'); }
    }

    onMounted(async () => {
      const list = await loadPlaylist();
      if (!list.length) { loading.value = false; current.value = { name: '曲库连接失败', artist: '' }; return; }
      const start = Math.max(0, list.findIndex(s => s.name === '生命流'));
      await nextTick();
      if (!minimized.value) playIdx(start);
      else loading.value = false;
    });

    return {
      songs, idx, playing, loading, current, minimized, blocked, showList, tab,
      albums, albumQuery, searching, openedAlbum, uploading, fileInput, inPlaylist,
      toggle, next, minimize, playIdx, searchAlbums, openAlbum, addSongs, pickMusic, onUpload, removeSong,
    };
  },
  template: `
  <div class="msr-playlist" v-if="showList">
    <div class="msr-pl-tabs">
      <button :class="{on: tab==='list'}" @click="tab='list'">歌单 {{ songs.length }}</button>
      <button :class="{on: tab==='add'}" @click="tab='add'; if (!albums.length) searchAlbums()">添加音乐</button>
    </div>

    <!-- 歌单 -->
    <div v-show="tab==='list'" class="msr-pl-list">
      <div v-for="(s, i) in songs" :key="s.id || i" class="msr-pl-row" :class="{on: idx === i}" @click="playIdx(i)">
        <span class="n">
          {{ s.name }}
          <span v-if="s.type === 'local'" class="msr-tag">本地</span>
        </span>
        <span class="a">
          <span v-if="idx === i && playing">正在播放</span>
          <button class="rm" title="从歌单移除" @click="removeSong(s, $event)">×</button>
        </span>
      </div>
      <div v-if="!songs.length" class="muted small" style="padding:14px;text-align:center">
        歌单是空的，去「添加音乐」加点歌吧
      </div>
    </div>

    <!-- 添加音乐 -->
    <div v-show="tab==='add'" class="msr-add">
      <div class="row" style="gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)">
        <input class="input" style="font-size:12px;padding:5px 8px" placeholder="搜塞壬唱片专辑，如 OST / 危机合约"
               v-model="albumQuery" @keyup.enter="searchAlbums">
        <button class="btn sm" :disabled="searching" @click="searchAlbums">{{ searching ? '…' : '搜' }}</button>
      </div>
      <div style="padding:8px 10px;border-bottom:1px solid var(--line)">
        <button class="btn sm ghost" style="width:100%" :disabled="uploading" @click="pickMusic">
          {{ uploading ? '上传中…' : '＋ 上传我的音乐（mp3 / flac / m4a…）' }}
        </button>
        <input ref="fileInput" type="file" accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.aac" multiple style="display:none" @change="onUpload">
      </div>

      <!-- 专辑列表 -->
      <div v-if="!openedAlbum" class="msr-pl-list" style="max-height:200px">
        <div v-for="al in albums" :key="al.cid" class="msr-pl-row" @click="openAlbum(al)">
          <span class="n">{{ al.name }}</span>
          <span class="a">选歌 ›</span>
        </div>
        <div v-if="!albums.length && !searching" class="muted small" style="padding:12px;text-align:center">搜一下想听的专辑名字</div>
      </div>

      <!-- 专辑曲目 -->
      <div v-else>
        <div class="row" style="justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--line)">
          <span class="small" style="font-weight:600">{{ openedAlbum.name }}</span>
          <span>
            <button class="btn sm" @click="addSongs(openedAlbum.songs)">全部加入</button>
            <button class="btn sm plain" @click="openedAlbum = null">返回</button>
          </span>
        </div>
        <div class="msr-pl-list" style="max-height:190px">
          <div v-for="s in openedAlbum.songs" :key="s.cid" class="msr-pl-row">
            <span class="n">{{ s.name }}</span>
            <span class="a">
              <span v-if="inPlaylist.has(s.cid)" class="muted">已加入</span>
              <button v-else class="btn-mini" @click="addSongs([s])">加入</button>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="msr-player" v-if="!minimized">
    <div class="msr-disc" :class="{spin: playing}" @click="toggle" :title="playing ? '暂停' : '播放'">♪</div>
    <div class="msr-meta" @click="toggle">
      <div class="msr-name" :title="current.name">{{ current.name }}</div>
      <div class="msr-sub">{{ blocked ? '点击任意处开始播放' : (playing ? '正在播放 · ' + (current.artist || '塞壬唱片') : (loading ? '加载中…' : '已暂停')) }}</div>
    </div>
    <div class="msr-btns">
      <button @click="showList = !showList" :class="{hot: showList}" title="歌单 / 添加音乐">☰</button>
      <button @click="toggle" :title="playing ? '暂停' : '播放'">{{ playing ? '❚❚' : '▶' }}</button>
      <button @click="next" title="随机切歌">⏭</button>
      <button @click="minimize(true); showList = false" title="收起">×</button>
    </div>
  </div>
  <button v-else class="msr-mini" @click="minimize(false)" title="塞壬唱片">♪</button>`,
};
