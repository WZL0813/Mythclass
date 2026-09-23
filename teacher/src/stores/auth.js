import { defineStore } from 'pinia';
import { api, tokenStore, connectSocket, disconnectSocket } from '@/api';

/** 登录态 + 客户端列表 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    clients: [],
    socket: null,
    socketReady: false,
    presence: {}, // clientId -> online
  }),

  getters: {
    isLoggedIn: () => !!tokenStore.get(),
    onlineCount: (s) => s.clients.filter((c) => s.presence[c.id]).length,
  },

  actions: {
    async login(payload) {
      const data = await api.login(payload);
      tokenStore.set(data.token);
      this.user = data.user;
      return data.user;
    },

    async register(payload) {
      const data = await api.register(payload);
      tokenStore.set(data.token);
      this.user = data.user;
      return data.user;
    },

    async fetchMe() {
      const data = await api.me();
      this.user = data.user;
      return data.user;
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
      if (this.socket) this.socket.emit('watch', { clientId });
    },

    unwatchClient(clientId) {
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
      tokenStore.clear();
      disconnectSocket();
      this.socket = null;
      this.socketReady = false;
      this.user = null;
      this.clients = [];
      this.presence = {};
    },
  },
});
