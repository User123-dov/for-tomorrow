// 领先在线同步 API
const express = require('express');
const { syncCourses, requireCookie } = require('../services/lingxian');
const { getSetting } = require('../db');

const router = express.Router();

router.get('/lingxian/status', (req, res) => {
  let configured = false;
  try { requireCookie(); configured = true; } catch { configured = false; }
  res.json({ cookie_configured: configured });
});

router.post('/lingxian/sync', async (req, res, next) => {
  try { res.json(await syncCourses()); } catch (err) { next(err); }
});

module.exports = router;
