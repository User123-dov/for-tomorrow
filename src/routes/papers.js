// 论文速递：通过 Crossref 公开接口检索最新期刊论文（元数据 + 摘要，不涉及全文）
const { fetchPage, normalizeUrl } = require('../services/fetcher');

const router = require('express').Router();

// 简易缓存：同一关键词 30 分钟内直接返回，避免频繁请求
const cache = new Map();

function stripJats(html = '') {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 材料领域关键词词典（中英对照，按出现次数排序输出）——回答"这是什么材料/什么方向"
const MATERIAL_LEXICON = [
  ['碳纤维', /碳纤维|carbon fiber|carbon fibre/i],
  ['玻璃纤维', /玻璃纤维|glass fiber/i],
  ['芳纶', /芳纶|aramid/i],
  ['石墨烯', /石墨烯|graphene/i],
  ['碳纳米管', /碳纳米管|carbon nanotube/i],
  ['气凝胶', /气凝胶|aerogel/i],
  ['多孔材料', /多孔|porous/i],
  ['蜂窝结构', /蜂窝|honeycomb/i],
  ['点阵结构', /点阵|lattice structure/i],
  ['层合板', /层合板|层压板|laminate/i],
  ['树脂', /树脂|resin/i],
  ['环氧', /环氧|epoxy/i],
  ['聚合物', /聚合物|高分子|polymer/i],
  ['陶瓷', /陶瓷|ceramic/i],
  ['金属基复合', /金属基|铝基|镁基|钛基|metal matrix/i],
  ['复合材料', /复合材料|composite/i],
  ['纳米材料', /纳米|nano/i],
  ['薄膜涂层', /涂层|镀层|薄膜|thin film|coating/i],
  ['界面', /界面|interface/i],
  ['增强体', /增强体|增强相|reinforc/i],
  ['韧性韧化', /韧性|韧化|toughen/i],
  ['疲劳', /疲劳|fatigue/i],
  ['断裂损伤', /断裂|损伤|fracture|damage/i],
  ['拉伸压缩', /拉伸|压缩|tensile|compressive/i],
  ['弯曲性能', /弯曲|flexural|bending/i],
  ['冲击性能', /冲击|impact/i],
  ['力学性能', /力学性能|mechanical propert/i],
  ['导热隔热', /导热|热导率|隔热|thermal conductivity|thermal insulation/i],
  ['热稳定性', /热稳定|耐热|thermal stability|heat resist/i],
  ['阻燃', /阻燃|flame retard/i],
  ['腐蚀氧化', /腐蚀|氧化|corrosion|oxidation/i],
  ['老化耐候', /老化|耐候|aging|weathering/i],
  ['增材制造', /3D打印|增材制造|additive manufactur|3D print/i],
  ['成型工艺', /成型|固化|工艺参数|curing|manufacturing process/i],
  ['缺陷表征', /缺陷|孔隙率|defect|void|porosity/i],
  ['仿真模拟', /有限元|仿真|数值模拟|finite element|simulat/i],
  ['机器学习', /机器学习|神经网络|machine learning|neural network|AI-driven/i],
  ['分子模拟', /分子动力学|molecular dynamics/i],
  ['相变结晶', /相变|结晶|phase change|crystalliz/i],
  ['轻量化', /轻量化|轻质|lightweight|light-weight/i],
  ['生物医用', /生物医用|生物材料|biomaterial|biomedical/i],
  ['电池储能', /电池|储能|battery|energy storage|supercapacitor/i],
  ['电磁屏蔽', /电磁屏蔽|吸波|EMI shield|microwave absorb/i],
  ['传感柔性', /传感|柔性|sensor|flexible|wearable/i],
];

function extractKeywords(title, abstract) {
  const text = (title + '  ' + (abstract || '')).toLowerCase();
  const counts = [];
  for (const [label, re] of MATERIAL_LEXICON) {
    const matches = text.match(new RegExp(re.source, 'gi'));
    if (matches && matches.length) counts.push({ label, n: matches.length, order: (text.match(re) || []).index ?? 9999 });
  }
  return counts
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, 8)
    .map(c => c.label);
}

router.get('/papers/search', async (req, res, next) => {
  try {
    const kw = String(req.query.kw || 'composite materials').trim().slice(0, 120);
    const days = Math.min(3650, Math.max(7, Number(req.query.days) || 180));
    const cacheKey = kw + '|' + days;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < 30 * 60 * 1000) return res.json(hit.data);

    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const api = 'https://api.crossref.org/works?query=' + encodeURIComponent(kw) +
      '&filter=from-pub-date:' + since +
      '&sort=published&order=desc&rows=24' +
      '&select=title,container-title,DOI,issued,abstract,author,is-referenced-by-count,URL';
    const page = await fetchPage(api, { timeoutMs: 20000 });
    if (page.status !== 200 || !page.text) {
      return res.status(502).json({ error: 'Crossref 检索失败（HTTP ' + page.status + '），稍后再试或更换网络' });
    }
    const body = JSON.parse(page.text);
    const thisYear = new Date().getFullYear();
    const papers = (body.message?.items || [])
      .map(it => {
        const y = it.issued?.['date-parts']?.[0]?.[0];
        return {
          doi: it.DOI || '',
          title: (it.title && it.title[0] || '未命名论文').replace(/\s+/g, ' ').trim(),
          journal: (it['container-title'] && it['container-title'][0]) || '',
          year: (y >= 1990 && y <= thisYear + 1) ? y : '',
          realYear: y,
          authors: (it.author || []).slice(0, 4).map(a => a.family || a.given || '').filter(Boolean).join(', '),
          citations: it['is-referenced-by-count'] || 0,
          abstract: stripJats(it.abstract || ''),
          url: 'https://doi.org/' + (it.DOI || ''),
        };
      })
      // 过滤掉出版社提交了乱码年份（如 2107）的坏数据
      .filter(p => p.title && (p.realYear === undefined || (p.realYear >= 1990 && p.realYear <= thisYear + 1)))
      .map(({ realYear, ...p }) => ({ ...p, keywords: extractKeywords(p.title, p.abstract) }));
    const data = { papers, kw, days };
    cache.set(cacheKey, { ts: Date.now(), data });
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
