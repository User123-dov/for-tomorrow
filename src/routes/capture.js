// 采集中心 API：批量 URL 抓取入库
const express = require('express');
const { captureUrl } = require('../services/crawler');

const router = express.Router();

router.post('/capture', async (req, res, next) => {
  try {
    const { text, subject_id = null, tags = '' } = req.body;
    const urls = String(text || '')
      .split(/[\s,;；、]+/)
      .map(s => s.trim())
      .filter(s => /^(https?:\/\/|[\w-]+\.[\w-]+)/i.test(s))
      .slice(0, 20);
    if (urls.length === 0) return res.status(400).json({ error: '未识别到有效 URL' });

    const results = [];
    for (const url of urls) {
      try {
        const material = await captureUrl(url, { subjectId: subject_id, tags });
        results.push({ url, ok: true, material });
      } catch (err) {
        results.push({ url, ok: false, error: err.message || String(err) });
      }
    }
    res.json({ results });
  } catch (err) { next(err); }
});

module.exports = router;
