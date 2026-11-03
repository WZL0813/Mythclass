/**
 * 教师端与服务端打交道的地方
 * - 配置：VITE_SERVER_URL 留空 = 同源（本地开发走 vite 代理）
 * - REST：/api/auth/*  带 Bearer token
 * - WebSocket：socket.io，握手时把 token 塞进 auth
 *
 * ⚠️ 这个地址是**打包时写死进去的**（import.meta.env 是编译期替换）：
 *    换了服务器域名 / 换了隧道，只改代码里的常量没用 ——
 *    必须在构建环境里设置 VITE_SERVER_URL（EdgeOne 就在「环境变量」里配），
 *    然后**重新构建**才生效。构建完可以在页面 Ctrl+U 搜一下域名，
 *    确认打进去的是新地址。
 *
 * 线路有好几条（主站 + 英国 + 意大利 + Cloudflare）：
 * 页面启动时挨个问一句 /api/meta，谁先答应就用谁，并把这条记在本地。
 * 这样某条线路被墙、被限速的时候，换个页面刷新一下可能就换到另一条上了。
 */

import { io } from 'socket.io-client';

const RAW_SERVER = (import.meta.env.VITE_SERVER_URL || '').trim();

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Mythclass';
export const OFFICIAL_ENDPOINTS = (import.meta.env.VITE_OFFICIAL_ENDPOINTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .concat([
    'https://mythclassapi.ryokuryuneko.top',
    'https://mythclassapi-uk.ryokuryuneko.top',
    'https://mythclassapi-it.ryokuryuneko.top',
    'https://mythclassapi-cf.ryokuryuneko.top',
  ])
  .filter((url, i, all) => all.indexOf(url) === i);
export const OFFICIAL_SERVER =
  import.meta.env.VITE_OFFICIAL_SERVER || 'wss://mythclassapi.ryokuryuneko.top';
export const SERVER_URL = RAW_SERVER;

/** wss:// → https://，ws:// → http:// */
export function toHttpUrl(url) {
  return String(url || '').replace(/^ws(s)?:\/\//i, 'http$1://');
}

const BAKED_BASE = toHttpUrl(RAW_SERVER);
const BASE_KEY = 'mythclass.teacher.endpoint';
const MANUAL_KEY = 'mythclass.teacher.endpointManual';

/**
 * 现在用的是哪条线路。
 * 先信上一次挑中的（localStorage），启动时再探一遍，探不通就换下一条。
 */
let activeBase = (() => {
  try {
    return localStorage.getItem(BASE_KEY) || BAKED_BASE || '';
  } catch (_) {
    return BAKED_BASE || '';
  }
})();

export const HTTP_BASE = BAKED_BASE;

/** 现在实际在用的服务端地址（http(s)://…，末尾不带斜杠） */
export function currentBase() {
  return activeBase || BAKED_BASE;
}

/** 只看主机名，界面上显示用 */
export function currentHost() {
  const base = currentBase();
  if (!base) return '同源';
  try {
    return new URL(base).host;
  } catch (_) {
    return base;
  }
}

export function setEndpoint(base, { manual = false } = {}) {
  activeBase = String(base || '').trim().replace(/\/+$/, '');
  try {
    if (activeBase) localStorage.setItem(BASE_KEY, activeBase);
    else localStorage.removeItem(BASE_KEY);
    // 手动挑的那条要钉住：只要它还活着就别被自动选最快顶掉
    if (manual) localStorage.setItem(MANUAL_KEY, '1');
    else localStorage.removeItem(MANUAL_KEY);
  } catch (_) {
    /* 存不了就算了 */
  }
}

function isManualChoice() {
  try {
    return localStorage.getItem(MANUAL_KEY) === '1';
  } catch (_) {
    return false;
  }
}

/** 全部候选线路，按「上次用的 → 打包时写死的 → 官方那几条」排好 */
export function endpointCandidates() {
  const list = [];
  const push = (url) => {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (clean && !list.includes(clean)) list.push(clean);
  };
  push(activeBase);
  push(BAKED_BASE);
  for (const url of OFFICIAL_ENDPOINTS) push(toHttpUrl(url));
  return list;
}

/** 问一句 /api/meta，返回往返毫秒；不通返回 null */
async function probe(base, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = (performance && performance.now) ? performance.now() : Date.now();
  try {
    const res = await fetch(`${base}/api/meta`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (!(data && (data.ok || data.version))) return null;
    const now = (performance && performance.now) ? performance.now() : Date.now();
    return Math.round(now - started);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把每条候选线路都量一遍，返回 [{ base, ms }]（不通的 ms 是 null）
 * 页面启动时按它挑最快的那条。
 */
export async function measureEndpoints({ timeout = 3000 } = {}) {
  const list = endpointCandidates();
  const hits = await Promise.all(list.map((base) => probe(base, timeout)));
  return list.map((base, i) => ({ base, ms: hits[i] }));
}

/**
 * 挑一条能用的线路：**延迟最短**的那条（不是"第一个答应"的）。
 * 一条都不通就返回空字符串，界面照常显示错误。
 */
export async function resolveEndpoint({ timeout = 3000 } = {}) {
  const rows = await measureEndpoints({ timeout });
  const alive = rows.filter((r) => r.ms !== null).sort((a, b) => a.ms - b.ms);
  if (!alive.length) return '';

  // 用户手动挑过、而且那条还活着：听用户的
  const pinned = rows.find((r) => r.base === activeBase && r.ms !== null);
  if (pinned && isManualChoice()) return pinned.base;

  setEndpoint(alive[0].base);
  return alive[0].base;
}

/**
 * 现在这条还活着吗？不活就换到最快的那条（换完 reload 一下，页面状态干净）。
 * 返回换到了哪条；没换返回空字符串。
 */
let lastSwitchAt = 0;
export async function failoverIfDead({ timeout = 2500, minGapMs = 20000 } = {}) {
  const current = currentBase();
  if (!current) return '';
  if (Date.now() - lastSwitchAt < minGapMs) return '';

  const ms = await probe(current, timeout);
  if (ms !== null) return ''; // 还活着，别瞎折腾

  const rows = await measureEndpoints({ timeout });
  const alive = rows.filter((r) => r.ms !== null && r.base !== current).sort((a, b) => a.ms - b.ms);
  if (!alive.length) return '';
  lastSwitchAt = Date.now();
  setEndpoint(alive[0].base);
  return alive[0].base;
}

const TOKEN_KEY = 'mythclass.teacher.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** 统一请求封装 */
export async function request(path, { method = 'GET', body, auth = true, timeout = 20000 } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    res = await fetch(`${currentBase()}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('请求超时，服务端可能在打盹');
    throw new Error('连不上服务端，检查一下网络或服务端状态');
  }
  clearTimeout(timer);

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    /* 可能是空响应 */
  }

  if (!res.ok) {
    const error = new Error(data.message || data.error || `请求失败（${res.status}）`);
    error.status = res.status;
    error.code = data.error;
    throw error;
  }
  return data;
}

/* -------------------------------- 教师端 API -------------------------------- */

export const api = {
  registrationStatus: () => request('/auth/registration-status', { auth: false }),
  register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload, auth: false }),
  me: () => request('/auth/me'),
  changePassword: (payload) => request('/auth/change-password', { method: 'POST', body: payload }),
  updateProfile: (payload) => request('/auth/profile', { method: 'PUT', body: payload }),

  clients: () => request('/auth/clients'),
  bindClient: (payload) => request('/auth/bind', { method: 'POST', body: payload }),
  renameClient: (id, name) => request(`/auth/clients/${id}`, { method: 'PUT', body: { name } }),
  unbindClient: (id) => request(`/auth/clients/${id}`, { method: 'DELETE' }),
  clientInfo: (id) => request(`/auth/clients/${id}/info`),
  fileLogs: (id, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/auth/clients/${id}/file-logs?${qs}`);
  },
  clearFileLogs: (id) => request(`/auth/clients/${id}/file-logs`, { method: 'DELETE' }),
  audioLogs: (id, limit = 50) => request(`/auth/clients/${id}/audio-logs?limit=${limit}`),
  getSettings: (id) => request(`/auth/clients/${id}/settings`),
  saveSettings: (id, payload) => request(`/auth/clients/${id}/settings`, { method: 'PUT', body: payload }),
  sendCommand: (id, command, args = {}) =>
    request(`/auth/clients/${id}/command`, { method: 'POST', body: { command, args } }),
};

/* -------------------------------- WebSocket -------------------------------- */

let socket = null;

export function connectSocket() {
  const token = tokenStore.get();
  if (!token) throw new Error('还没登录');

  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();

  socket = io(currentBase() || undefined, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1200,
    reconnectionDelayMax: 8000,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
