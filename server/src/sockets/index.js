'use strict';

/**
 * Socket.IO：信令 + 中继 + 在线状态
 *
 * 房间约定：
 *   user:<userId>    某个教师账号的所有连接
 *   client:<clientId> 某台一体机 + 正在观看它的老师
 *
 * 安全：连上来先验 JWT；老师必须先证明自己绑定了这台机器，才准进房间。
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');

let io = null;
const startedAt = Date.now();

const clientSockets = new Map(); // clientId -> Set<socketId>
const userSockets = new Map(); // userId -> Set<socketId>

/* ------------------------------ 状态查询 ------------------------------ */

function isClientOnline(clientId) {
  const set = clientSockets.get(Number(clientId));
  return !!set && set.size > 0;
}

function onlineClientIds() {
  const ids = [];
  for (const [id, set] of clientSockets) if (set.size > 0) ids.push(id);
  return ids;
}

function onlineUserIds() {
  const ids = [];
  for (const [id, set] of userSockets) if (set.size > 0) ids.push(id);
  return ids;
}

function stats() {
  return {
    wsConnections: io ? io.engine.clientsCount : 0,
    onlineClients: onlineClientIds().length,
    onlineUsers: onlineUserIds().length,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  };
}

/* ------------------------------ 定向发送 ------------------------------ */

/** 只发给那一台一体机 */
function sendToClient(clientId, event, payload) {
  const set = clientSockets.get(Number(clientId));
  if (!set || set.size === 0) return false;
  for (const sid of set) io.to(sid).emit(event, payload);
  return true;
}

/** 发给某个教师账号的所有页面 */
function sendToUser(userId, event, payload) {
  io.to(`user:${userId}`).emit(event, payload);
}

/** 掐掉某个账号的所有连接（封禁 / 删号 / 改密时用） */
function kickUser(userId, reason = 'TOKEN_REVOKED') {
  const set = userSockets.get(Number(userId));
  if (!set) return 0;
  let n = 0;
  for (const sid of set) {
    const s = io.sockets.sockets.get(sid);
    if (s) {
      s.emit('force:logout', { reason });
      s.disconnect(true);
      n += 1;
    }
  }
  return n;
}

/** 老师是否有权看这台机器 */
function ownsClient(userId, clientId) {
  const row = db
    .prepare('SELECT 1 AS ok FROM bindings WHERE user_id = ? AND client_id = ?')
    .get(userId, clientId);
  return !!row;
}

function touchClient(clientId, ip) {
  db.prepare('UPDATE clients SET last_seen = CURRENT_TIMESTAMP, last_ip = COALESCE(?, last_ip) WHERE id = ?').run(
    ip || null,
    clientId
  );
}

function notifyPresence(clientId, online) {
  const row = db.prepare('SELECT owner_user_id FROM clients WHERE id = ?').get(clientId);
  if (row && row.owner_user_id) {
    sendToUser(row.owner_user_id, 'client:presence', { clientId: Number(clientId), online });
  }
}

/* ------------------------------ 初始化 ------------------------------ */

function init(server) {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: config.corsOrigins, credentials: true },
    maxHttpBufferSize: 8 * 1024 * 1024, // 屏幕帧能大一点
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // 握手鉴权
  io.use((socket, next) => {
    const token = (socket.handshake.auth && socket.handshake.auth.token) || socket.handshake.query.token;
    if (!token) return next(new Error('UNAUTHORIZED'));
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch (_) {
      return next(new Error('TOKEN_INVALID'));
    }

    if (payload.role === 'client') {
      const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(payload.cid);
      if (!client) return next(new Error('CLIENT_NOT_FOUND'));
      socket.data.role = 'client';
      socket.data.clientId = client.id;
      socket.data.client = client;
      return next();
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) return next(new Error('USER_NOT_FOUND'));
    if (user.status === 'banned') return next(new Error('USER_BANNED'));
    if (Number(payload.tv) !== Number(user.token_version)) return next(new Error('TOKEN_REVOKED'));
    socket.data.role = 'teacher';
    socket.data.userId = user.id;
    socket.data.username = user.username;
    return next();
  });

  io.on('connection', (socket) => {
    if (socket.data.role === 'client') bindClient(socket);
    else bindTeacher(socket);
  });

  return io;
}

