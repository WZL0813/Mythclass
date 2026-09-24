/**
 * 顶部消息：自己画，因为要控制「往上顶」的堆叠方向。
 *
 * 想要的效果（从下往上看）：
 *   最下面一条 = 最新的一条，完整显示，位置就是平时单条消息出现的地方
 *   往上半条   = 上一条，被容器上沿裁掉一半
 *   再往上     = 更早的，整个被顶出顶部边界，看不见
 *
 * 所以容器高度固定成「一条半」，用 flex-direction: column + justify-content: flex-end
 * 把内容压在底部：新消息加进来会把旧的往上推，超出的部分被 overflow: hidden 裁掉。
 */

const HOST_ID = 'myth-toasts';
const MAX_ALIVE = 2; // 同时最多两条（视觉上就一条半）
const MAX_QUEUE = 3; // 排队也别攒多，不然一崩就是一串
const MIN_GAP_MS = 700; // 两条之间至少隔这么久，防止一次事件风暴糊满屏
const DEDUPE_MS = 4000; // 同样的话 4 秒内只弹一次

const ICONS = {
  success: 'ph:check-circle',
  warning: 'ph:warning',
  error: 'ph:x-circle',
  info: 'ph:info',
};

let host = null;

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
  }
  return host;
}

function dismiss(el) {
  if (!el || el.dataset.leaving === '1') return;
  el.dataset.leaving = '1';
  el.classList.remove('in');
  el.classList.add('out');
  setTimeout(() => el.remove(), 260);
}

function spawn(kind, message, duration) {
  const box = ensureHost();
  const el = document.createElement('div');
  el.className = `myth-toast myth-toast--${kind}`;

  const icon = document.createElement('iconify-icon');
  icon.setAttribute('icon', ICONS[kind] || ICONS.info);
  const text = document.createElement('span');
  text.className = 'myth-toast__text';
  text.textContent = message;

  el.append(icon, text);
  box.appendChild(el);

  // 先挂上去再加 .in，才有入场动画
  requestAnimationFrame(() => el.classList.add('in'));

  const timer = setTimeout(() => dismiss(el), duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss(el);
  });

  // 留够看就行，更早的直接扔掉（反正已经被顶出去了）
  while (box.children.length > MAX_ALIVE) dismiss(box.firstElementChild);
}

const queue = [];
const recent = new Map(); // 文案 -> 上次弹的时间
let lastSpawnAt = 0;

function drain() {
  while (queue.length && ensureHost().querySelectorAll('.myth-toast:not(.out)').length < MAX_ALIVE) {
    const item = queue.shift();
    spawn(item.kind, item.message, item.duration);
  }
}

function push(kind, message, duration = 2600) {
  const text = String(message ?? '').trim();
  if (!text) return;

  // 同样的话短时间内只弹一次
  const now = Date.now();
  const seen = recent.get(text) || 0;
  if (now - seen < DEDUPE_MS) return;
  // 还排着队的也别重复塞
  if (queue.some((q) => q.message === text)) return;

  recent.set(text, now);
  if (recent.size > 40) {
    for (const [key, at] of recent) {
      if (now - at > DEDUPE_MS) recent.delete(key);
    }
  }

  queue.push({ kind, message: text, duration });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);

  // 节流：两条之间至少隔 MIN_GAP_MS，事件风暴时不会糊满屏
  const wait = Math.max(0, MIN_GAP_MS - (now - lastSpawnAt));
  if (wait > 0) {
    setTimeout(() => {
      lastSpawnAt = Date.now();
      drain();
    }, wait);
  } else {
    lastSpawnAt = now;
    drain();
  }
  setTimeout(drain, duration + 320);
}

export const toast = {
  success: (message, duration) => push('success', message, duration),
  warning: (message, duration) => push('warning', message, duration),
  error: (message, duration) => push('error', message, duration),
  info: (message, duration) => push('info', message, duration),
};

export default toast;
