<script setup>
import { computed } from 'vue';

/** 加载遮罩：给步骤和进度，别让人干等 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '正在准备' },
  steps: { type: Array, default: () => [] },
  step: { type: Number, default: 0 },
  patienceHint: { type: Boolean, default: false },
});

const percent = computed(() => {
  if (!props.steps.length) return 12;
  return Math.round(((props.step + 1) / props.steps.length) * 100);
});
</script>

<template>
  <div v-if="visible" class="overlay">
    <div class="box glass">
      <p class="eyebrow">Mythclass</p>
      <h3>{{ title }}</h3>

      <div class="bar"><span :style="{ width: percent + '%' }"></span></div>
      <p class="percent mono">{{ percent }}%</p>

      <ul class="steps">
        <li v-for="(s, i) in steps" :key="s" :class="{ done: i < step, now: i === step }">
          <iconify-icon :icon="i < step ? 'ph:check-circle' : i === step ? 'ph:circle-notch' : 'ph:circle'"></iconify-icon>
          <span>{{ s }}</span>
        </li>
      </ul>

      <p v-if="patienceHint" class="patience">网络有点慢，请耐心等待。它没卡死，只是在敲对面那台机器。</p>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--ink) 72%, transparent);
  backdrop-filter: blur(10px);
}
.box {
  width: min(430px, 90vw);
  padding: 30px 28px;
  transform: translateY(-4%);
}
.box h3 { margin: 0 0 18px; font-size: 20px; }
.bar {
  height: 7px;
  border-radius: 99px;
  background: rgba(243, 239, 227, 0.1);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--moss-2), var(--amber));
  transition: width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.percent { text-align: right; font-size: 12px; color: var(--sage); margin: 6px 0 18px; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 11px; }
.steps li { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--text-dim); }
.steps li iconify-icon { font-size: 17px; }
.steps li.done { color: var(--sage); }
.steps li.now { color: var(--text); font-weight: 600; }
.steps li.now iconify-icon { animation: spin 1.1s linear infinite; }
.patience { margin: 20px 0 0; font-size: 13px; color: var(--amber); line-height: 1.65; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