/* ------------------------------ 客户端侧 ------------------------------ */

function bindClient(socket) {
  const clientId = socket.data.clientId;
  if (!clientSockets.has(clientId)) clientSockets.set(clientId, new Set());
  clientSockets.get(clientId).add(socket.id);

  socket.join(`client:${clientId}`);
  touchClient(clientId, socket.handshake.address);
  notifyPresence(clientId, true);
  socket.emit('registered', { clientId, relayEnabled: config.relayEnabled });

  // 心跳：刷新 last_seen，并回执
  socket.on('heartbeat', () => {
    touchClient(clientId, socket.handshake.address);
    socket.emit('heartbeat:ack', { t: Date.now() });
    notifyPresence(clientId, true);
  });

  // 下面这些都是「客户端 → 老师」，用 socket.to 排除自己
  const relay = (event) => (payload) => {
    if (!config.relayEnabled) return;
    socket.to(`client:${clientId}`).emit(event, { clientId, ...(payload || {}) });
  };
  socket.on('screen_frame', relay('screen_frame'));
  socket.on('audio_info', relay('audio_info'));
  socket.on('file_log', relay('file_log'));
  socket.on('command_result', relay('command_result'));
  socket.on('offer', relay('offer'));
  socket.on('answer', relay('answer'));
  socket.on('ice', relay('ice'));
  socket.on('control_event', relay('control_event')); // 老师自己也控制时用于回显

  socket.on('disconnect', () => {
    const set = clientSockets.get(clientId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        clientSockets.delete(clientId);
        touchClient(clientId, null);
        notifyPresence(clientId, false);
      }
    }
  });
}

/* ------------------------------ 教师端侧 ------------------------------ */

function bindTeacher(socket) {
  const userId = socket.data.userId;
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);
  socket.join(`user:${userId}`);

  // 已绑定客户端的在线状态，连上就推一遍
  const bound = db.prepare('SELECT client_id FROM bindings WHERE user_id = ?').all(userId);
  socket.emit('client:presence', {
    batch: bound.map((r) => ({ clientId: r.client_id, online: isClientOnline(r.client_id) })),
  });

  socket.on('watch', ({ clientId } = {}, ack) => {
    const id = Number(clientId);
    if (!ownsClient(userId, id)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'NOT_BOUND' });
      return;
    }
    socket.join(`client:${id}`);
    touchClient(id, null);
    if (typeof ack === 'function') ack({ ok: true, online: isClientOnline(id) });
  });

  socket.on('unwatch', ({ clientId } = {}) => {
    socket.leave(`client:${Number(clientId)}`);
  });

  // 老师 → 客户端
  const forward = (event) => (payload = {}, ack) => {
    const id = Number(payload.clientId);
    if (!ownsClient(userId, id)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'NOT_BOUND' });
      return;
    }
    const delivered = sendToClient(id, event, { ...payload, from: { userId, username: socket.data.username } });
    if (typeof ack === 'function') ack({ ok: delivered, delivered });
  };

  socket.on('command', forward('command'));
  socket.on('control_event', forward('control_event'));
  socket.on('offer', forward('offer'));
  socket.on('answer', forward('answer'));
  socket.on('ice', forward('ice'));
  socket.on('request_frame', forward('request_frame'));
  socket.on('settings:update', ({ clientId, settings } = {}) => {
    const id = Number(clientId);
    if (!ownsClient(userId, id)) return;
    sendToClient(id, 'settings:update', { settings });
  });

  socket.on('disconnect', () => {
    const set = userSockets.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) userSockets.delete(userId);
    }
  });
}

module.exports = {
  init,
  stats,
  sendToClient,
  sendToUser,
  kickUser,
  isClientOnline,
  onlineClientIds,
  onlineUserIds,
  ownsClient,
};
