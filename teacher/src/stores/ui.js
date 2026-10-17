import { defineStore } from 'pinia';

/**
 * 控制台要不要用「新界面」
 *
 * 主人定的：新界面**不套局域网那页**（不走服务器中转），
 * 功能和控制台本身一样（都是教师端自己发命令、自己收画面），
 * 只是换个新样子；再点一下回到旧界面。
 *
 * 所以这里只记一个开关，地址栏一个字都不动 —— 不换路由。
 * 老地址 /localwebui?clientId=1 还留着，那是走中转的那套，给会用的人自己敲。
 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    // 选了哪套界面记在本地：刷新、关掉重开都还是那一套
    newLook: localStorage.getItem('mythclass.dash.look') === 'new',
    // 现在选的是哪台机器：换个界面也得知道看的是谁
    clientId: Number(localStorage.getItem('mythclass.teacher.clientId') || 0) || 0,
  }),

  actions: {
    setLook(on) {
      this.newLook = !!on;
      try {
        localStorage.setItem('mythclass.dash.look', this.newLook ? 'new' : 'old');
      } catch (_) {
        /* 存不了就算了，只是下次要重新点一下 */
      }
    },

    toggleLook() {
      this.setLook(!this.newLook);
    },

    /** 控制台里选了哪台机器 */
    setClient(id) {
      const next = Number(id) || 0;
      this.clientId = next;
      try {
        if (next) localStorage.setItem('mythclass.teacher.clientId', String(next));
        else localStorage.removeItem('mythclass.teacher.clientId');
      } catch (_) {
        /* 存不了就算了，顶多刷新之后要重新选一台 */
      }
    },
  },
});
