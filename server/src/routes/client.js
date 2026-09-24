'use strict';

/**
 * 客户端 API：注册 / 心跳 / 上报文件记录与音频信息
 * 路由前缀 /api/client
 */

const express = require('express');
const { db } = require('../db');
const config = require('../config');
const { clientAuth, signClientToken } = require('../middleware/auth');
const presence = require('../sockets');

const router = express.Router();

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
router.post('/register', (req, res) => {
  const clientUid = String(req.body.clientUid || req.body.client_uid || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim() || null;
  const os = String(req.body.os || '').slice(0, 120);
  const version = String(req.body.version || '').slice(0, 40);
  const localIps = normalizeLocalIps(req.body.localIps);

  if (!/^[A-Z0-9-]{6,64}$/.test(clientUid)) {
    return res.status(400).json({ error: 'INVALID_CLIENT_UID', message: '客户端 ID 格式不对' });
  }

  let client = db.prepare('SELECT * FROM clients WHERE client_uid = ?').get(clientUid);
  if (!client) {
    const info = db
      .prepare(
        'INSERT INTO clients (client_uid, name, os, version, last_seen, last_ip, local_ips) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)'
      )
      .run(clientUid, name || `未命名一体机 ${clientUid.slice(-4)}`, os, version, req.ip || null, localIps);
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

router.post('/heartbeat', (req, res) => {
  const localIps = normalizeLocalIps(req.body && req.body.localIps);
  if (localIps) {
    db.prepare(
      'UPDATE clients SET last_seen = CURRENT_TIMESTAMP, last_ip = ?, local_ips = ? WHERE id = ?'
    ).run(req.clientIp || null, localIps, req.client.id);
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
