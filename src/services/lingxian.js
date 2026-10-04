// 领先在线（lingxianvip.com）课程同步：使用用户自己在设置里配置的站点 Cookie，
// 拉取已购课程与课时，重建 CC 视频回放链接（token = md5(g_user_id)，站点前端同款算法）
const crypto = require('node:crypto');
const { getSetting, db } = require('../db');
const { fetchPage, cookieFor } = require('./fetcher');

const HOST = 'https://lingxianvip.com';

function requireCookie() {
  const cookie = cookieFor(HOST + '/');
  if (!cookie) throw new Error('尚未配置 lingxianvip.com 的 Cookie，请到「设置 → 站点 Cookie」填写后重试');
  return cookie;
}

async function apiGet(pathAndQuery) {
  const res = await fetchPage(HOST + pathAndQuery, { timeoutMs: 25000 });
  if (res.status !== 200 || !res.text) throw new Error('领先接口请求失败（HTTP ' + res.status + '）');
  const data = JSON.parse(res.text.trim());
  if (data.status === '-2') throw new Error('Cookie 已失效，请重新登录领先在线并更新 Cookie');
  return data;
}

// 课时树：递归收集叶子节点（非 group），带 cc_user_id / cc_video_id
function collectLessons(lessonGroup) {
  const { res_level, res_meta, cur_res_id } = lessonGroup;
  const leaves = [];
  const walk = (id) => {
    const kids = res_level[id];
    if (kids && kids.length) kids.forEach(walk);
    const m = res_meta[id];
    if (m && m.type !== 'group' && m.cc_video_id) leaves.push(m);
  };
  walk(cur_res_id);
  return leaves;
}

function guessSubjectId(title) {
  const subjects = db.prepare('SELECT id, name FROM subjects').all();
  const hit = subjects.find(s => title.includes(s.name));
  return hit ? hit.id : null;
}

function buildReplayUrl(lesson, userInfo, recordId) {
  const token = crypto.createHash('md5').update(userInfo.g_user_id).digest('hex');
  const qs = [
    'userid=' + encodeURIComponent(lesson.cc_user_id),
    'roomid=' + encodeURIComponent(lesson.cc_video_id),
    "viewername='" + encodeURIComponent(userInfo.nick_name || 'student') + "'",
    'viewertoken=' + token,
    'recordid=' + encodeURIComponent(recordId),
    'autoLogin=true',
    'forcibly=true',
  ].join('&');
  return 'https://view-vx.csslcloud.net/api/view/callback?' + qs;
}

async function replayForLesson(lesson, userInfo) {
  // web_playback 返回回放记录；duration 由直播起止时间推算
  const data = await apiGet('/index.php?c=course_ctrl&m=web_playback&roomid=' + encodeURIComponent(lesson.cc_video_id) + '&userid=' + encodeURIComponent(lesson.cc_user_id));
  if (data.status !== '0' || !data.data || !data.data.id) return { replayUrl: null, duration: 0 };
  const duration = Math.max(0, Math.round((new Date(data.data.stopTime) - new Date(data.data.startTime)) / 60000));
  return { replayUrl: buildReplayUrl(lesson, userInfo, data.data.id), duration };
}

function upsertLessonMaterial(course, lesson, replayUrl, duration) {
  const key = 'cc:' + lesson.global_id;
  const title = (lesson.title || '未命名课时').trim();
  const subjectId = guessSubjectId(course.title || '');
  const values = {
    title,
    source_url: replayUrl || (HOST + '/detail.html?id=' + course.global_id + '&t=' + (course.type || 'live')),
    cover_url: course.img_src || '',
    summary: '课程：' + (course.title || '').trim(),
    subject_id: subjectId,
    duration,
    up_name: (lesson.cc_teacher || '领先在线').trim(),
  };
  const existing = db.prepare('SELECT id FROM materials WHERE bvid = ?').get(key);
  if (existing) {
    db.prepare(`UPDATE materials SET title = @title, source_url = @source_url, cover_url = @cover_url,
                summary = @summary, subject_id = @subject_id, duration = @duration, up_name = @up_name
                WHERE id = @id`).run({ ...values, id: existing.id });
    return { id: existing.id, created: false };
  }
  const info = db.prepare(`INSERT INTO materials (type, title, source_url, site, cover_url, summary, local_path,
                          subject_id, tags, note, bvid, up_name, duration, pages, watch_status)
                          VALUES ('video', @title, @source_url, 'lingxianvip.com', @cover_url, @summary, '',
                          @subject_id, '领先在线', @note, @bvid, @up_name, @duration, '[]', 'unwatched')`)
    .run({ ...values, note: '课程：' + (course.title || '').trim(), bvid: key });
  return { id: Number(info.lastInsertRowid), created: true };
}

// 当前登录用户信息（昵称 + g_user_id，token 由 g_user_id 的 md5 生成）
async function getUserInfo() {
  const data = await apiGet('/index.php?c=passportctrl&m=get_user_center_page_data');
  if (data.status !== '0' || !data.g_user_id) throw new Error('无法获取用户信息，Cookie 可能已失效');
  return { g_user_id: data.g_user_id, nick_name: data.nick_name || 'student' };
}

// 主入口：同步全部已购课程
async function syncCourses() {
  requireCookie();
  const list = await apiGet('/index.php?c=course_play_record_ctrl&m=get_whole_course_and_play_record&validity=1&pagesize=100');
  const courses = list.res_arr || [];
  if (!courses.length) return { courses: 0, lessons: 0, created: 0, updated: 0, skipped: 0 };
  const userInfo = await getUserInfo();

  let lessons = 0, created = 0, updated = 0, skipped = 0;
  for (const course of courses) {
    let data;
    try { data = await apiGet('/index.php?c=course_ctrl&m=course_data&id=' + encodeURIComponent(course.global_id)); }
    catch (err) { console.error('[lingxian] course_data', course.global_id, 'failed:', err.message); skipped += 1; continue; }
    let items = [];
    try { items = collectLessons(data.lesson_group || {}); } catch (err) { console.error('[lingxian] collectLessons failed:', err.message); items = []; }
    for (const lesson of items) {
      try {
        const { replayUrl, duration } = await replayForLesson(lesson, userInfo);
        const r = upsertLessonMaterial(course, lesson, replayUrl, duration);
        lessons += 1;
        r.created ? created += 1 : updated += 1;
      } catch (err) { console.error('[lingxian] lesson', lesson.global_id, 'failed:', err.message); skipped += 1; }
    }
  }
  return { courses: courses.length, lessons, created, updated, skipped };
}

module.exports = { syncCourses, requireCookie };
