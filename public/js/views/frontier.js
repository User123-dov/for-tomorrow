// 专业前沿：复合材料/材科基方向 —— 论文速递、理解笔记、目标院校
import { store, api, toast } from '../store.js';

const { ref, reactive, computed, onMounted } = Vue;

export default {
  setup() {
    const tab = ref('papers');

    // ---- 论文速递 ----
    const kw = ref('composite materials');
    const days = ref(180);
    const papers = ref([]);
    const searching = ref(false);
    const searched = ref(false);
    const savedUrls = ref(new Set());

    async function search() {
      searching.value = true;
      searched.value = false;
      try {
        const r = await api('/papers/search?kw=' + encodeURIComponent(kw.value) + '&days=' + days.value);
        papers.value = r.papers;
        searched.value = true;
      } catch (e) { toast(e.message, 'err'); }
      searching.value = false;
    }

    async function loadSaved() {
      const list = await api('/materials?type=article&tag=论文&limit=200');
      savedUrls.value = new Set(list.map(m => m.source_url));
      return list;
    }

    async function savePaper(p) {
      try {
        await api('/materials', {
          method: 'POST',
          body: {
            type: 'article', title: p.title, source_url: p.url,
            summary: (p.abstract || '').slice(0, 800) || [p.journal, p.year].filter(Boolean).join(' · '),
            tags: '论文,专业前沿', subject_id: (store.subjects.find(s => s.name === '专业课') || {}).id || null,
          },
        });
        savedUrls.value.add(p.url);
        toast('已收藏到资料库，可在「理解笔记」里写心得', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    }

    // ---- 理解笔记（收藏的论文） ----
    const notes = ref([]);
    const editingNote = reactive({ id: null, text: '' });

    async function loadNotes() {
      notes.value = await api('/materials?type=article&tag=论文&limit=200');
    }
    function startNote(m) { editingNote.id = m.id; editingNote.text = m.note || ''; }
    async function saveNote(m) {
      await api('/materials/' + m.id, { method: 'PATCH', body: { note: editingNote.text } });
      m.note = editingNote.text;
      editingNote.id = null;
      toast('理解已保存', 'ok');
    }
    async function delNote(m) {
      if (!confirm('删除这篇论文的收藏和笔记？')) return;
      await api('/materials/' + m.id, { method: 'DELETE' });
      savedUrls.value.delete(m.source_url);
      loadNotes();
    }

    // ---- 目标院校 ----
    const schools = ref([]);
    const showSchool = ref(false);
    const schoolForm = reactive({ title: '', source_url: '', note: '' });
    const editingSchool = ref(null);
    const schoolEditForm = reactive({ title: '', source_url: '', note: '' });

    // 按名称自动查找院校链接
    const schoolQuery = ref('');
    const schoolSearching = ref(false);
    const schoolGroups = ref([]);

    const savedSchoolUrls = computed(() => new Set(schools.value.map(s => s.source_url)));

    // 自动提取关键信息（报考要求 / 考试科目 / 分数线）
    const schoolInfo = ref([]);
    const infoLoading = ref(false);
    const infoSearched = ref(false);

    async function getInfo() {
      const name = schoolQuery.value.trim();
      if (!name) { toast('先在上面输入院校名称'); return; }
      infoLoading.value = true;
      infoSearched.value = true;
      schoolInfo.value = [];
      try {
        const r = await api('/search/school-info?name=' + encodeURIComponent(name) + '&college=' + encodeURIComponent('材料科学与工程学院'));
        schoolInfo.value = r.findings || [];
        if (!schoolInfo.value.length) toast('这次没提取到关键内容，部分网站反爬较强，可稍后重试', 'err');
        else toast('已从 ' + schoolInfo.value.length + ' 个页面提取到关键信息', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      infoLoading.value = false;
    }
    async function saveInfoPage(f) {
      try {
        await api('/materials', {
          method: 'POST',
          body: { type: 'article', title: f.title || f.site, source_url: f.url, summary: '报考关键信息页（自动提取来源）', tags: '目标院校' },
        });
        toast('已收藏到资料库', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    }

    async function searchSchool() {
      const name = schoolQuery.value.trim();
      if (!name) { toast('请输入院校名称，如：沈阳航空航天大学'); return; }
      schoolSearching.value = true;
      schoolGroups.value = [];
      try {
        const r = await api('/search/school?name=' + encodeURIComponent(name));
        schoolGroups.value = r.groups;
        if (!r.groups.some(g => g.results.length)) toast('没搜到相关链接，换个名称试试', 'err');
      } catch (e) { toast(e.message, 'err'); }
      schoolSearching.value = false;
    }
    async function saveFoundLink(item, label) {
      try {
        await api('/materials', {
          method: 'POST',
          body: { type: 'link', title: item.title, source_url: item.url, note: label + (item.snippet ? ' · ' + item.snippet.slice(0, 80) : ''), tags: '目标院校' },
        });
        await loadSchools();
        toast('已保存到目标院校', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    }

    async function loadSchools() {
      schools.value = await api('/materials?type=link&tag=目标院校&limit=100');
    }
    async function addSchool() {
      if (!schoolForm.title.trim() || !schoolForm.source_url.trim()) { toast('名称和网址都要填'); return; }
      await api('/materials', { method: 'POST', body: { type: 'link', tags: '目标院校', ...schoolForm } });
      schoolForm.title = ''; schoolForm.source_url = ''; schoolForm.note = '';
      showSchool.value = false;
      loadSchools();
      toast('已添加院校链接', 'ok');
    }
    function editSchool(m) {
      editingSchool.value = m;
      schoolEditForm.title = m.title;
      schoolEditForm.source_url = m.source_url;
      schoolEditForm.note = m.note || '';
    }
    async function saveSchool() {
      await api('/materials/' + editingSchool.value.id, { method: 'PATCH', body: { ...schoolEditForm } });
      editingSchool.value = null;
      loadSchools();
      toast('已保存', 'ok');
    }
    async function delSchool(m) {
      if (!confirm('删除「' + m.title + '」？')) return;
      await api('/materials/' + m.id, { method: 'DELETE' });
      loadSchools();
    }

    onMounted(async () => {
      loadSaved().then(loadNotes);
      loadSchools();
      search();
    });

    return {
      tab, kw, days, papers, searching, searched, savedUrls, search, savePaper,
      notes, editingNote, startNote, saveNote, delNote, loadNotes,
      schools, showSchool, schoolForm, addSchool, editingSchool, schoolEditForm, editSchool, saveSchool, delSchool, loadSchools,
      schoolQuery, schoolSearching, schoolGroups, searchSchool, saveFoundLink, savedSchoolUrls,
      schoolInfo, infoLoading, infoSearched, getInfo, saveInfoPage,
    };
  },
  template: `
  <div>
    <div class="page-title">专业前沿</div>
    <div class="page-sub">复合材料与工程 · 材料科学基础 —— 论文、理解与目标院校</div>

    <div class="tabs">
      <button :class="{on: tab==='papers'}" @click="tab='papers'">论文速递</button>
      <button :class="{on: tab==='notes'}" @click="tab='notes'; loadNotes()">理解笔记 <span class="badge gray">{{ notes.length }}</span></button>
      <button :class="{on: tab==='schools'}" @click="tab='schools'; loadSchools()">目标院校 <span class="badge gray">{{ schools.length }}</span></button>
    </div>

    <!-- 论文速递 -->
    <div v-if="tab==='papers'">
      <div class="card" style="margin-bottom:14px">
        <div class="row wrap">
          <input class="input" style="flex:2;min-width:200px" placeholder="关键词，如 composite materials / fiber reinforced / 材料科学基础主题" v-model="kw" @keyup.enter="search">
          <select class="select" style="width:130px" v-model="days">
            <option :value="90">近 3 个月</option>
            <option :value="180">近半年</option>
            <option :value="365">近一年</option>
          </select>
          <button class="btn" :disabled="searching" @click="search">{{ searching ? '检索中…' : '🔍 检索最新论文' }}</button>
        </div>
        <div class="muted small" style="margin-top:8px">数据来自 Crossref（Elsevier / Springer 等出版社的正式期刊论文元数据与摘要），收藏后可在下方写理解笔记</div>
      </div>

      <div v-if="searching" class="card"><div class="empty">正在检索，请稍候…</div></div>
      <div v-else-if="searched && !papers.length" class="card"><div class="empty"><span class="big">🔍</span>这个关键词近段时间没有新论文<br>换个关键词或扩大时间范围试试</div></div>

      <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start">
        <div v-for="p in papers" :key="p.doi" class="card">
          <a :href="p.url" target="_blank" style="font-weight:600;font-size:14px;word-break:break-word">{{ p.title }}</a>
          <div class="muted small" style="margin:6px 0">
            {{ p.journal }}<template v-if="p.year"> · {{ p.year }}</template><template v-if="p.citations"> · 被引 {{ p.citations }}</template>
          </div>
          <div v-if="p.authors" class="muted small">{{ p.authors }}</div>
          <div v-if="p.abstract" class="small" style="margin-top:8px;color:#45506a;line-height:1.7">
            {{ p.abstract.slice(0, 180) }}{{ p.abstract.length > 180 ? '…' : '' }}
          </div>
          <div v-if="p.keywords && p.keywords.length" class="row wrap" style="margin-top:10px;gap:5px">
            <span v-for="k in p.keywords" :key="k" class="chip click" :class="{on: kw === k}" :title="'点击用「' + k + '」重新检索'" @click="kw = k; search()">{{ k }}</span>
          </div>
          <div class="row" style="margin-top:10px;justify-content:space-between">
            <a :href="p.url" target="_blank" class="btn sm plain">查看原文</a>
            <button class="btn sm" :disabled="savedUrls.has(p.url)" @click="savePaper(p)">{{ savedUrls.has(p.url) ? '已收藏 ✓' : '+ 收藏精读' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 理解笔记 -->
    <div v-if="tab==='notes'" class="card">
      <div v-if="!notes.length" class="empty"><span class="big">📝</span>还没有收藏的论文<br>去「论文速递」收藏几篇，在这里写下你的理解</div>
      <p class="muted small" style="margin-bottom:12px">读完论文后用自己的话写理解：新方法是什么、和材科基里哪个知识点呼应、能用在哪类题/课题里——这比收藏本身更值钱。</p>
      <div v-for="m in notes" :key="m.id" style="border-bottom:1px solid var(--line);padding:12px 0">
        <div class="row wrap" style="justify-content:space-between">
          <a :href="m.source_url" target="_blank" style="font-weight:600">{{ m.title }}</a>
          <span class="muted small">{{ m.created_at?.slice(0, 10) }}</span>
        </div>
        <template v-if="editingNote.id === m.id">
          <textarea class="textarea" style="margin-top:8px;min-height:100px" v-model="editingNote.text" placeholder="我的理解：这篇论文讲了什么新东西？和材科基的哪个章节/概念相关？"></textarea>
          <div class="row" style="margin-top:8px;justify-content:flex-end">
            <button class="btn sm plain" @click="editingNote.id = null">取消</button>
            <button class="btn sm" @click="saveNote(m)">保存理解</button>
          </div>
        </template>
        <template v-else>
          <div v-if="m.note" class="small" style="margin-top:6px;white-space:pre-wrap;color:#45506a">{{ m.note }}</div>
          <div v-else class="muted small" style="margin-top:6px">还没写理解笔记</div>
          <div class="row" style="margin-top:8px;gap:6px">
            <button class="btn sm ghost" @click="startNote(m)">{{ m.note ? '修改理解' : '写理解' }}</button>
            <button class="btn sm plain" @click="delNote(m)">删除</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 目标院校 -->
    <div v-if="tab==='schools'" class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <span class="muted small">目标院校的招生网、学院官网、专业目录、复试线等链接都放这里</span>
        <button class="btn sm" @click="showSchool = true">＋ 手动添加</button>
      </div>

      <div class="cap-result" style="margin-bottom:14px;display:block">
        <b>🔍 输入院校名称，自动查找材料相关的院系与招生链接</b>
        <div class="row wrap" style="margin-top:8px">
          <input class="input" style="flex:1;min-width:200px" placeholder="院校名称，如：哈尔滨工业大学" v-model="schoolQuery" @keyup.enter="searchSchool">
          <button class="btn" :disabled="schoolSearching" @click="searchSchool">{{ schoolSearching ? '查找中…' : '自动查找' }}</button>
        </div>
        <div class="muted small" style="margin-top:6px">只找材料方向的：材料学院官网、学院研究生招生、材料专业复试线。结果可一键收藏。</div>
        <div v-for="g in schoolGroups" :key="g.key" style="margin-top:12px">
          <div style="font-weight:600;font-size:13px">{{ g.label }}</div>
          <div v-if="g.error" class="small" style="color:var(--danger)">{{ g.error }}</div>
          <div v-for="item in g.results" :key="item.url" class="row wrap" style="padding:5px 0;gap:8px;align-items:flex-start">
            <div style="flex:1;min-width:0">
              <a :href="item.url" target="_blank" class="small" style="font-weight:500;word-break:break-all">{{ item.title }}</a>
              <div class="muted small" style="word-break:break-all">{{ item.snippet || item.url }}</div>
            </div>
            <button class="btn sm" :disabled="savedSchoolUrls.has(item.url)" @click="saveFoundLink(item, g.label)">{{ savedSchoolUrls.has(item.url) ? '已收藏 ✓' : '收藏' }}</button>
          </div>
        </div>

        <div class="row wrap" style="margin-top:14px">
          <button class="btn ghost" :disabled="infoLoading || !schoolQuery.trim()" @click="getInfo">{{ infoLoading ? '正在抓取相关网页并提取（约半分钟）…' : '📊 自动提取报考要求与往年分数线' }}</button>
          <span class="muted small">自动从公开网页抽取，仅供参考，务必以官方文件为准</span>
        </div>
        <div v-for="(f, i) in schoolInfo" :key="'f'+i" class="cap-result" style="margin-top:12px;display:block">
          <div class="row" style="justify-content:space-between">
            <a :href="f.url" target="_blank" style="font-weight:600;word-break:break-all">{{ f.title || f.site }}</a>
            <span class="badge gray">{{ f.site }}</span>
          </div>
          <template v-if="f.subjectLines && f.subjectLines.length">
            <div class="small" style="font-weight:600;margin-top:8px">📋 考试科目</div>
            <div v-for="l in f.subjectLines" :key="'s'+i+l" class="small" style="margin-top:2px">• {{ l }}</div>
          </template>
          <template v-if="f.tables && f.tables.length">
            <div class="small" style="font-weight:600;margin-top:8px">📈 分数线表格</div>
            <div v-for="(tb, ti) in f.tables" :key="'t'+i+ti" class="article-body" style="margin-top:4px">
              <table><tr v-for="(row, ri) in tb" :key="ri"><td v-for="(c, ci) in row" :key="ci">{{ c }}</td></tr></table>
            </div>
          </template>
          <template v-if="f.scoreLines && f.scoreLines.length">
            <div class="small" style="font-weight:600;margin-top:8px">📈 分数线相关内容</div>
            <div v-for="l in f.scoreLines" :key="'c'+i+l" class="small" style="margin-top:2px">• {{ l }}</div>
          </template>
          <template v-if="f.reqLines && f.reqLines.length">
            <div class="small" style="font-weight:600;margin-top:8px">📌 报考要求 / 招生人数</div>
            <div v-for="l in f.reqLines" :key="'r'+i+l" class="small" style="margin-top:2px">• {{ l }}</div>
          </template>
          <div class="row" style="margin-top:10px">
            <button class="btn sm ghost" @click="saveInfoPage(f)">收藏此页到资料库</button>
          </div>
        </div>
        <div v-if="!infoLoading && infoSearched && !schoolInfo.length" class="muted small" style="margin-top:10px">
          这次没提取到关键内容（部分网站反爬较强或页面结构特殊），可稍后重试，或先看上面搜到的链接。
        </div>
      </div>

      <div v-if="!schools.length" class="empty"><span class="big">🎓</span>还没有收藏的院校链接<br>用上面的自动查找，或点右上角手动添加</div>
      <div class="grid two-col" style="align-items:stretch">
        <div v-for="s in schools" :key="s.id" class="cap-result ok" style="flex-direction:column;align-items:stretch">
          <a :href="s.source_url" target="_blank" style="font-weight:600">{{ s.title }}</a>
          <div class="muted small" style="margin:4px 0;word-break:break-all">{{ s.note || s.source_url }}</div>
          <div class="row" style="gap:6px">
            <a :href="s.source_url" target="_blank" class="btn sm ghost">打开</a>
            <button class="btn sm plain" @click="editSchool(s)">编辑</button>
            <button class="btn sm plain" @click="delSchool(s)">删除</button>
          </div>
        </div>
      </div>

      <div v-if="showSchool" class="overlay" @click.self="showSchool = false">
        <div class="modal">
          <div class="modal-h"><b>添加院校链接</b><button class="x" @click="showSchool = false">×</button></div>
          <div class="modal-b">
            <label class="fl">名称（如：XX大学材料学院官网）</label>
            <input class="input" v-model="schoolForm.title" placeholder="名称">
            <label class="fl" style="margin-top:10px">网址</label>
            <input class="input" v-model="schoolForm.source_url" placeholder="https://…">
            <label class="fl" style="margin-top:10px">备注（招生简章 / 专业目录 / 复试线…）</label>
            <input class="input" v-model="schoolForm.note" placeholder="备注">
            <div class="row" style="margin-top:16px;justify-content:flex-end">
              <button class="btn plain" @click="showSchool = false">取消</button>
              <button class="btn" @click="addSchool">添加</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="editingSchool" class="overlay" @click.self="editingSchool = null">
        <div class="modal">
          <div class="modal-h"><b>编辑链接</b><button class="x" @click="editingSchool = null">×</button></div>
          <div class="modal-b">
            <label class="fl">名称</label>
            <input class="input" v-model="schoolEditForm.title">
            <label class="fl" style="margin-top:10px">网址</label>
            <input class="input" v-model="schoolEditForm.source_url">
            <label class="fl" style="margin-top:10px">备注</label>
            <input class="input" v-model="schoolEditForm.note">
            <div class="row" style="margin-top:16px;justify-content:flex-end">
              <button class="btn plain" @click="editingSchool = null">取消</button>
              <button class="btn" @click="saveSchool">保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
