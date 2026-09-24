/**
 * 教师端与服务端打交道的地方
 * - 配置：VITE_SERVER_URL 留空 = 同源（本地开发走 vite 代理）
 * - REST：/api/auth/*  带 Bearer token
 * - WebSocket：socket.io，握手时把 token 塞进 auth
 */

import { io } from 'socket.io-client';

const RAW_SERVER = (import.meta.env.VITE_SERVER_URL || '').trim();

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Mythclass';
export const OFFICIAL_SERVER = import.meta.env.VITE_OFFICIAL_SERVER || 'wss://mythclassapi.ryokuryuneko.top';
export const SERVER_URL = RAW_SERVER;

/** wss:// → https://，ws:// → http:// */
export function toHttpUrl(url) {
  return String(url || '').replace(/^ws(s)?:\/\//i, 'http$1://');
}

export const HTTP_BASE = toHttpUrl(RAW_SERVER);

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
    res = await fetch(`${HTTP_BASE}/api${path}`, {
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

  socket = io(HTTP_BASE || undefined, {
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
