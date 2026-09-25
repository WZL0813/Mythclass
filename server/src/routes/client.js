'use strict';

/**
 * 客户端 API：注册 / 心跳 / 上报文件记录与音频信息
 * 路由前缀 /api/client
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const config = require('../config');
const { clientAuth, signClientToken, clientIp } = require('../middleware/auth');
const presence = require('../sockets');

const router = express.Router();

// 查更新是公开接口，简单限流：一台机器一分钟最多 10 次
const updateHits = new Map();
function updaterLimit(req, res, next) {
  const key = clientIp(req) || req.ip || 'unknown';
  const now = Date.now();
  const list = (updateHits.get(key) || []).filter((t) => now - t < 60000);
  if (list.length >= 10) {
    return res.status(429).json({ error: 'TOO_MANY', message: '查得太勤了，等会儿再试' });
  }
  list.push(now);
  updateHits.set(key, list);
  next();
}


/** 客户端可能报好几个网卡地址，只收内网段、最多 8 个 */
function normalizeLocalIps(raw) {
  if (!Array.isArray(raw)) return null;
  const keep = [];
  for (const item of raw.slice(0, 8)) {
    const ip = String(item || '').trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(ip)) keep.push(ip);
  }
  return keep.length ? [...new Set(keep)].join(',') : null;
}

/**
 * 客户端崩了往这儿报。
 *
 * 故意放在 clientAuth 之前：客户端可能还没注册成功就崩了，
 * 那种时候它没有凭证，但这条消息恰恰最有用。
 * 所以只认 clientUid，同时把正文长度卡死，免得被灌垃圾。
 */
router.post('/errors', (req, res) => {
  const clientUid = String(req.body.clientUid || '').trim().toUpperCase().slice(0, 64);
  const kind = String(req.body.kind || 'error').slice(0, 40);
  const message = String(req.body.message || '').slice(0, 500);
  const detail = String(req.body.detail || '').slice(0, 8000);
  const version = String(req.body.version || '').slice(0, 40);

  if (!clientUid || (!message && !detail)) {
    return res.status(400).json({ error: 'BAD_REPORT', message: '缺 clientUid 或内容' });
  }

  const client = db.prepare('SELECT id FROM clients WHERE client_uid = ?').get(clientUid);
  db.prepare(
    'INSERT INTO client_errors (client_id, client_uid, kind, message, detail, version) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(client ? client.id : null, clientUid, kind, message, detail, version);

  console.log(`[Mythclass] 客户端报错 ${clientUid}（${kind}）：${message.slice(0, 120)}`);
  res.status(201).json({ ok: true });
});

/** 客户端第一次跑起来，拿一个长期凭证 */
/**
 * 卸载器用来确认「来卸载的人真的是这台机器的老师」。
 *
 * 位置必须放在 router.use(clientAuth) 之前：卸载器没有客户端凭证，
 * 它只有老师输入的用户名和密码。
 */
const uninstallAttempts = new Map(); // clientUid -> { count, first }

/**
 * 客户端查更新。公开接口（客户端还没登录也可能要查），所以限流。
 * 版本比大小：只认数字段，2.6.0 > 2.5.10 这种也对。
 */
function parseVersion(text) {
  if (!text) return null;
  const parts = String(text).trim().replace(/^v/i, '').split('.');
  const nums = [];
  for (const p of parts) {
    const digits = String(p).replace(/\D/g, '');
    if (digits === '') return null;
    nums.push(Number(digits));
  }
  return nums.length ? nums : null;
}

function compareVersion(a, b) {
  if (!a || !b) return 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 下载安装包。**只放行「当前那条更新」的文件** ——
 * 别的文件就算知道名字也拿不到，管理员也能随时删掉。
 */
router.get('/download/:name', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  const name = path.basename(String(req.params.name || ''));
  const latest = db
    .prepare('SELECT * FROM releases WHERE platform = ? ORDER BY id DESC LIMIT 1')
    .get('win');

  if (!latest || !latest.file || latest.file !== name) {
    return res.status(404).json({ error: 'NOT_AVAILABLE', message: '这个文件不是当前发布的更新' });
  }

  const dir = config.releasesDir;
  const full = path.join(dir, name);
  if (!full.startsWith(dir) || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: '服务端上没有这个文件了' });
  }
  res.download(full, name);
});

