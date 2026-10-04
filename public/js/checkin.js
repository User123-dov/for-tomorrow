// 任务打卡配图：全局对话框（仪表盘和计划页共用）
// 支持选文件 / Ctrl+V 粘贴截图 / 自动压缩 / 大图预览 / 删除 / 顺带完成任务
import { store, api, toast } from './store.js';

const { ref, computed, watch, nextTick } = Vue;

// 客户端压缩：长边压到 1600px、JPEG 85%，手机拍的 4MB 照片压到几百 KB
async function compressImage(file, maxDim = 1600, quality = 0.85) {
  if (!/^image\//.test(file.type)) return null;
  try {
    if (file.size < 400 * 1024) return file; // 小图不折腾
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) return file;
    return new File([blob], (file.name || 'checkin').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // 无法解码（如某些手机格式）就传原图
  }
}

export default {
  name: 'TaskCheckin',
  setup() {
    const fileInput = ref(null);
    const uploading = ref(false);
    const lightbox = ref(null);
    const dragOver = ref(false);

    const task = computed(() => store.checkin.task);
    const images = computed(() => (task.value && task.value.images) || []);

    function close() { store.checkin.task = null; lightbox.value = null; }
    function pick() { fileInput.value.click(); }

    async function uploadFiles(fileList) {
      const list = [...fileList].filter(f => /^image\//.test(f.type));
      if (!list.length) { toast('只能上传图片（jpg / png / gif / webp）'); return; }
      uploading.value = true;
      try {
        const fd = new FormData();
        for (const f of list.slice(0, 9)) {
          const out = await compressImage(f);
          if (out) fd.append('images', out, out.name);
        }
        const r = await api('/tasks/' + task.value.id + '/images', { method: 'POST', body: fd });
        task.value.images = [...(task.value.images || []), ...r.images];
        toast('已添加 ' + r.images.length + ' 张打卡图', 'ok');
        store.checkin.onChanged && store.checkin.onChanged();
      } catch (e) { toast(e.message, 'err'); }
      uploading.value = false;
    }

    async function onPick(e) {
      if (e.target.files?.length) await uploadFiles(e.target.files);
      e.target.value = '';
    }

    async function onPaste(e) {
      const files = [...(e.clipboardData?.items || [])]
        .filter(it => it.kind === 'file' && /^image\//.test(it.type))
        .map(it => it.getAsFile())
        .filter(Boolean);
      if (files.length) { e.preventDefault(); await uploadFiles(files); }
    }

    async function removeImage(img) {
      if (!confirm('删除这张打卡图？')) return;
      await api('/tasks/images/' + img.id, { method: 'DELETE' });
      task.value.images = (task.value.images || []).filter(i => i.id !== img.id);
      if (lightbox.value?.id === img.id) lightbox.value = null;
      store.checkin.onChanged && store.checkin.onChanged();
    }

    async function doneAndClose() {
      if (task.value.status !== 'done') {
        await api('/tasks/' + task.value.id, { method: 'PATCH', body: { status: 'done' } });
        toast('任务完成，打卡已记录 ✓', 'ok');
        store.checkin.onChanged && store.checkin.onChanged();
      }
      close();
    }

    // 打开时聚焦到对话框，方便直接 Ctrl+V
    watch(() => store.checkin.task, async (t) => {
      if (t) { await nextTick(); document.querySelector('.checkin-modal')?.focus(); }
    });

    return { store, task, images, fileInput, uploading, lightbox, dragOver, close, pick, onPick, onPaste, removeImage, doneAndClose,
             onDrop(e) { dragOver.value = false; if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files); } };
  },
  template: `
  <div v-if="task" class="overlay" @click.self="close">
    <div class="modal checkin-modal" tabindex="-1" @paste="onPaste"
         @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop">
      <div class="modal-h">
        <div style="min-width:0">
          <b>📷 学习打卡</b>
          <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ task.title }}</div>
        </div>
        <button class="x" @click="close">×</button>
      </div>
      <div class="modal-b">
        <div class="checkin-drop" :class="{over: dragOver}" @click="pick">
          <div class="big">🖼️</div>
          <div>点击选择图片，或把图片拖进来，也可以直接 <span class="kbd">Ctrl + V</span> 粘贴截图</div>
          <div class="muted small">手机拍的笔记 / 进度照片会自动压缩后保存在本机</div>
          <input ref="fileInput" type="file" accept="image/*" multiple style="display:none" @change="onPick">
        </div>

        <div v-if="uploading" class="muted small" style="margin-top:10px">上传中…</div>

        <div v-if="images.length" class="checkin-grid">
          <div v-for="img in images" :key="img.id" class="checkin-thumb">
            <img :src="img.url" loading="lazy" @click="lightbox = img">
            <button class="del" @click.stop="removeImage(img)" title="删除">×</button>
          </div>
        </div>
        <div v-else-if="!uploading" class="muted small" style="margin-top:10px">还没有打卡图</div>

        <div class="row" style="margin-top:16px;justify-content:flex-end">
          <button class="btn plain" @click="close">关闭</button>
          <button class="btn" @click="doneAndClose">{{ task.status === 'done' ? '完成' : '完成打卡 ✓' }}</button>
        </div>
      </div>
    </div>
  </div>

  <div v-if="lightbox" class="overlay" style="z-index:110" @click.self="lightbox = null">
    <img :src="lightbox.url" class="lightbox-img">
  </div>`,
};
