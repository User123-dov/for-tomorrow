// 正文提取：readability 提取文章主体，cheerio 抽元数据，双保险兜底
const { Readability } = require('@mozilla/readability');
const { parseHTML } = require('linkedom');
const cheerio = require('cheerio');

function absUrl(src, base) {
  try { return new URL(src, base).href; } catch { return src; }
}

// 清洗正文 HTML：去脚本/内联事件，懒加载图片还原，相对链接转绝对
function cleanContentHtml(html, baseUrl, $) {
  const $c = cheerio.load(html);
  $c('script, style, iframe, object, embed, noscript, form, button, input').remove();
  $c('[style]').each((_, el) => { $c(el).removeAttr('style'); });
  $c('*').each((_, el) => {
    for (const attr of Object.keys(el.attribs || {})) {
      if (/^on/i.test(attr)) $c(el).removeAttr(attr);
    }
  });
  $c('img').each((_, el) => {
    const $img = $c(el);
    const lazy = $img.attr('data-src') || $img.attr('data-original') || $img.attr('data-lazy-src');
    if (lazy && !$img.attr('src')) $img.attr('src', lazy);
    if ($img.attr('src')) $img.attr('src', absUrl($img.attr('src'), baseUrl));
    $img.attr('loading', 'lazy');
    $img.removeAttr('srcset');
  });
  $c('a[href]').each((_, el) => { $c(el).attr('href', absUrl($c(el).attr('href'), baseUrl)); $c(el).attr('target', '_blank'); });
  return $c('body').html() || '';
}

function extractArticle(html, url) {
  const $ = cheerio.load(html);
  const meta = (sel) => $(sel).attr('content')?.trim() || '';
  const title = meta('meta[property="og:title"]') || meta('meta[name="title"]') || $('title').text().trim() || '未命名页面';
  const summary = meta('meta[name="description"]') || meta('meta[property="og:description"]') || '';
  const cover = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || '';
  let site = '';
  try { site = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }

  let contentHtml = '';
  let contentText = '';
  try {
    const dom = parseHTML(html);
    const reader = new Readability(dom.document);
    const parsed = reader.parse();
    if (parsed && parsed.content) {
      contentHtml = cleanContentHtml(parsed.content, url, $);
      contentText = cheerio.load(parsed.content).text().replace(/\s+/g, ' ').trim().slice(0, 100000);
    }
  } catch { /* readability 偶发失败，走兜底 */ }

  if (!contentText) {
    // 兜底：去掉明显非正文的节点后直接取 body 文本
    const $b = cheerio.load(html);
    $b('script, style, nav, header, footer, aside, iframe, noscript').remove();
    contentText = $b('body').text().replace(/\s+/g, ' ').trim().slice(0, 50000);
    contentHtml = '';
  }

  return {
    title: title.slice(0, 300),
    summary: summary.slice(0, 1000),
    coverUrl: absUrl(cover, url),
    site,
    contentHtml,
    contentText,
  };
}

module.exports = { extractArticle };