router.get('/update', updaterLimit, (req, res) => {
  const current = String(req.query.version || '').trim();
  const platform = String(req.query.platform || 'win').trim() || 'win';
  const row = db
    .prepare('SELECT * FROM releases WHERE platform = ? ORDER BY id DESC LIMIT 1')
    .get(platform);

  if (!row) {
    return res.json({ update: false, current, latest: current, message: '还没有发布过更新' });
  }

  const mine = parseVersion(current);
  const theirs = parseVersion(row.version);
  const newer = mine && theirs ? compareVersion(theirs, mine) > 0 : false;

  // 服务端托管的文件：拼一个指向本服务器的下载地址
  let url = row.url || '';
  if (row.file) {
    const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    url = `${base}/api/client/download/${encodeURIComponent(row.file)}`;
  }

  res.json({
    update: newer,
    current,
    latest: row.version,
    url: newer ? url : '',
    notes: newer ? row.notes : '',
    sha256: newer ? row.sha256 : '',
    mandatory: newer ? !!row.mandatory : false,
    publishedAt: row.created_at,
  });
});

router.post('/verify-uninstall', (req, res) => {
  const clientUid = String(req.body.clientUid || '').trim().toUpperCase();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!clientUid || !username || !password) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: '参数不全' });
  }

  // 限流：同一个客户端 10 分钟最多试 5 次
  const now = Date.now();
  const window = 10 * 60 * 1000;
  let record = uninstallAttempts.get(clientUid);
  if (!record || now - record.first > window) {
    record = { count: 0, first: now };
    uninstallAttempts.set(clientUid, record);
  }
  if (record.count >= 5) {
    console.warn(`[Mythclass] 卸载验证试太多次：${clientUid}`);
    return res.status(429).json({ ok: false, error: 'TOO_MANY', message: '试太多次了，等十分钟' });
  }
  record.count += 1;

  const client = db.prepare('SELECT * FROM clients WHERE client_uid = ?').get(clientUid);
  if (!client) {
    return res.status(404).json({ ok: false, error: 'CLIENT_NOT_FOUND', message: '没找到这台机器' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    console.warn(`[Mythclass] 卸载验证：${clientUid} 密码不对（${username}）`);
    return res.status(401).json({ ok: false, error: 'BAD_PASSWORD', message: '密码不对' });
  }

  // 必须是绑定了这台机器的老师
  const bound = db
    .prepare('SELECT 1 FROM bindings WHERE client_id = ? AND user_id = ?')
    .get(client.id, user.id);
  if (!bound) {
    console.warn(`[Mythclass] 卸载验证：${username} 没绑定 ${clientUid}`);
    return res.status(403).json({ ok: false, error: 'NOT_BOUND', message: '这个账号不负责这台机器' });
  }

  record.count = 0; // 成功了就把计数清掉
  console.log(`[Mythclass] 卸载验证通过：${clientUid} ← ${username}`);
  res.json({ ok: true, username: user.username, clientUid });
});

