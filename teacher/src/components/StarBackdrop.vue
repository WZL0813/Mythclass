<script setup>
/**
 * 主控台背后的那片星野。
 * 跟登录过场同一套配色（米白 / 苔绿 / 琥珀），但只是慢慢漂 + 微弱闪，
 * 不抢戏、不吃 CPU —— 老师巡课时它就在后面安静待着。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  count: { type: Number, default: 200 },
  speed: { type: Number, default: 0.32 }, // 每秒漂多少像素
});

const canvas = ref(null);

const COLORS = ['#F3EFE7', '#F3EFE7', '#F3EFE7', '#CBE0C4', '#A8C6A1', '#E8B778'];

let ctx = null;
let raf = 0;
let stars = [];
let w = 0;
let h = 0;
let lastAt = 0;

function seed() {
  stars = Array.from({ length: props.count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    size: 0.5 + Math.random() * 1.5,
    drift: 0.35 + Math.random() * 0.9,
    twinkle: Math.random() * Math.PI * 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
}

function resize() {
  const el = canvas.value;
  if (!el) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  el.width = w * dpr;
  el.height = h * dpr;
  ctx = el.getContext('2d');
  ctx.scale(dpr, dpr);
  seed();
}

function frame(now) {
  const dt = lastAt ? Math.min((now - lastAt) / 1000, 0.05) : 0;
  lastAt = now;

  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  for (const s of stars) {
    s.y += props.speed * s.drift * dt * 60;
    s.x += props.speed * 0.25 * dt * 60;
    if (s.y > h + 4) {
      s.y = -4;
      s.x = Math.random() * w;
    }
    if (s.x > w + 4) s.x = -4;

    const alpha = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(now / 900 + s.twinkle));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  raf = requestAnimationFrame(frame);
}

onMounted(() => {
  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', resize);
});
</script>

<template>
  <div class="star-backdrop" aria-hidden="true">
    <canvas ref="canvas"></canvas>
  </div>
</template>

<style scoped>
.star-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 90% at 18% 0%, rgba(52, 74, 60, 0.5), transparent 62%),
    radial-gradient(90% 70% at 88% 12%, rgba(84, 66, 34, 0.34), transparent 60%),
    var(--ink);
}
canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
