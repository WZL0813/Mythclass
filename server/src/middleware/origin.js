'use strict';

/**
 * 来源（Origin）判定的统一入口
 *
 * 为什么单独抽出来：HTTP 接口和 WebSocket 握手要守同一套规矩，
 * 两处各写一遍迟早会不一致。
 *
 * 规矩三条：
 *   1. 没带 Origin 的（脚本、客户端、curl）一律放行
 *   2. 命中 CORS_ORIGINS 白名单的放行
 *   3. 同源的放行 —— 这条最容易漏
 *
 * 第三条为什么必须有：Admin 后台可能从 localhost、局域网 IP、隧道域名访问，
 * 而浏览器对 POST 请求**一定会带 Origin 头**。
 * 只认白名单的话，`http://192.168.1.5:3000/admin` 这种访问必然被 403 打死。
 */

const config = require('../config');

/** 取请求的 Host（放在反代后面时优先信 x-forwarded-host） */
function requestHost(req) {
  const raw = req.headers['x-forwarded-host'] || req.headers.host || '';
  return String(raw).split(',')[0].trim().toLowerCase();
}

/** 这个来源能不能放行 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  const list = config.corsOrigins || [];
  if (list.includes('*') || list.includes(origin)) return true;

  try {
    // 只比 host（含端口），不比对协议：https 站点经反代访问 http 服务也算同源
    return new URL(origin).host.toLowerCase() === requestHost(req);
  } catch (_) {
    return false;
  }
}

/** 给日志用的简短说明 */
function describeOrigin(req) {
  return req.headers.origin || '(无 Origin)';
}

module.exports = { originAllowed, requestHost, describeOrigin };
