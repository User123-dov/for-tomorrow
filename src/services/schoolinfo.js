// 院校关键信息提取：抓取相关网页，从正文中抽取考试科目 / 分数线（含表格）/ 报考要求
const cheerio = require('cheerio');
const { fetchPage } = require('./fetcher');

function clean(s) { return String(s).replace(/\s+/g, ' ').trim(); }

// 关键词窗口提取：在全文中定位关键词，取前后文窗口（与页面排版无关，对压缩成一行的中文页面友好）
function windows(text, keywordRe, { before = 60, after = 100, need = /\d/, max = 6 } = {}) {
  const out = [];
  const re = new RegExp('.{0,' + before + '}' + keywordRe.source + '.{0,' + after + '}', 'g');
  let m;
  while ((m = re.exec(text)) && out.length < max) {
    const s = clean(m[0]);
    if (!need.test(s)) continue;
    if (out.some(x => x.includes(s) || s.includes(x))) continue;
    out.push(s);
  }
  return out;
}

// 从单页 HTML 中提取关键信息
function extractFromPage(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,iframe').remove();
  const text = $('body').text().replace(/[ \t\u00a0]+/g, ' ');

  const scoreLines = windows(text, /复试基本线|复试分数线|录取分数线|分数线/, { need: /\d{3}|20\d{2}/ });
  const subjectLines = windows(text, /(初试|复试|考试)科目|参考书目|④.{0,24}(材料|物理|化学)/, { need: /材料|数学|英语|政治|科目|物理|化学/ });
  const reqLines = windows(text, /报考条件|报名要求|招生人数|拟招生|统考名额/, { need: /\d|仅|限|接收/ });

  // 分数线表格：包含「材料」和三位数分数的表格，抽成行数组
  const tables = [];
  $('table').each((_, t) => {
    const $t = $(t);
    const tableText = $t.text();
    if (!/材料/.test(tableText) || !/\d{3}/.test(tableText)) return;
    const rows = $t.find('tr').map((_, tr) => {
      return $(tr).find('td,th').map((_, td) => clean($(td).text())).get().filter(c => c !== '');
    }).get().filter(r => r.length >= 3 && /材料|总分|20\d\d|\d{3}/.test(r.join(' ')));
    if (rows.length >= 2) tables.push(rows.slice(0, 14));
  });
  if (tables.length > 3) tables.length = 3;

  return { scoreLines, subjectLines, reqLines, tables };
}

// 抓取一个页面并提取（失败返回 null）
async function harvest(url) {
  try {
    const res = await fetchPage(url, { timeoutMs: 15000 });
    if (res.status !== 200 || !res.text) return null;
    const info = extractFromPage(res.text);
    const hasAny = info.scoreLines.length || info.subjectLines.length || info.reqLines.length || info.tables.length;
    if (!hasAny) return null;
    let site = '';
    try { site = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    return { url, site, ...info };
  } catch { return null; }
}

module.exports = { extractFromPage, harvest };
