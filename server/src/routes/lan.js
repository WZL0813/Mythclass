/**
 * 局域网界面的中转路由
 *
 * 老师在教师端打开 /localwebui 时，页面里所有 /api/xxx 请求都发到这里，
 * 再由服务器转给那台一体机 —— 一体机本机回环请求自己的局域网服务，
 * 所以两个界面的数据、鉴权、路由是同一套，永远一致。
 *
 * 权限：必须登录，且这台机器确实是这个老师的。
 */
const express = require('express');
const { teacherAuth } = require('../middleware/auth');
const presence = require('../sockets');

const router = express.Router();

router.post('/relay', teacherAuth, async (req, res) => {
  const clientId = Number(req.body && req.body.clientId);
  if (!clientId) return res.status(400).json({ ok: false, error: '没说要问哪台机器' });

  // 只让自己名下的机器
  let owns = false;
  try {
    owns = presence.ownsClient(req.user.id, clientId);
  } catch (_) {
    owns = false;
  }
  if (!owns) return res.status(403).json({ ok: false, error: '这台机器不是你的' });

  const method = String((req.body && req.body.method) || 'GET').toUpperCase();
  const path = String((req.body && req.body.path) || '/');
  const query = String((req.body && req.body.query) || '');
  const body = String((req.body && req.body.body) || '');
  const contentType = String((req.body && req.body.contentType) || '');

  try {
    const out = await presence.askClient(
      clientId,
      'lan_relay',
      { method, path, query, body, contentType },
      30000
    );
    if (!out || out.ok === false) {
      return res.status(502).json({ ok: false, error: (out && out.error) || '那台机器没回话' });
    }
    res.json({
      ok: true,
      status: out.status,
      body: out.body || '',
      contentType: out.contentType || 'application/octet-stream',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

module.exports = router;
