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
const { originAllowed, describeOrigin } = require('../middleware/origin');

let io = null;
const startedAt = Date.now();

const clientSockets = new Map(); // clientId -> Set<socketId>
const userSockets = new Map(); // userId -> Set<socketId>

// userId -> { ids: Set<clientId>, timer }
// 老师断线重连时靠它把房间恢复回来；超过 TTL 没人回来就清掉
const userWatches = new Map();
const WATCH_TTL_MS = 3 * 60 * 1000;

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
/** 从握手请求里取出访问者真实 IP（隧道后面看 x-forwarded-for） */
function visitorIp(request) {
  const fwd = (request && request.headers && request.headers['x-forwarded-for']) || '';
  const first = String(fwd).split(',')[0].trim();
  if (first) return first;
  const addr = (request && request.connection && request.connection.remoteAddress) || '';
  return String(addr).replace(/^::ffff:/, '');
}

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

/** 这台机器现在有几个老师在看着 */
function teacherWatcherCount(clientId) {
  const room = io.sockets.adapter.rooms.get(`client:${clientId}`);
  if (!room) return 0;
  let n = 0;
  for (const sid of room) {
    const s = io.sockets.sockets.get(sid);
    if (s && s.data.role === 'teacher') n += 1;
  }
  return n;
}

/** 没人看了就让它停。对着空气推流既费性能又难看 */
function stopIfNobodyWatching(clientId) {
  if (teacherWatcherCount(clientId) > 0) return false;
  return sendToClient(clientId, 'command', {
    command: 'screen_stop',
    args: {},
    requestId: `auto-stop-${Date.now()}`,
    from: { system: true },
  });
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
    // 同源与白名单都放行。真正的门是握手时那张 JWT，不是来源
    cors: { origin: true, credentials: true },
    allowRequest: (req, callback) => {
      const ok = originAllowed(req);
      if (!ok) console.warn(`[Mythclass] 拦下跨域的 WebSocket 握手：${describeOrigin(req)}`);
      callback(null, ok);
    },
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
    // 客户端要按 IP 记「直连次数」，所以得把真实 IP 一路带下去。
    // 注意这里只有 socket.handshake，没有 req
    socket.data.ip = visitorIp(socket.handshake);
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
  socket.on('heartbeat', (payload) => {
    // 顺便记下客户端实际在用的局域网端口（系统占用时它会自己换）
    if (payload && typeof payload === 'object') {
      const lanPort = Number(payload.lanPort || 0) || 0;
      const lanWebPort = Number(payload.lanWebPort || 0) || 0;
      if (lanPort || lanWebPort) {
        try {
          db.prepare(
            'UPDATE clients SET lan_port = ?, lan_web_port = ? WHERE id = ?'
          ).run(lanPort, lanWebPort, clientId);
        } catch (_) {
          /* 老库没这两列就算了 */
        }
      }
    }
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

  // 纯回执：老师用来量到服务端的往返延迟，不碰数据库
  socket.on('probe', (payload, ack) => {
    if (typeof ack === 'function') ack({ t: Date.now(), echo: payload || null });
  });

  // 断线重连：把之前在看的那几台恢复回来（短时间内有效）
  const remembered = userWatches.get(userId);
  if (remembered) {
    if (remembered.timer) {
      clearTimeout(remembered.timer);
      remembered.timer = null;
    }
    for (const clientId of remembered.ids) {
      if (!ownsClient(userId, clientId)) continue;
      socket.join(`client:${clientId}`);
    }
    if (remembered.ids.size > 0) {
      socket.emit('watch:restored', { clientIds: [...remembered.ids] });
    }
  }

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

    // 记住，断线重连要自动回来
    if (!userWatches.has(userId)) userWatches.set(userId, { ids: new Set(), timer: null });
    userWatches.get(userId).ids.add(id);

    // 注意：这里**不**主动开流。开流只能由老师点「开始看」触发，
    // 否则「选中一台机器」就等于开始监控了。

    if (typeof ack === 'function') ack({ ok: true, online: isClientOnline(id) });
  });

  socket.on('unwatch', ({ clientId } = {}) => {
    const id = Number(clientId);
    socket.leave(`client:${id}`);
    const watched = userWatches.get(userId);
    if (watched) watched.ids.delete(id);
    // 稍微等一下再判断：老师可能只是切个页面马上回来
    setTimeout(() => stopIfNobodyWatching(id), 800);
  });

  // 老师 → 客户端
  const forward = (event) => (payload = {}, ack) => {
    const id = Number(payload.clientId);
    if (!ownsClient(userId, id)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'NOT_BOUND' });
      return;
    }
    const delivered = sendToClient(id, event, {
      ...payload,
      from: { userId, username: socket.data.username, ip: socket.data.ip || '' },
    });
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

    const watched = userWatches.get(userId);
    if (!watched) return;

    // 这条连接已经离开房间了，看看还有没有别人在看
    for (const id of watched.ids) stopIfNobodyWatching(id);

    // 先别清记忆：短时间内重连要能恢复。超时了再清。
    if (!watched.timer) {
      watched.timer = setTimeout(() => {
        for (const id of watched.ids) stopIfNobodyWatching(id);
        userWatches.delete(userId);
      }, WATCH_TTL_MS);
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
