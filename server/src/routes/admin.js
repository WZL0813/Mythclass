'use strict';

/**
 * Admin 管理后台 API
 * 路由前缀 /api/admin  鉴权：Admin-Bearer <admin_jwt>
 */

const express = require('express');
const os = require('os');
const bcrypt = require('bcryptjs');
const { db, getSystemSetting, setSystemSetting, countAdmins } = require('../db');
const { adminAuth, signAdminToken } = require('../middleware/auth');
const setupToken = require('../admin/setupToken');
const presence = require('../sockets');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5-]{3,32}$/;

/* ------------------------------ 初始化与登录 ------------------------------ */

router.get('/setup-status', (req, res) => {
  const initialized = countAdmins() > 0;
  res.json({ initialized, hasToken: !!setupToken.readSetupToken() });
});

router.post('/setup', (req, res) => {
  if (countAdmins() > 0) {
    return res.status(409).json({ error: 'ALREADY_INITIALIZED', message: '管理员已经初始化过了' });
  }

  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || req.body.confirmPassword || '');

  const expected = setupToken.readSetupToken();
  if (!expected) {
    return res.status(400).json({ error: 'NO_SETUP_TOKEN', message: '服务端没有生成初始化令牌，请重启服务端' });
  }
  if (token !== expected) {
    return res.status(403).json({ error: 'BAD_TOKEN', message: '初始化令牌不对' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: '管理员密码至少 8 位' });
  }
  if (password !== confirm) {
    return res.status(400).json({ error: 'MISMATCH', message: '两次输入的密码不一样' });
  }

  const info = db
    .prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
    .run(String(req.body.username || 'admin').trim() || 'admin', bcrypt.hashSync(password, 10));
  setupToken.clearSetupToken();

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(info.lastInsertRowid);
  console.log('[Mythclass] Admin 初始化完成，setup token 已销毁。');
  res.status(201).json({ token: signAdminToken(admin), admin: { id: admin.id, username: admin.username } });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '账号或密码不对' });
  }
  res.json({ token: signAdminToken(admin), admin: { id: admin.id, username: admin.username } });
});

/* 以下全部需要 Admin JWT */
router.use(adminAuth);

router.get('/me', (req, res) => {
  res.json({ admin: { id: req.admin.id, username: req.admin.username, createdAt: req.admin.created_at } });
});

router.post('/change-password', (req, res) => {
  const oldPassword = String(req.body.oldPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (!bcrypt.compareSync(oldPassword, req.admin.password_hash)) {
    return res.status(400).json({ error: 'BAD_PASSWORD', message: '原密码不对' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: '新密码至少 8 位' });
  }
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.admin.id);
  res.json({ ok: true });
});

/* -------------------------------- 仪表盘 -------------------------------- */

router.get('/dashboard', (req, res) => {
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;
  const ws = presence.stats();
  const mem = process.memoryUsage();

  res.json({
    users: {
      total: one('SELECT COUNT(*) AS n FROM users'),
      banned: one("SELECT COUNT(*) AS n FROM users WHERE status = 'banned'"),
      online: ws.onlineUsers,
    },
    clients: {
      total: one('SELECT COUNT(*) AS n FROM clients'),
      bound: one('SELECT COUNT(DISTINCT client_id) AS n FROM bindings'),
      online: ws.onlineClients,
    },
    fileLogs: one('SELECT COUNT(*) AS n FROM file_logs'),
    registrationOpen: String(getSystemSetting('registration_open', 'true')) === 'true',
    server: {
      uptimeSeconds: ws.uptimeSeconds,
      wsConnections: ws.wsConnections,
      memoryMB: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      node: process.version,
      platform: `${os.type()} ${os.release()}`,
      version: require('../../package.json').version,
    },
  });
});

/* -------------------------------- 用户管理 -------------------------------- */

function userRows({ q = '', status = '', limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  if (q) {
    where.push("(username LIKE ? OR IFNULL(email, '') LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM users ${clause}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM bindings b WHERE b.user_id = u.id) AS client_count
         FROM users u ${clause}
        ORDER BY u.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return {
    total,
    users: rows.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      status: u.status,
      clientCount: u.client_count,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      online: presence.onlineUserIds().includes(u.id),
    })),
  };
}

