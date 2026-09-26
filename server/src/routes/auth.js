'use strict';

/**
 * 教师端用户 API：注册 / 登录 / 绑定客户端 / 文件记录 / 设置
 * 路由前缀 /api/auth
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getSystemSetting } = require('../db');
const { teacherAuth, signTeacherToken, clientIp } = require('../middleware/auth');
const presence = require('../sockets');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    status: user.status,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

function registrationOpen() {
  return String(getSystemSetting('registration_open', 'true')) === 'true';
}

/* ----------------------------- 注册与登录 ----------------------------- */

// 教师端注册页先问一句：现在还开放注册吗
router.get('/registration-status', (req, res) => {
  res.json({ open: registrationOpen() });
});

router.post('/register', (req, res) => {
  if (!registrationOpen()) {
    return res.status(403).json({ error: 'REGISTRATION_CLOSED', message: '注册已关闭' });
  }

  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim() || null;
  const password = String(req.body.password || '');

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'INVALID_USERNAME', message: '用户名 3-32 位，支持中英文、数字、下划线、短横线' });
  }
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'INVALID_EMAIL', message: '邮箱格式不对' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: '密码至少 6 位' });
  }

  const dup = db.prepare('SELECT id FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)').get(username, email);
  if (dup) return res.status(409).json({ error: 'ALREADY_EXISTS', message: '用户名或邮箱已被占用' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(username, email, hash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

  res.status(201).json({ token: signTeacherToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const account = String(req.body.username || req.body.account || '').trim();
  const password = String(req.body.password || '');
  if (!account || !password) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '请填写账号和密码' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(account, account);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '账号或密码不对' });
  }
  if (user.status === 'banned') {
    return res.status(403).json({ error: 'USER_BANNED', message: '账号已被封禁' });
  }

  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  res.json({ token: signTeacherToken(user), user: publicUser(user) });
});

router.get('/me', teacherAuth, (req, res) => {
  const clients = listClients(req.user.id);
  res.json({ user: publicUser(req.user), clientCount: clients.length });
});

router.post('/change-password', teacherAuth, (req, res) => {
  const oldPassword = String(req.body.oldPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (!bcrypt.compareSync(oldPassword, req.user.password_hash)) {
    return res.status(400).json({ error: 'BAD_PASSWORD', message: '原密码不对' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: '新密码至少 6 位' });
  }
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    bcrypt.hashSync(newPassword, 10),
    req.user.id
  );
  res.json({ ok: true, message: '密码已更新，请重新登录' });
});

/* 改资料：用户名 / 邮箱 */
router.put('/profile', teacherAuth, (req, res) => {
  const username = String(req.body.username ?? req.user.username).trim();
  const rawEmail = String(req.body.email ?? req.user.email ?? '')
    .trim()
    .toLowerCase();

  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: 'BAD_USERNAME', message: '用户名 3-32 位' });
  }
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return res.status(400).json({ error: 'BAD_EMAIL', message: '邮箱格式看着不对' });
  }

  // 空邮箱存 NULL：email 上有 UNIQUE，存空串的话第二个人就进不来了
  const email = rawEmail || null;

  const nameTaken = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(username, req.user.id);
  if (nameTaken) {
    return res.status(409).json({ error: 'USERNAME_TAKEN', message: '这个用户名有人用了' });
  }
  if (email) {
    const mailTaken = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, req.user.id);
    if (mailTaken) {
      return res.status(409).json({ error: 'EMAIL_TAKEN', message: '这个邮箱有人用了' });
    }
  }

  db.prepare('UPDATE users SET username = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    username,
    email,
    req.user.id
  );

  // 用户名可能变了，把最新的整条拿回去（token 里存的是 id，不用重登）
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: publicUser(fresh), message: '资料改好了' });
});

/* ------------------------------- 客户端绑定 ------------------------------- */

function listClients(userId, myIp) {
  const rows = db
    .prepare(
      `SELECT c.*, b.created_at AS bound_at
         FROM bindings b JOIN clients c ON c.id = b.client_id
        WHERE b.user_id = ?
        ORDER BY c.id DESC`
    )
    .all(userId);
  return rows.map((c) => ({
    id: c.id,
    clientUid: c.client_uid,
    name: c.name,
    os: c.os,
    version: c.version,
    lastIp: c.last_ip,
    lastSeen: c.last_seen,
    boundAt: c.bound_at,
    online: presence.isClientOnline(c.id),
    // 客户端上报的内网地址（调试时看得到）
    localIps: c.local_ips ? String(c.local_ips).split(',') : [],
    // 拼「带密钥的直连链接」用：点一下就能进本地网页，不用手输密钥
    lanWebPort: c.lan_web_port || 0,
      lanPort: c.lan_port || 0,
      lanKey: c.lan_key || '',
    // 同一个出口 IP = 大概率同一个局域网（教室里的一体机和老师笔记本
    // 一般都走同一个学校出口）。客户端没报过地址或看不见出口 IP 时为 null。
    sameNetwork:
      c.last_ip && myIp ? String(c.last_ip) === String(myIp) : null,
  }));
}

router.get('/clients', teacherAuth, (req, res) => {
  // 顺手把老师自己的出口 IP 带回去，界面可以提示「你和这些机器在同一局域网」
  // 教师端这条路由没经过 clientAuth，所以自己取一次真实 IP（和客户端那边同一个算法）
  const myIp = clientIp(req);
  res.json({ clients: listClients(req.user.id, myIp), myIp: myIp || null });
});

