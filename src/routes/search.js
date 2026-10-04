// 按名称搜索：院校官方链接 / 学习资料文件
const express = require('express');
const { searchWeb, searchBaidu, searchBing } = require('../services/websearch');
const { harvest } = require('../services/schoolinfo');
const bilibili = require('../services/bilibili');

const router = express.Router();
const cache = new Map(); // 30 分钟缓存

async function cachedSearch(key, query, limit) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < 30 * 60 * 1000) return hit.results;
  const { results } = await searchWeb(query, { limit });
  cache.set(key, { ts: Date.now(), results });
  return results;
}

// 输入院校名称 → 只找材料相关：材料学院官网 / 材料方向研究生招生 / 材料方向复试线
router.get('/search/school', async (req, res, next) => {
  try {
    const name = String(req.query.name || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: '请填写院校名称' });
    const college = String(req.query.college || '材料科学与工程学院').trim().slice(0, 30);
    const groups = [
      { key: 'college', label: '材料学院官网', query: `${name} ${college}` },
      { key: 'adm', label: '材料方向研究生招生', query: `${name} ${college} 研究生招生` },
      { key: 'score', label: '材料方向复试线 / 录取', query: `${name} 材料 考研 复试分数线` },
    ];
    const out = [];
    for (const g of groups) {
      try {
        const results = await cachedSearch('school|' + g.query, g.query, 6);
        out.push({ key: g.key, label: g.label, results });
      } catch (err) {
        out.push({ key: g.key, label: g.label, results: [], error: err.message });
      }
    }
    res.json({ name, groups: out });
  } catch (err) { next(err); }
});

// 输入资料名称 → 找学习资料。必应优先（支持 filetype:pdf 精准找文件），
// 必应限流/失败时降级到百度搜网页资料，结果带 kind 标注（pdf / page）
router.get('/search/files', async (req, res, next) => {
  try {
    const name = String(req.query.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: '请填写资料名称' });
    const key = 'files|' + name;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < 30 * 60 * 1000) return res.json(hit.data);

    let results = [];
    try {
      results = await searchBing(`filetype:pdf ${name}`, 12);
    } catch {
      results = await searchBaidu(`${name} 真题 讲义 笔记`, 12);
    }
    results = results.map(r => ({
      ...r,
      kind: /\.pdf($|\?)/i.test(r.url) ? 'pdf' : 'page',
    })).sort((a, b) => (a.kind === 'pdf' ? 0 : 1) - (b.kind === 'pdf' ? 0 : 1));
    const data = { name, results };
    cache.set(key, { ts: Date.now(), data });
    res.json(data);
  } catch (err) { next(err); }
});

// 自动提取院校关键信息：报考要求 / 考试科目 / 往年分数线（含表格）
// 流程：搜索相关页面 → 逐页抓取正文 → 启发式抽取关键句子和分数线表格
router.get('/search/school-info', async (req, res, next) => {
  try {
    const name = String(req.query.name || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: '请填写院校名称' });
    const college = String(req.query.college || '材料科学与工程学院').trim().slice(0, 30);
    const key = 'info|' + name + '|' + college;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < 60 * 60 * 1000) return res.json(hit.data);

    // 三类搜索各取前几条，edu.cn 与政府/研招域名优先
    const queries = [
      `${name} ${college} 硕士 考试科目`,
      `${name} 材料 复试分数线`,
      `${name} 硕士 招生 目录 要求`,
    ];
    const urls = [];
    const seen = new Set();
    const prefer = (u) => /(\.edu\.cn|yz\.chsi\.com\.cn|eol\.cn)/.test(u) ? 0 : 1;
    for (const q of queries) {
      try {
        const { results } = await searchWeb(q, { limit: 5 });
        for (const r of results) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          urls.push({ ...r, q });
        }
      } catch { /* 单组搜索失败不阻塞 */ }
    }
    urls.sort((a, b) => prefer(a.url) - prefer(b.url));
    const targets = urls.slice(0, 8);

    // 并发抓取（最多4个），收集有提取结果的页面
    const findings = [];
    const batchSize = 4;
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      const harvested = await Promise.all(batch.map(t => harvest(t.url).then(h => h && { ...h, title: t.title, queryCategory: t.q })));
      for (const h of harvested) if (h) findings.push(h);
    }
    const data = { name, college, findings, pagesTried: targets.length };
    cache.set(key, { ts: Date.now(), data });
    res.json(data);
  } catch (err) { next(err); }
});

// 按名称找 B站视频：官方搜索接口（wbi 签名）；失败时网页搜索兜底
router.get('/search/videos', async (req, res, next) => {
  try {
    const name = String(req.query.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: '请填写视频名称或课程关键词' });
    const key = 'videos|' + name;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < 60 * 60 * 1000) return res.json(hit.data);

    let videos = [];
    try {
      videos = await bilibili.searchVideos(name);
    } catch {
      // 兜底：网页搜索抽取 BV 号再补元数据
      const { results } = await searchWeb(`site:bilibili.com/video ${name}`, { limit: 12 });
      const bvids = [];
      for (const r of results) {
        const m = /(BV[0-9A-Za-z]{10})/.exec(r.url);
        if (m && !bvids.includes(m[1])) bvids.push(m[1]);
      }
      for (const bvid of bvids.slice(0, 6)) {
        try {
          const meta = await bilibili.fetchVideoMeta({ bvid });
          videos.push({ bvid: meta.bvid, title: meta.title, cover: meta.coverUrl, up: meta.upName, duration: meta.duration, playUrl: meta.playUrl });
        } catch { /* 单条失败跳过 */ }
      }
    }
    const data = { name, videos };
    cache.set(key, { ts: Date.now(), data });
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
