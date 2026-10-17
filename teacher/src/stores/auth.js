import { defineStore } from 'pinia';
import { api, tokenStore, connectSocket, disconnectSocket } from '@/api';

/**
 * 发出去的命令在等回执：requestId -> resolve
 *
 * 为什么需要：`socket.emit('command', ..., ack)` 那个 ack 只是**服务端**说
 * "我转给那台机器了"，命令真正的执行结果是从另一条路上回来的
 * （command_result）。以前 sendCommand 直接把那个 ack 当结果用，
 * 于是「使用时长 / 磁盘 / 窗口」这些页永远拿到空数据 —— 它们读到的是
 * `{ok: true, delivered: true}`，里面根本没有 output。
 */
const pendingCommands = new Map();
let cmdSeq = 0;

/**
 * 同一条回执可能来两遍：一条走 socket 中转（给正在看这台机器的页面），
 * 一条走 HTTP 回执（发给这个账号的所有页面）。两边内容一样，去个重，
 * 不然回执栏会一行变两行、通知回答的弹窗也会弹两次。
 */
const seenResults = new Map();
const RESULT_DEDUP_MS = 15000;

function resultKey(payload) {
  return [
    payload.requestId || '',
    payload.command || '',
    payload.ok ? 1 : 0,
    String(payload.output || '').slice(0, 160),
  ].join('|');
}

/**
 * 这条回执是不是被截断了？
 *
 * 客户端会把同一条结果发两遍：socket 那条是完整的，HTTP 那条服务端会截断。
 * 一旦截在 JSON 中间，页面 JSON.parse 出来就是空的 —— 表格看着像"没数据"。
 * 所以 HTTP 那份要是明显被截了，就先别用，等 socket 那份完整的来。
 */
function looksTruncated(payload) {
  const out = String(payload.output || '');
  if (out.length < 1500) return false; // 这么短的输出不可能被截
  if (!/^[[{]/.test(out)) return false; // 不是 JSON 就别瞎猜
  try {
    JSON.parse(out);
    return false;
  } catch (_) {
    return true;
  }
}

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

      socket.on('command_result', (payload) => {
        if (!payload) return;

        // HTTP 那条被截断的版本直接不要：等 socket 那份完整的
        if (payload.at && looksTruncated(payload)) return;

        // 去重：同一条回执从两条路上各来一次
        const key = resultKey(payload);
        const now = Date.now();
        for (const [k, at] of seenResults) {
          if (now - at > RESULT_DEDUP_MS) seenResults.delete(k);
        }
        if (seenResults.has(key)) return;
        seenResults.set(key, now);

        // 谁在等这条回执就把结果交给它（sendCommand 的 Promise）
        const wait = payload.requestId ? pendingCommands.get(payload.requestId) : null;
        if (wait) {
          pendingCommands.delete(payload.requestId);
          wait(payload);
        }

        if (onCommandResult) onCommandResult(payload);
      });

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
      cmdSeq += 1;
      const requestId = `t${Date.now().toString(36)}-${cmdSeq}`;
      return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          pendingCommands.delete(requestId);
          resolve(value);
        };
        // 命令真跑到那台机器上再回来，慢点也等它；等不到就当超时
        const timer = setTimeout(() => finish({ ok: false, error: 'TIMEOUT' }), 12000);
        pendingCommands.set(requestId, finish);
        this.socket.emit('command', { clientId, command, args, requestId }, (ack) => {
          // 这个 ack 只代表「服务端收下并转发了」；机器不在线才会是失败
          if (ack && ack.ok === false) finish({ ok: false, error: ack.error || 'OFFLINE' });
        });
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
