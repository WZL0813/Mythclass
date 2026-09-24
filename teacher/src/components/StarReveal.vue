<script setup>
/**
 * 星光汇聚：满屏星子先乱闪，再各自飞向「Mythclass」笔画上的采样点，
 * 汇成字以后停一下，最后整块淡出，露出下面已经铺好的页面。
 *
 * 做法：把字画到离屏 canvas 上，按步长扫像素拿到「墨点」坐标当目标；
 * 每个星子从屏幕外/四周随机出发，缓动飞过去；加色混合出光晕。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  text: { type: String, default: 'Mythclass' },
  starsFor: { type: Number, default: 850 }, // 先乱闪多久
  gatherFor: { type: Number, default: 1750 }, // 汇聚用时
  holdFor: { type: Number, default: 900 }, // 汇成后停多久
  fadeFor: { type: Number, default: 700 }, // 星幕自身淡出用时
});

const emit = defineEmits(['unveil', 'closed']);

const canvas = ref(null);
const leaving = ref(false);

// 米白为主，掺一点苔绿和琥珀；不用紫蓝
const PALETTE = ['#F3EFE7', '#F3EFE7', '#F3EFE7', '#CBE0C4', '#A8C6A1', '#E8B778'];
const MAX_STARS = 2600;

let ctx = null;
let raf = 0;
let stars = [];
let w = 0;
let h = 0;
let startedAt = 0;
let phase = 'gather';
let timings = { stars: 0, gather: 1, hold: 1 };
const timers = [];

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}

/** 把字采样成墨点坐标 */
function measureTargets() {
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');

  const size = Math.min(w * 0.155, h * 0.26, 216);
  octx.fillStyle = '#fff';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.font = `700 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
  try {
    octx.letterSpacing = `${Math.round(size * 0.05)}px`;
  } catch (_) {
    /* 老浏览器不认就算了 */
  }
  octx.fillText(props.text, w / 2, h / 2);

  const data = octx.getImageData(0, 0, w, h).data;
  const stride = Math.max(3, Math.round(size / 44));
  const points = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      if (data[(y * w + x) * 4 + 3] > 130) points.push([x, y]);
    }
  }

  // 太多就均匀抽稀，免得卡
  if (points.length <= MAX_STARS) return points;
  const step = points.length / MAX_STARS;
  const picked = [];
  for (let i = 0; i < MAX_STARS; i += 1) picked.push(points[Math.floor(i * step)]);
  return picked;
}

function seed() {
  const targets = measureTargets();

  stars = targets.map(([tx, ty]) => {
    // 起点撒在画面外的四周，看着像是从外面飘进来
    const roll = Math.random();
    let sx;
    let sy;
    if (roll < 0.5) {
      sx = Math.random() * w;
      sy = Math.random() < 0.5 ? -30 - Math.random() * h * 0.25 : h + 30 + Math.random() * h * 0.25;
    } else if (roll < 0.75) {
      sx = -30 - Math.random() * w * 0.25;
      sy = Math.random() * h;
    } else {
      sx = w + 30 + Math.random() * w * 0.25;
      sy = Math.random() * h;
    }

    return {
      tx,
      ty,
      sx,
      sy,
      size: 0.7 + Math.random() * 1.5,
      delay: Math.random() * 0.24,
      twinkle: Math.random() * Math.PI * 2,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    };
  });
}

function draw(now) {
  const t = now - startedAt;
  const starsEnd = timings.stars;
  const gatherEnd = starsEnd + timings.gather;

  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  for (const s of stars) {
    let px;
    let py;
    let alpha;
    let size = s.size;

    if (t < starsEnd) {
      // 第一段：满屏乱闪
      px = s.sx + Math.sin(t / 900 + s.twinkle) * 26;
      py = s.sy + Math.cos(t / 1100 + s.twinkle) * 22;
      alpha = 0.22 + 0.4 * (0.5 + 0.5 * Math.sin(t / 260 + s.twinkle));
      size = s.size * 0.85;
    } else if (t < gatherEnd) {
      // 第二段：往自己的位置飞
      const span = 1 - s.delay || 1;
      const local = Math.min(1, Math.max(0, (t - starsEnd) / timings.gather - s.delay) / span);
      const ease = 1 - (1 - local) ** 3;
      const jitter = (1 - ease) * 6;
      px = s.sx + (s.tx - s.sx) * ease + Math.sin(t / 120 + s.twinkle) * jitter;
      py = s.sy + (s.ty - s.sy) * ease + Math.cos(t / 140 + s.twinkle) * jitter;
      alpha = 0.3 + 0.7 * local;
    } else {
      // 第三段：落位，轻轻呼吸
      px = s.tx;
      py = s.ty;
      alpha = 0.8 + 0.2 * Math.sin(t / 420 + s.twinkle);
      size = s.size * (1 + 0.22 * Math.sin(t / 380 + s.twinkle));
    }

    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(0.2, size), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function tick(now) {
  draw(now);

  const total = timings.stars + timings.gather + timings.hold;
  if (phase === 'gather' && now - startedAt >= total) {
    phase = 'leaving';
    leaving.value = true; // 星幕自己淡出
    emit('unveil'); // 页面同时由淡到正常
    later(() => emit('closed'), props.fadeFor + 80);
  }

  raf = requestAnimationFrame(tick);
}

onMounted(async () => {
  const el = canvas.value;

  // 等一帧再量：刚挂上时样式还没落地，量到的是没铺开的尺寸
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));

  // 直接按视口量：这个层是铺满窗口的，别去猜布局什么时候稳定
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = Math.floor(window.innerWidth || el.clientWidth);
  h = Math.floor(window.innerHeight || el.clientHeight);
  el.width = w * dpr;
  el.height = h * dpr;
  ctx = el.getContext('2d');
  ctx.scale(dpr, dpr);

  // 系统里设了「减少动态效果」就快放，别折腾人
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const k = calm ? 0.25 : 1;
  timings = {
    stars: props.starsFor * k,
    gather: props.gatherFor * k,
    hold: props.holdFor * k,
  };

  // 等字体就位再采样，不然量到的是替身字体的形状
  try {
    await document.fonts.ready;
  } catch (_) {
    /* 拿不到就算了 */
  }

  seed();
  startedAt = performance.now();
  raf = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  timers.forEach(clearTimeout);
});
</script>

<template>
  <div class="star-reveal" :class="{ leaving }" aria-hidden="true">
    <canvas ref="canvas"></canvas>
  </div>
</template>

<style scoped>
.star-reveal {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: #0a0f0c;
  opacity: 1;
  transition: opacity 0.7s ease;
}
.star-reveal.leaving {
  opacity: 0;
}
canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
