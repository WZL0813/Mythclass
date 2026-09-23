import { defineStore } from 'pinia';
import { api, tokenStore, connectSocket, disconnectSocket } from '@/api';

/** 登录态 + 客户端列表 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    // token 必须放 state 里。
    // 之前 isLoggedIn 直接读 localStorage，而 Pinia 的 getter 只跟着响应式数据重新计算——
    // 没有任何响应式依赖时它算一次就永久缓存，于是登录后导航栏还是「未登录」的样子。
    token: tokenStore.get(),
    user: null,
    clients: [],
    watching: [], // 正在看哪几台。重连后要重新 join，不然收不到画面
    socket: null,
    socketReady: false,
    presence: {}, // clientId -> online
  }),

  getters: {
    isLoggedIn: (s) => !!s.token,
    /** 显示用的名字。还没拿到用户信息时也别显示空白 */
    displayName: (s) => (s.user && s.user.username) || '教师',
    onlineCount: (s) => s.clients.filter((c) => s.presence[c.id]).length,
  },

  actions: {
    setToken(token) {
      this.token = token || '';
      tokenStore.set(this.token);
    },

    async login(payload) {
      const data = await api.login(payload);
      this.setToken(data.token);
      this.user = data.user;
      return data.user;
    },

    async register(payload) {
      const data = await api.register(payload);
      this.setToken(data.token);
      this.user = data.user;
      return data.user;
    },

    async fetchMe() {
      const data = await api.me();
      this.user = data.user;
      return data.user;
    },

    /** 带着 token 刷新页面时，把用户信息补回来；token 失效就清掉 */
    async restore() {
      if (!this.token) return null;
      try {
        return await this.fetchMe();
      } catch (_) {
        this.logout();
        return null;
      }
    },

    async fetchClients() {
      const data = await api.clients();
      this.clients = data.clients;
      for (const c of data.clients) this.presence[c.id] = c.online;
      return this.clients;
    },

    /** 打开长连接，把在线状态与事件接进来 */
    openSocket({ onFrame, onAudio, onFileLog, onCommandResult } = {}) {
      const socket = connectSocket();
      this.socket = socket;

      socket.on('connect', () => {
        this.socketReady = true;
        // 重连后房间成员资格没了，得自己补回来
        for (const clientId of this.watching) socket.emit('watch', { clientId });
      });
      socket.on('disconnect', () => {
        this.socketReady = false;
      });
      socket.on('connect_error', () => {
        this.socketReady = false;
      });

      socket.on('client:presence', (payload) => {
        if (payload.batch) {
          for (const item of payload.batch) this.presence[item.clientId] = item.online;
        } else {
          this.presence[payload.clientId] = payload.online;
        }
      });

      socket.on('force:logout', () => {
        this.logout();
        window.location.href = '/login';
      });

      if (onFrame) socket.on('screen_frame', onFrame);
      if (onAudio) socket.on('audio_info', onAudio);
      if (onFileLog) socket.on('file_log', onFileLog);
      if (onCommandResult) socket.on('command_result', onCommandResult);

      return socket;
    },

    watchClient(clientId) {
      if (!this.watching.includes(clientId)) this.watching.push(clientId);
      if (this.socket) this.socket.emit('watch', { clientId });
    },

    unwatchClient(clientId) {
      this.watching = this.watching.filter((id) => id !== clientId);
      if (this.socket) this.socket.emit('unwatch', { clientId });
    },

    sendCommand(clientId, command, args = {}) {
      if (!this.socket || !this.socket.connected) {
        return Promise.resolve({ ok: false, error: 'OFFLINE' });
      }
      return new Promise((resolve) => {
        let done = false;
        this.socket.emit('command', { clientId, command, args, requestId: `${Date.now()}` }, (ack) => {
          done = true;
          resolve(ack || { ok: false });
        });
        setTimeout(() => {
          if (!done) resolve({ ok: false, error: 'TIMEOUT' });
        }, 4000);
      });
    },

    sendControl(clientId, event) {
      if (this.socket && this.socket.connected) {
        this.socket.emit('control_event', { clientId, event });
      }
    },

    logout() {
      this.token = '';
      tokenStore.clear();
      disconnectSocket();
      this.socket = null;
      this.socketReady = false;
      this.user = null;
      this.clients = [];
      this.presence = {};
      this.watching = [];
    },
  },
});
