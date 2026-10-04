// 资料库：搜索 / 筛选 / 链接收藏 / 上传 / 阅读器
import { store, api, toast, navigate, TYPE_META, fmtSize } from '../store.js';

const { ref, reactive, computed, onMounted, watch } = Vue;

export default {
  setup() {
    const list = ref([]);
    const q = ref('');
    const type = ref('');
    const subjectId = ref('');
    const tag = ref('');
    const loading = ref(false);

    const showAdd = ref(false);
    const addForm = reactive({ url: '', subject_id: null, tags: '' });
    const fileInput = ref(null);

    const reader = ref(null);   // 正在阅读的资料
    const editor = ref(null);   // 正在编辑的资料
    const editForm = reactive({ title: '', subject_id: null, tags: '', note: '' });

    async function load() {
      loading.value = true;
      try {
        const params = new URLSearchParams();
        if (q.value) params.set('q', q.value);
        if (type.value) params.set('type', type.value);
        if (subjectId.value) params.set('subject_id', subjectId.value);
        if (tag.value) params.set('tag', tag.value);
        list.value = await api('/materials?' + params.toString());
      } catch (e) { toast(e.message, 'err'); }
      loading.value = false;
    }

    let searchTimer = null;
    watch([q, type, subjectId, tag], () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, q.value ? 350 : 0);
    });

    const tagCloud = computed(() => {
      const set = new Set();
      for (const m of list.value) for (const t of (m.tags || '').split(',').filter(Boolean)) set.add(t);
      return [...set].slice(0, 16);
    });

    async function addLink() {
      if (!addForm.url.trim()) { toast('请粘贴网址'); return; }
      try {
        const m = await api('/capture', { method: 'POST', body: { text: addForm.url, subject_id: addForm.subject_id, tags: addForm.tags } });
        const r = m.results[0];
        if (!r.ok) throw new Error(r.error);
        toast('已收藏：' + (r.material.title || '').slice(0, 40), 'ok');
        showAdd.value = false;
        addForm.url = '';
        load();
      } catch (e) { toast(e.message, 'err'); }
    }

    function pickFile() { fileInput.value.click(); }
    async function onFile(e) {
      const f = e.target.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      if (addSubjectForUpload.value) fd.append('subject_id', addSubjectForUpload.value);
      try {
        const m = await api('/upload', { method: 'POST', body: fd });
        toast('已上传：' + m.title, 'ok');
        load();
      } catch (err) { toast(err.message, 'err'); }
      e.target.value = '';
    }
    const addSubjectForUpload = ref(null);

    async function openMaterial(m) {
      if (m.type === 'article') {
        reader.value = m;
        try { reader.value = await api('/materials/' + m.id); } catch { /* 用列表里的概要展示 */ }
      } else if (m.type === 'file') {
        window.open('/files/' + m.local_path, '_blank');
      } else if (m.type === 'video') {
        navigate('videos', { open: m.id });
      } else {
        window.open(m.source_url, '_blank');
      }
    }

    function editMaterial(m) {
      editor.value = m;
      editForm.title = m.title;
      editForm.subject_id = m.subject_id;
      editForm.tags = m.tags;
      editForm.note = m.note;
    }
    async function saveEdit() {
      await api('/materials/' + editor.value.id, { method: 'PATCH', body: { ...editForm } });
      editor.value = null;
      load();
      toast('已保存', 'ok');
    }
    async function delMaterial(m) {
      if (!confirm('删除「' + m.title + '」？关联的本地文件也会删除')) return;
      await api('/materials/' + m.id, { method: 'DELETE' });
      load();
      toast('已删除');
    }

    onMounted(async () => {
      await load();
      const openId = store.route.query.open;
      if (openId) {
        try {
          const m = await api('/materials/' + openId);
          if (m.type === 'video') navigate('videos', { open: m.id });
          else reader.value = m;
        } catch { /* 条目可能已被删除 */ }
      }
    });

    return {
      list, q, type, subjectId, tag, loading, load, tagCloud,
      showAdd, addForm, addLink, fileInput, pickFile, onFile, addSubjectForUpload,
      reader, editor, editForm, editMaterial, saveEdit, delMaterial, openMaterial,
      store, TYPE_META, fmtSize,
    };
  },
  template: `
  <div>
    <div class="page-title">资料库</div>
    <div class="page-sub">收藏、剪藏、上传的资料都在这里，支持全文搜索</div>

    <div class="card" style="margin-bottom:14px">
      <div class="row wrap">
        <input class="input" style="flex:2;min-width:200px" placeholder="搜索标题 / 正文 / 备注 / 标签…" v-model="q">
        <select class="select" style="width:130px" v-model="subjectId">
          <option value="">全部科目</option>
          <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button class="btn ghost" @click="showAdd = true">🔗 收藏链接</button>
        <button class="btn ghost" @click="pickFile">📎 上传文件</button>
        <input ref="fileInput" type="file" style="display:none" @change="onFile">
      </div>
      <div class="row wrap" style="margin-top:10px">
        <span class="chip click" :class="{on: type===''}" @click="type=''">全部</span>
        <span v-for="(meta, t) in TYPE_META" :key="t" class="chip click" :class="{on: type===t}" @click="type = (type===t ? '' : t)">{{ meta.icon }} {{ meta.label }}</span>
        <span v-for="t in tagCloud" :key="t" class="chip click" :class="{on: tag===t}" @click="tag = (tag===t ? '' : t)"># {{ t }}</span>
        <span v-if="loading" class="muted small">加载中…</span>
      </div>
    </div>

    <div class="card">
      <div v-if="!list.length" class="empty"><span class="big">🗂️</span>没有符合条件的资料<br><span class="small">可以在「采集中心」粘贴网址爬取，或点右上角收藏 / 上传</span></div>
      <div v-for="m in list" :key="m.id" class="mrow">
        <div class="mico" :style="{background: TYPE_META[m.type]?.bg}">{{ TYPE_META[m.type]?.icon }}</div>
        <div style="flex:1;min-width:0">
          <div class="mtitle" @click="openMaterial(m)">{{ m.title }}</div>
          <div class="muted small" style="margin:2px 0 4px">
            {{ TYPE_META[m.type]?.label }}<template v-if="m.site"> · {{ m.site }}</template>
            <template v-if="m.type === 'file' && m.file_size"> · {{ fmtSize(m.file_size) }}</template>
            <template v-if="m.type === 'video' && m.duration"> · {{ Math.round(m.duration/60) }} 分钟</template>
            · {{ m.created_at?.slice(0, 10) }}
          </div>
            <div class="row wrap" style="gap:6px">
              <span v-if="m.subject_name" class="chip"><span class="dot" :style="{background:m.subject_color}"></span>{{ m.subject_name }}</span>
              <span v-for="t in (m.tags || '').split(',').filter(Boolean)" :key="t" class="tagchip"># {{ t }}</span>
            </div>
            <div v-if="m.summary && m.summary !== '-' && m.type !== 'article'" class="msummary">{{ m.summary }}</div>
        </div>
        <div class="row" style="gap:6px;flex-shrink:0">
          <a v-if="m.source_url" :href="m.source_url" target="_blank" class="btn sm plain" title="打开原文">原文</a>
          <button class="btn sm plain" @click="editMaterial(m)">编辑</button>
          <button class="btn sm plain" @click="delMaterial(m)">✕</button>
        </div>
      </div>
    </div>

    <!-- 收藏链接 -->
    <div v-if="showAdd" class="overlay" @click.self="showAdd = false">
      <div class="modal">
        <div class="modal-h"><b>收藏链接</b><button class="x" @click="showAdd = false">×</button></div>
        <div class="modal-b">
          <label class="fl">网址（会自动抓取标题和摘要）</label>
          <input class="input" placeholder="https://…" v-model="addForm.url">
          <div class="row" style="margin-top:12px">
            <select class="select" style="width:140px" v-model="addForm.subject_id">
              <option :value="null">不限科目</option>
              <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <input class="input" style="flex:1" placeholder="标签，逗号分隔，如：真题,写作" v-model="addForm.tags">
            <button class="btn" @click="addLink">收藏</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 阅读器 -->
    <div v-if="reader" class="overlay" @click.self="reader = null">
      <div class="modal wide">
        <div class="modal-h">
          <div style="min-width:0">
            <b style="font-size:15px">{{ reader.title }}</b>
            <div class="muted small" v-if="reader.site">{{ reader.site }} · {{ reader.created_at?.slice(0, 10) }} · <a :href="reader.source_url" target="_blank">查看原文</a></div>
          </div>
          <button class="x" @click="reader = null">×</button>
        </div>
        <div class="modal-b">
          <div v-if="reader.content_html" class="article-body" v-html="reader.content_html"></div>
          <div v-else-if="reader.content_text" style="white-space:pre-wrap">{{ reader.content_text }}</div>
          <div v-else class="muted">该页面没有可提取的正文，<a :href="reader.source_url" target="_blank">去原网页查看</a></div>
        </div>
      </div>
    </div>

    <!-- 编辑 -->
    <div v-if="editor" class="overlay" @click.self="editor = null">
      <div class="modal">
        <div class="modal-h"><b>编辑资料</b><button class="x" @click="editor = null">×</button></div>
        <div class="modal-b">
          <label class="fl">标题</label>
          <input class="input" v-model="editForm.title">
          <div class="row" style="margin-top:12px">
            <select class="select" style="width:140px" v-model="editForm.subject_id">
              <option :value="null">不限科目</option>
              <option v-for="s in store.subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <input class="input" style="flex:1" placeholder="标签，逗号分隔" v-model="editForm.tags">
          </div>
          <label class="fl" style="margin-top:12px">备注</label>
          <textarea class="textarea" v-model="editForm.note" placeholder="记点什么，比如用法、重要页码…"></textarea>
          <div class="row" style="margin-top:16px;justify-content:flex-end">
            <button class="btn plain" @click="editor = null">取消</button>
            <button class="btn" @click="saveEdit">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