router.post('/register', (req, res) => {
  const clientUid = String(req.body.clientUid || req.body.client_uid || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim() || null;
  const os = String(req.body.os || '').slice(0, 120);
  const version = String(req.body.version || '').slice(0, 40);
  const localIps = normalizeLocalIps(req.body.localIps);
  const lanKey = String(req.body.lanKey || '').slice(0, 64);

  if (!/^[A-Z0-9-]{6,64}$/.test(clientUid)) {
    return res.status(400).json({ error: 'INVALID_CLIENT_UID', message: '客户端 ID 格式不对' });
  }

  let client = db.prepare('SELECT * FROM clients WHERE client_uid = ?').get(clientUid);
  if (!client) {
    const info = db
      .prepare(
        'INSERT INTO clients (client_uid, name, os, version, last_seen, last_ip, local_ips, lan_key) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)'
      )
      .run(clientUid, name || `未命名一体机 ${clientUid.slice(-4)}`, os, version, req.ip || null, localIps, lanKey || null);
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
    console.log(`[Mythclass] 新客户端注册：${clientUid} (#${client.id})`);
  } else {
    db.prepare('UPDATE clients SET os = ?, version = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(os, version, client.id);
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
  }

  res.json({
    token: signClientToken(client),
    client: { id: client.id, clientUid: client.client_uid, name: client.name },
    server: { official: config.officialServer, relayEnabled: config.relayEnabled },
  });
});

router.use(clientAuth);

/** 客户端拉一次自己的策略 */
router.get('/config', (req, res) => {
  const row = db.prepare('SELECT * FROM settings WHERE client_id = ?').get(req.client.id);
  res.json({
    settings: {
      maxLogCount: row ? row.max_log_count : config.fileLogMaxCount,
      maxLogSize: row ? row.max_log_size : config.fileLogMaxSize,
    },
    relayEnabled: config.relayEnabled,
    officialServer: config.officialServer,
  });
});

/**
 * 这台机器绑定了哪些老师。
 *
 * 一体机起本地网页时要用：页面上显示「本机归属」，
 * 也顺便知道自己该认谁。客户端只能拉到自己这条绑定，看不到别的机器。
 */
router.get('/teachers', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.username, b.created_at AS bound_at
         FROM bindings b
         JOIN users u ON u.id = b.user_id
        WHERE b.client_id = ?
        ORDER BY b.created_at`
    )
    .all(req.client.id);

  res.json({
    client: {
      id: req.client.id,
      clientUid: req.client.client_uid,
      name: req.client.name,
    },
    teachers: rows.map((r) => ({
      id: r.user_id,
      username: r.username,
      boundAt: r.bound_at,
    })),
    serverTime: Date.now(),
  });
});

router.post('/heartbeat', (req, res) => {
  const localIps = normalizeLocalIps(req.body && req.body.localIps);
  const lanKey = String((req.body && req.body.lanKey) || '').slice(0, 64) || null;
  if (localIps || lanKey) {
    db.prepare(
      'UPDATE clients SET last_seen = CURRENT_TIMESTAMP, last_ip = ?, local_ips = COALESCE(?, local_ips), lan_key = COALESCE(?, lan_key) WHERE id = ?'
    ).run(req.clientIp || null, localIps, lanKey, req.client.id);
  } else {
    db.prepare('UPDATE clients SET last_seen = CURRENT_TIMESTAMP, last_ip = ? WHERE id = ?').run(
      req.clientIp || null,
      req.client.id
    );
  }
  res.json({ ok: true, t: Date.now() });
});

/** 批量上报文件改动 */
router.post('/file-logs', (req, res) => {
  const logs = Array.isArray(req.body.logs) ? req.body.logs : [];
  if (logs.length === 0) return res.json({ ok: true, saved: 0 });

  const insert = db.prepare(
    'INSERT INTO file_logs (client_id, timestamp, operation, file_path, file_size) VALUES (?, ?, ?, ?, ?)'
  );
  const saveMany = db.transaction((items) => {
    let n = 0;
    for (const item of items.slice(0, 500)) {
      const ts = String(item.timestamp || '').slice(0, 19) || new Date().toISOString().slice(0, 19).replace('T', ' ');
      insert.run(
        req.client.id,
        ts,
        String(item.operation || 'unknown').slice(0, 32),
        String(item.filePath || item.file_path || '').slice(0, 500),
        Number(item.fileSize || item.file_size || 0)
      );
      n += 1;
    }
    return n;
  });

  const saved = saveMany(logs);
  trimLogs(req.client.id);

  // 顺手推给正在看这台机器的老师
  presence.sendToUser(
    db.prepare('SELECT owner_user_id FROM clients WHERE id = ?').get(req.client.id).owner_user_id,
    'file_log',
    { clientId: req.client.id, logs: logs.slice(0, 50) }
  );

  res.json({ ok: true, saved });
});

/** 上报当前音频状态 */
router.post('/audio-info', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [req.body];
  const insert = db.prepare(
    'INSERT INTO audio_logs (client_id, timestamp, process_name, title, volume, state) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?)'
  );
  const saveMany = db.transaction((list) => {
    for (const item of list.slice(0, 20)) {
      insert.run(
        req.client.id,
        String(item.processName || item.process_name || '').slice(0, 120),
        String(item.title || '').slice(0, 200),
        Math.max(0, Math.min(100, Number(item.volume) || 0)),
        String(item.state || 'unknown').slice(0, 32)
      );
    }
  });
  saveMany(items);

  const owner = db.prepare('SELECT owner_user_id FROM clients WHERE id = ?').get(req.client.id).owner_user_id;
  if (owner) presence.sendToUser(owner, 'audio_info', { clientId: req.client.id, items });

  res.json({ ok: true });
});

/** 命令执行结果 */
router.post('/command-result', (req, res) => {
  const owner = db.prepare('SELECT owner_user_id FROM clients WHERE id = ?').get(req.client.id).owner_user_id;
  if (owner) {
    presence.sendToUser(owner, 'command_result', {
      clientId: req.client.id,
      requestId: req.body.requestId || null,
      command: req.body.command || null,
      ok: req.body.ok !== false,
      output: String(req.body.output || '').slice(0, 2000),
      at: new Date().toISOString(),
    });
  }
  res.json({ ok: true });
});

/** 超量清理：先按条数砍，再按占用估算砍 */
function trimLogs(clientId) {
  const row = db.prepare('SELECT * FROM settings WHERE client_id = ?').get(clientId);
  const maxCount = (row && row.max_log_count) || config.fileLogMaxCount;

  const total = db.prepare('SELECT COUNT(*) AS n FROM file_logs WHERE client_id = ?').get(clientId).n;
  if (total > maxCount) {
    db.prepare(
      `DELETE FROM file_logs WHERE id IN (
         SELECT id FROM file_logs WHERE client_id = ? ORDER BY timestamp ASC, id ASC LIMIT ?
       )`
    ).run(clientId, total - maxCount);
  }
}

module.exports = router;
