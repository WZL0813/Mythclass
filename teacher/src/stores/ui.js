import { defineStore } from 'pinia';

/**
 * 控制台的两套界面：老的控制台 / 新的局域网控制台
 *
 * 为什么用状态切、不用路由切：
 * 主人要求点「新界面」时**地址栏不许变** —— 走路由就会变成
 * /localwebui?clientId=1，那不是"切界面"，那是"换页面"。
 *
 * 那条老地址 /localwebui?clientId=1 照样能用（有人会用就自己敲），
 * 只是教师端不再摆按钮指向它。
 */
const CLIENT_KEY = 'mythclass.teacher.clientId';

export const useUiStore = defineStore('ui', {
  state: () => ({
    lanMode: false,
    // 现在选的是哪台机器：切界面的时候要用它，刷新后也要记得
    clientId: Number(localStorage.getItem(CLIENT_KEY) || 0) || 0,
  }),

  actions: {
    setLan(on) {
      this.lanMode = !!on;
    },

    toggleLan() {
      this.lanMode = !this.lanMode;
    },

    /** 控制台里选了哪台机器 */
    setClient(id) {
      const next = Number(id) || 0;
      this.clientId = next;
      try {
        if (next) localStorage.setItem(CLIENT_KEY, String(next));
        else localStorage.removeItem(CLIENT_KEY);
      } catch (_) {
        /* 存不了就算了，顶多刷新之后要重新选一台 */
      }
    },
  },
});
