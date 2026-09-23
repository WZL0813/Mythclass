'use strict';

/**
 * 鉴权中间件
 * - 教师端：Authorization: Bearer <teacher_jwt>      载荷含 uid / tv
 * - 客户端：Authorization: Bearer <client_jwt>      载荷含 cid / role=client
 * - Admin ：Admin-Bearer <admin_jwt>                载荷含 role=admin
 *
 * 封禁即时生效：JWT 里带 token_version，与库中不一致就拒绝。
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');

function signTeacherToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, tv: user.token_version, role: 'teacher' },
    config.jwtSecret,
    { expiresIn: config.teacherTokenTtl }
  );
}

function signClientToken(client) {
  return jwt.sign(
    { cid: client.id, uid: client.client_uid, role: 'client' },
    config.jwtSecret,
    { expiresIn: config.clientTokenTtl }
  );
}

function signAdminToken(admin) {
  return jwt.sign(
    { aid: admin.id, username: admin.username, role: 'admin' },
    config.adminJwtSecret,
    { expiresIn: config.adminTokenTtl }
  );
}

function bearer(req) {
  const raw = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

function adminBearer(req) {
  const raw = req.headers.authorization || '';
  const m = /^Admin-Bearer\s+(.+)$/i.exec(raw.trim());
  if (m) return m[1].trim();
  return bearer(req); // 兼容 Bearer 写法
}

/** 教师端鉴权 */
function teacherAuth(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED', message: '缺少登录凭证' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch (_) {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: '登录已过期，请重新登录' });
  }
  if (payload.role && payload.role !== 'teacher') {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: '凭证类型不匹配' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
  if (!user) return res.status(401).json({ error: 'USER_NOT_FOUND', message: '账号不存在' });
  if (user.status === 'banned') {
    return res.status(403).json({ error: 'USER_BANNED', message: '账号已被封禁' });
  }
  if (Number(payload.tv) !== Number(user.token_version)) {
    return res.status(401).json({ error: 'TOKEN_REVOKED', message: '登录状态已失效，请重新登录' });
  }

  req.user = user;
  req.token = token;
  return next();
}

/** 客户端鉴权 */
function clientAuth(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED', message: '缺少客户端凭证' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch (_) {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: '客户端凭证无效' });
  }
  if (payload.role !== 'client') {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: '凭证类型不匹配' });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(payload.cid);
  if (!client) return res.status(401).json({ error: 'CLIENT_NOT_FOUND', message: '客户端未注册' });

  req.client = client;
  req.clientIp = clientIp(req);
  return next();
}

/** Admin 鉴权 */
function adminAuth(req, res, next) {
  const token = adminBearer(req);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED', message: '缺少管理员凭证' });

  let payload;
  try {
    payload = jwt.verify(token, config.adminJwtSecret);
  } catch (_) {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: '管理员登录已过期' });
  }
  if (payload.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: '不是管理员凭证' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(payload.aid);
  if (!admin) return res.status(401).json({ error: 'ADMIN_NOT_FOUND', message: '管理员不存在' });

  req.admin = admin;
  return next();
}

/** 取真实来访 IP（经过 Cloudflare 时优先用 CF-Connecting-IP） */
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf);
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

module.exports = {
  teacherAuth,
  clientAuth,
  adminAuth,
  signTeacherToken,
  signClientToken,
  signAdminToken,
  clientIp,
};