// 绑定：输入一体机上显示的 client_uid
router.post('/bind', teacherAuth, (req, res) => {
  const uid = String(req.body.clientUid || req.body.client_uid || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim() || null;
  if (!uid) return res.status(400).json({ error: 'INVALID_INPUT', message: '请填写客户端 ID' });

  const client = db.prepare('SELECT * FROM clients WHERE UPPER(client_uid) = ?').get(uid);
  if (!client) {
    return res.status(404).json({ error: 'CLIENT_NOT_FOUND', message: '没找到这台机器，确认它已开机联网' });
  }
  if (client.owner_user_id && client.owner_user_id !== req.user.id) {
    return res.status(409).json({ error: 'ALREADY_BOUND', message: '这台机器已被别的账号绑定' });
  }

  db.prepare('UPDATE clients SET owner_user_id = ?, name = COALESCE(?, name) WHERE id = ?').run(
    req.user.id,
    name,
    client.id
  );
  db.prepare('INSERT OR IGNORE INTO bindings (user_id, client_id) VALUES (?, ?)').run(req.user.id, client.id);

  res.json({ ok: true, client: listClients(req.user.id).find((c) => c.id === client.id) });
});

// 确认这台机器确实是自己的
function ownedClient(req, res) {
  const id = Number(req.params.id);
  const client = db
    .prepare(
      `SELECT c.* FROM clients c JOIN bindings b ON b.client_id = c.id
        WHERE c.id = ? AND b.user_id = ?`
    )
    .get(id, req.user.id);
  if (!client) {
    res.status(404).json({ error: 'CLIENT_NOT_FOUND', message: '没有这台机器，或者不归你管' });
    return null;
  }
  return client;
}

router.put('/clients/:id', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'INVALID_INPUT', message: '名字不能是空的' });
  db.prepare('UPDATE clients SET name = ? WHERE id = ?').run(name.slice(0, 60), client.id);
  res.json({ ok: true, name });
});

router.delete('/clients/:id', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;
  db.prepare('DELETE FROM bindings WHERE user_id = ? AND client_id = ?').run(req.user.id, client.id);
  const left = db.prepare('SELECT COUNT(*) AS n FROM bindings WHERE client_id = ?').get(client.id).n;
  if (left === 0) db.prepare('UPDATE clients SET owner_user_id = NULL WHERE id = ?').run(client.id);
  res.json({ ok: true });
});

router.get('/clients/:id/info', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;
  const logs = db.prepare('SELECT COUNT(*) AS n FROM file_logs WHERE client_id = ?').get(client.id).n;
  res.json({
    client: { ...client, online: presence.isClientOnline(client.id) },
    fileLogCount: logs,
    relayEnabled: true,
  });
});

/* ------------------------------ 文件修改记录 ------------------------------ */

router.get('/clients/:id/file-logs', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;

  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q = String(req.query.q || '').trim();
  const operation = String(req.query.operation || '').trim();

  const where = ['client_id = ?'];
  const params = [client.id];
  if (q) {
    where.push('file_path LIKE ?');
    params.push(`%${q}%`);
  }
  if (operation) {
    where.push('operation = ?');
    params.push(operation);
  }
  const clause = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS n FROM file_logs WHERE ${clause}`).get(...params).n;
  const logs = db
    .prepare(`SELECT * FROM file_logs WHERE ${clause} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({ total, limit, offset, logs });
});

router.delete('/clients/:id/file-logs', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;
  const info = db.prepare('DELETE FROM file_logs WHERE client_id = ?').run(client.id);
  res.json({ ok: true, removed: info.changes });
});

/* -------------------------------- 音频信息 -------------------------------- */

router.get('/clients/:id/audio-logs', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const logs = db
    .prepare('SELECT * FROM audio_logs WHERE client_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?')
    .all(client.id, limit);
  res.json({ logs });
});

/* ------------------------------- 记录保留策略 ------------------------------- */

router.get('/clients/:id/settings', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;
  const row = db.prepare('SELECT * FROM settings WHERE client_id = ?').get(client.id);
  res.json({
    settings: {
      maxLogCount: row ? row.max_log_count : 5000,
      maxLogSize: row ? row.max_log_size : 209715200,
    },
  });
});

router.put('/clients/:id/settings', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;
  const maxLogCount = Math.max(Number(req.body.maxLogCount) || 5000, 100);
  const maxLogSize = Math.max(Number(req.body.maxLogSize) || 209715200, 1048576);

  db.prepare(
    `INSERT INTO settings (client_id, max_log_count, max_log_size, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(client_id) DO UPDATE SET
       max_log_count = excluded.max_log_count,
       max_log_size = excluded.max_log_size,
       updated_at = CURRENT_TIMESTAMP`
  ).run(client.id, maxLogCount, maxLogSize);

  // 双端同步：通知客户端立刻换策略
  presence.sendToClient(client.id, 'settings:update', { settings: { maxLogCount, maxLogSize } });
  res.json({ ok: true, settings: { maxLogCount, maxLogSize } });
});

/* -------------------------------- 命令下发 -------------------------------- */

// 走 REST 的兜底通道；主通道是 WebSocket
router.post('/clients/:id/command', teacherAuth, (req, res) => {
  const client = ownedClient(req, res);
  if (!client) return;
  const command = String(req.body.command || '').trim();
  if (!command) return res.status(400).json({ error: 'INVALID_INPUT', message: '命令不能是空的' });

  const delivered = presence.sendToClient(client.id, 'command', {
    command,
    args: req.body.args || {},
    requestId: req.body.requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    from: { userId: req.user.id, username: req.user.username },
  });
  res.json({ ok: true, delivered });
});

module.exports = router;