router.get('/users', (req, res) => {
  res.json(
    userRows({
      q: String(req.query.q || '').trim(),
      status: String(req.query.status || '').trim(),
      limit: Math.min(Number(req.query.limit) || 50, 200),
      offset: Math.max(Number(req.query.offset) || 0, 0),
    })
  );
});

router.post('/users', (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim() || null;
  const password = String(req.body.password || '');
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'INVALID_USERNAME', message: '用户名 3-32 位' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: '密码至少 6 位' });
  }
  const dup = db.prepare('SELECT id FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)').get(username, email);
  if (dup) return res.status(409).json({ error: 'ALREADY_EXISTS', message: '用户名或邮箱已存在' });

  const info = db
    .prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(username, email, bcrypt.hashSync(password, 10));
  res.status(201).json({ ok: true, user: db.prepare('SELECT id, username, email, status, created_at FROM users WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });

  const username = req.body.username === undefined ? user.username : String(req.body.username).trim();
  const email = req.body.email === undefined ? user.email : String(req.body.email).trim() || null;
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'INVALID_USERNAME', message: '用户名格式不对' });

  const dup = db.prepare('SELECT id FROM users WHERE (username = ? OR (email IS NOT NULL AND email = ?)) AND id != ?').get(username, email, user.id);
  if (dup) return res.status(409).json({ error: 'ALREADY_EXISTS', message: '用户名或邮箱已被占用' });

  db.prepare('UPDATE users SET username = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, email, user.id);
  res.json({ ok: true });
});

/** 封禁 / 解封 / 重置密码 —— 都会让老 token 立刻作废 */
function bumpTokenVersion(userId, reason = 'TOKEN_REVOKED') {
  db.prepare('UPDATE users SET token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  presence.kickUser(userId, reason);
}

router.post('/users/:id/ban', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });
  }
  db.prepare("UPDATE users SET status = 'banned', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  bumpTokenVersion(id, 'USER_BANNED');
  res.json({ ok: true });
});

router.post('/users/:id/unban', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  bumpTokenVersion(id);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  const password = String(req.body.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'WEAK_PASSWORD', message: '密码至少 6 位' });
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    bcrypt.hashSync(password, 10),
    id
  );
  bumpTokenVersion(id);
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在' });

  const remove = db.transaction(() => {
    const clientIds = db.prepare('SELECT client_id FROM bindings WHERE user_id = ?').all(id).map((r) => r.client_id);
    db.prepare('DELETE FROM bindings WHERE user_id = ?').run(id);
    db.prepare('UPDATE clients SET owner_user_id = NULL WHERE owner_user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return clientIds;
  });
  remove();
  presence.kickUser(id, 'USER_DELETED');
  res.json({ ok: true });
});

