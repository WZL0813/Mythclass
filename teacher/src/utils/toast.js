/**
 * 顶部消息：最多同时露两条 —— 第一条完整，第二条只露上半截（看着就是「一条半」）。
 * 再多就排队，等前面走完才轮到它。
 *
 * 为什么不直接用 ElMessage：它会一直往下堆，连弹几条时最上面那条会被挤出屏幕。
 */
import { ElMessage } from 'element-plus';

const MAX_ALIVE = 2; // 同时活着几条（第二条靠 CSS 裁成半截）
const MAX_QUEUE = 6; // 排队上限，超了丢最老的，别攒一堆过时消息

const queue = [];
let alive = 0;

/** 第二条及以后只露上半截 */
function refreshPeek() {
  const nodes = [...document.querySelectorAll('.el-message')];
  nodes.forEach((el, index) => el.classList.toggle('toast-peek', index > 0));
}

function drain() {
  while (alive < MAX_ALIVE && queue.length) {
    const item = queue.shift();
    alive += 1;
    ElMessage({
      type: item.kind,
      message: item.message,
      duration: item.duration,
      grouping: false,
      offset: 78, // 从导航栏下面开始，别压住顶栏
      onClose: () => {
        alive -= 1;
        refreshPeek();
        drain();
      },
    });
    refreshPeek();
  }
}

function push(kind, message, duration = 2600) {
  const text = String(message ?? '').trim();
  if (!text) return;
  // 同样的内容还排着队就别重复塞
  if (queue.some((q) => q.kind === kind && q.message === text)) return;

  queue.push({ kind, message: text, duration });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  drain();
}

export const toast = {
  success: (message, duration) => push('success', message, duration),
  warning: (message, duration) => push('warning', message, duration),
  error: (message, duration) => push('error', message, duration),
  info: (message, duration) => push('info', message, duration),
};

export default toast;
