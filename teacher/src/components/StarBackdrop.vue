<script setup>
/**
 * 主控台背后的星野：一部分星子组成「Mythclass」，另一部分随便漂。
 *
 * 和登录过场同一套做法（把字画到离屏 canvas 上扫墨点当目标），
 * 但这里是常驻背景：星星慢慢聚成字、之后低亮度呼吸，
 * 让主控台一直留着那个由星光拼出来的 Mythclass。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  text: { type: String, default: 'Mythclass' },
  shapeCount: { type: Number, default: 700 }, // 组成字的星子
  freeCount: { type: Number, default: 130 }, // 到处漂的星子
  speed: { type: Number, default: 0.3 },
});

const canvas = ref(null);

// 米白为主，掺一点苔绿和琥珀
const COLORS = ['#F3EFE7', '#F3EFE7', '#F3EFE7', '#CBE0C4', '#A8C6A1', '#E8B778'];

let ctx = null;
let raf = 0;
let stars = [];
let free = [];
let w = 0;
let h = 0;
let startedAt = 0;
let lastAt = 0;

function measureTargets() {
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');

  const size = Math.min(w * 0.115, h * 0.2, 168);
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
  const stride = Math.max(4, Math.round(size / 30));
  const points = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      if (data[(y * w + x) * 4 + 3] > 130) points.push([x, y]);
    }
  }

  const wanted = Math.min(props.shapeCount, points.length);
  if (!wanted) return [];
  const step = points.length / wanted;
  const picked = [];
  for (let i = 0; i < wanted; i += 1) picked.push(points[Math.floor(i * step)]);
  return picked;
}

function seed() {
  const targets = measureTargets();

  stars = targets.map(([tx, ty]) => ({
    tx,
    ty,
    x: Math.random() * w,
    y: Math.random() * h,
    size: 0.6 + Math.random() * 1.1,
    delay: Math.random() * 0.4,
    twinkle: Math.random() * Math.PI * 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  free = Array.from({ length: props.freeCount }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    size: 0.5 + Math.random() * 1.4,
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
  const t = now - startedAt;

  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  // 到处漂的那些
  for (const s of free) {
    s.y += props.speed * s.drift * dt * 60;
    s.x += props.speed * 0.25 * dt * 60;
    if (s.y > h + 4) {
      s.y = -4;
      s.x = Math.random() * w;
    }
    if (s.x > w + 4) s.x = -4;

    ctx.globalAlpha = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(now / 1100 + s.twinkle));
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // 组成字的那些：2.2 秒内聚拢，之后原地低亮度呼吸
  const gatherMs = 2200;
  for (const s of stars) {
    const span = 1 - s.delay || 1;
    const local = Math.min(1, Math.max(0, t / gatherMs - s.delay) / span);
    const ease = 1 - (1 - local) ** 3;
    const jitter = (1 - ease) * 5;
    const px = s.x + (s.tx - s.x) * ease + Math.sin(now / 130 + s.twinkle) * jitter;
    const py = s.y + (s.ty - s.y) * ease + Math.cos(now / 150 + s.twinkle) * jitter;

    const breathe = 0.3 + 0.16 * Math.sin(now / 700 + s.twinkle);
    ctx.globalAlpha = Math.max(0, Math.min(1, breathe * (0.35 + 0.65 * ease)));
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(px, py, s.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  raf = requestAnimationFrame(frame);
}

onMounted(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  try {
    await document.fonts.ready;
  } catch (_) {
    /* 拿不到就算了 */
  }
  resize();
  window.addEventListener('resize', resize);
  startedAt = performance.now();
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