router.get('/users/:id/clients', (req, res) => {
  const id = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT c.* FROM bindings b JOIN clients c ON c.id = b.client_id WHERE b.user_id = ? ORDER BY c.id DESC`
    )
    .all(id);
  res.json({
    clients: rows.map((c) => ({
      id: c.id,
      clientUid: c.client_uid,
      name: c.name,
      os: c.os,
      version: c.version,
      lastIp: c.last_ip,
      lastSeen: c.last_seen,
      online: presence.isClientOnline(c.id),
    })),
  });
});

/* ------------------------------- 客户端管理 ------------------------------- */

router.get('/clients', (req, res) => {
  const q = String(req.query.q || '').trim();
  const where = [];
  const params = [];
  if (q) {
    where.push("(c.client_uid LIKE ? OR IFNULL(c.name, '') LIKE ? OR IFNULL(u.username, '') LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM clients c LEFT JOIN users u ON u.id = c.owner_user_id ${clause}`)
    .get(...params).n;
  const rows = db
    .prepare(
      `SELECT c.*, u.username AS owner_name,
              (SELECT COUNT(*) FROM file_logs f WHERE f.client_id = c.id) AS log_count
         FROM clients c LEFT JOIN users u ON u.id = c.owner_user_id
         ${clause} ORDER BY c.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({
    total,
    clients: rows.map((c) => ({
      id: c.id,
      clientUid: c.client_uid,
      name: c.name,
      ownerUserId: c.owner_user_id,
      ownerName: c.owner_name,
      os: c.os,
      version: c.version,
      lastIp: c.last_ip,
      lastSeen: c.last_seen,
      createdAt: c.created_at,
      fileLogCount: c.log_count,
      online: presence.isClientOnline(c.id),
    })),
  });
});

/* 这台机器的崩溃上报（最近 30 条） */
router.get('/clients/:id/errors', (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, kind, message, detail, version, created_at FROM client_errors WHERE client_id = ? ORDER BY id DESC LIMIT 30'
    )
    .all(Number(req.params.id));
  res.json({ errors: rows });
});

router.get('/clients/:id', (req, res) => {
  const c = db
    .prepare(
      `SELECT c.*, u.username AS owner_name FROM clients c LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.id = ?`
    )
    .get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'NOT_FOUND', message: '客户端不存在' });
  const state = db.prepare('SELECT * FROM audio_logs WHERE client_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
  res.json({
    client: { ...c, online: presence.isClientOnline(c.id) },
    lastAudio: state || null,
    fileLogCount: db.prepare('SELECT COUNT(*) AS n FROM file_logs WHERE client_id = ?').get(c.id).n,
  });
});

router.delete('/clients/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.post('/clients/:id/unbind', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM bindings WHERE client_id = ?').run(id);
  db.prepare('UPDATE clients SET owner_user_id = NULL WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.post('/clients/:id/rebind', (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.body.userId || req.body.user_id);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND', message: '目标用户不存在' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM bindings WHERE client_id = ?').run(id);
    db.prepare('INSERT OR IGNORE INTO bindings (user_id, client_id) VALUES (?, ?)').run(userId, id);
    db.prepare('UPDATE clients SET owner_user_id = ? WHERE id = ?').run(userId, id);
  });
  tx();
  res.json({ ok: true });
});

/* ------------------------------- 系统设置 ------------------------------- */

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM system_settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ settings });
});

router.put('/settings/registration', (req, res) => {
  const open = req.body.open === true || req.body.open === 'true';
  setSystemSetting('registration_open', open ? 'true' : 'false');
  res.json({ ok: true, registrationOpen: open });
});

/** 导出：type=users|clients，format=json|csv */
router.get('/export', (req, res) => {
  const type = String(req.query.type || 'users');
  const format = String(req.query.format || 'json');

  let rows;
  if (type === 'clients') {
    rows = db.prepare('SELECT * FROM clients').all();
  } else {
    rows = db.prepare('SELECT id, username, email, status, last_login_at, created_at FROM users').all();
  }

  if (format === 'csv') {
    if (rows.length === 0) return res.type('text/csv').send('');
    const headers = Object.keys(rows[0]);
    const escape = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="mythclass-${type}.csv"`);
    return res.type('text/csv; charset=utf-8').send('\uFEFF' + csv);
  }

  res.setHeader('Content-Disposition', `attachment; filename="mythclass-${type}.json"`);
  res.json({ exportedAt: new Date().toISOString(), type, count: rows.length, rows });
});

// --------------------------------- 发布更新 --------------------------------
// 发布一条客户端更新。下载地址随便写：GitHub release 也行、自己服务器上的文件也行。
router.get('/releases', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM releases ORDER BY id DESC LIMIT 50')
    .all();
  res.json({ items: rows });
});

router.post('/releases', (req, res) => {
  const version = String(req.body.version || '').trim().replace(/^v/i, '');
  const url = String(req.body.url || '').trim();
  const notes = String(req.body.notes || '').trim();
  const sha256 = String(req.body.sha256 || '').trim().toLowerCase();
  const mandatory = req.body.mandatory ? 1 : 0;
  const platform = String(req.body.platform || 'win').trim() || 'win';

  if (!/^\d+(\.\d+)*$/.test(version)) {
    return res.status(400).json({ error: 'BAD_VERSION', message: '版本号要写成 2.6.0 这样' });
  }
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'BAD_URL', message: '下载地址要用 http(s) 开头' });
  }

  const info = db
    .prepare(
      `INSERT INTO releases (version, url, notes, sha256, mandatory, platform, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(version, url, notes, sha256, mandatory, platform, new Date().toISOString(), req.admin && req.admin.id);

  res.json({
    ok: true,
    id: info.lastInsertRowid,
    message: '发布好了：v' + version,
  });
});

router.delete('/releases/:id', (req, res) => {
  const id = Number(req.params.id) || 0;
  const info = db.prepare('DELETE FROM releases WHERE id = ?').run(id);
  if (!info.changes) {
    return res.status(404).json({ error: 'NOT_FOUND', message: '没这条' });
  }
  res.json({ ok: true });
});

module.exports = router;
