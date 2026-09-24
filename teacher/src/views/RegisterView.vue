<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api';
import LoadingOverlay from '@/components/LoadingOverlay.vue';

const router = useRouter();
const auth = useAuthStore();

const form = ref({ username: '', email: '', password: '', confirm: '' });
const loading = ref(false);
const step = ref(0);
const patience = ref(false);
const error = ref('');
const open = ref(true);
const checking = ref(true);

const steps = ['正在提交注册…', '正在创建账号…', '正在连接服务器…'];

// ------------------------------------------------------------------
// 彩蛋：整块表单盖住，只留一个四字输入框
//
// 错 3 次：框里强制填上「世界」（锁住，删不掉，只能往后补）
// 再错 6 次（共 9）：锁住的部分变成「世界和」
// 再错 2 次（共 11）：框右上角给个叉号，不想玩就退出
// 补全「世界和平」：按钮变灰 → 成就图从右上角划进来 → 停 3 秒 → 划回去
// ------------------------------------------------------------------
const ANSWER = '世界和平';
const HINT_TWO_AT = 3;
const HINT_THREE_AT = 9;
const CLOSE_AT = 11;

const gateOpen = ref(true);
const lockedPart = ref('');   // 被强制填进去、不能改的那截
const typedPart = ref('');    // 自己补的那截
const gateValue = ref('');    // 框里真实内容 = 锁住的那截 + 自己补的
const wrongCount = ref(0);
const gateShake = ref(false);
const solved = ref(false);
const achievement = ref(false);
const gateInput = ref(null);
const timers = [];

const gateHint = computed(() => {
  if (wrongCount.value >= HINT_THREE_AT) return '世界和';
  if (wrongCount.value >= HINT_TWO_AT) return '世界';
  return '';
});
const showClose = computed(() => wrongCount.value >= CLOSE_AT);

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}

function caretToEnd() {
  const el = gateInput.value;
  if (!el) return;
  el.focus();
  const n = el.value.length;
  try {
    el.setSelectionRange(n, n);
  } catch (_) {
    /* 某些情况下不支持，忽略 */
  }
}

/** 把「锁住的 + 自己补的」写回框里，并把光标放末尾 */
function syncGate() {
  gateValue.value = (lockedPart.value + typedPart.value).slice(0, 4);
  nextTick(caretToEnd);
}

/**
 * 输入时守住那截锁住的字。
 * 前缀还在 → 只认后面的部分；前缀被动过 → 这次编辑整个作废。
 */
function onGateInput() {
  const raw = gateValue.value;
  if (!lockedPart.value) {
    typedPart.value = raw.slice(0, 4);
    return;
  }
  if (raw.startsWith(lockedPart.value)) {
    typedPart.value = raw.slice(lockedPart.value.length).slice(0, 4 - lockedPart.value.length);
    return;
  }
  // 有人删/改了锁住的那截 —— 撤销这次改动
  gateValue.value = lockedPart.value + typedPart.value;
  nextTick(caretToEnd);
}

/** 提示出现时，把那几个字强制填进框里 */
function applyHint() {
  const hint = gateHint.value;
  if (hint === lockedPart.value) return;
  lockedPart.value = hint;
  typedPart.value = '';
  syncGate();
}

function tryGate() {
  if (solved.value) return;

  if (gateValue.value === ANSWER) {
    solved.value = true;
    achievement.value = true;                        // 从右往左划进来
    later(() => (achievement.value = false), 3600);   // 停 3 秒左右，再划回去
    later(() => {
      gateOpen.value = false;                        // 覆盖层消失，露出注册界面
      solved.value = false;
      wrongCount.value = 0;
      lockedPart.value = '';
      typedPart.value = '';
      syncGate();
    }, 4400);
    return;
  }

  wrongCount.value += 1;
  typedPart.value = '';
  applyHint();
  syncGate();
  gateShake.value = true;
  later(() => (gateShake.value = false), 420);
}

function closeGate() {
  gateOpen.value = false;
  wrongCount.value = 0;
  lockedPart.value = '';
  typedPart.value = '';
  syncGate();
}

/**
 * 回车交卷。
 * 显式拦下来自己处理，别指望表单的隐式提交（行为不稳，还会和按钮点两次）。
 * isComposing：中文输入法正在选字时按回车是「确认候选」，不能当交卷。
 */
function onGateEnter(event) {
  if (event.isComposing) return;
  event.preventDefault();
  tryGate();
}

onMounted(async () => {
  try {
    const s = await api.registrationStatus();
    open.value = s.open;
  } catch (_) {
    open.value = true; // 问不到就让他试，服务端还会再拦一次
  } finally {
    checking.value = false;
  }
  later(caretToEnd, 150);
});

onBeforeUnmount(() => {
  timers.forEach(clearTimeout);
});

async function submit() {
  // 覆盖层还盖着的时候，这个按钮是在「许愿」，不是在建号
  if (gateOpen.value) return tryGate();

  const f = form.value;
  if (!f.username || !f.password) return (error.value = '用户名和密码都得填。');
  if (f.username.length < 3) return (error.value = '用户名至少 3 位。');
  if (f.password.length < 6) return (error.value = '密码至少 6 位。');
  if (f.password !== f.confirm) return (error.value = '两次密码不一样，再对一遍。');

  error.value = '';
  loading.value = true;
  step.value = 0;
  patience.value = false;
  const timer = setTimeout(() => (patience.value = true), 10000);

  try {
    await new Promise((r) => setTimeout(r, 260));
    const user = await auth.register(f);
    step.value = 1;
    await new Promise((r) => setTimeout(r, 300));
    step.value = 2;
    await auth.fetchClients().catch(() => {});
    ElMessage.success(`注册好了，${user.username}`);
    router.push('/dashboard');
  } catch (err) {
    error.value = err.message;
    loading.value = false;
  } finally {
    clearTimeout(timer);
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card glass reveal">
      <img class="brand-logo" src="/logo.png" alt="Mythclass" />
      <p class="eyebrow">若思班级 · 教师端</p>
      <h1>注册</h1>

      <p v-if="!checking && !open" class="closed">
        <iconify-icon icon="ph:lock-simple"></iconify-icon>
        注册已关闭。想要账号，联系管理员。
      </p>

      <form v-else @submit.prevent="submit">
        <div class="gate-zone">
          <!-- 正常表单：覆盖层在的时候整块藏起来 -->
          <div class="form-body" :class="{ veiled: gateOpen }" aria-hidden="gateOpen">
            <p class="muted lead">建好号，回头把一体机绑上来就行。</p>
            <div class="field">
              <label>用户名</label>
              <input v-model.trim="form.username" autocomplete="username" placeholder="3-32 位，中英文都行" />
            </div>
            <div class="field">
              <label>邮箱（可留空）</label>
              <input v-model.trim="form.email" type="email" autocomplete="email" placeholder="找回密码时会用" />
            </div>
            <div class="field">
              <label>密码</label>
              <input v-model="form.password" type="password" autocomplete="new-password" placeholder="至少 6 位" />
            </div>
            <div class="field">
              <label>再输一遍</label>
              <input v-model="form.confirm" type="password" autocomplete="new-password" />
            </div>
            <p v-if="error" class="err">{{ error }}</p>
          </div>

          <!-- 覆盖层：整块盖住，只留一个独立的四字框 -->
          <transition name="gate">
            <div v-if="gateOpen" class="gate">
              <button v-if="showClose" class="gate-x" type="button" title="不玩了" @click.stop="closeGate">
                <iconify-icon icon="ph:x-bold"></iconify-icon>
              </button>
              <input
                ref="gateInput"
                v-model="gateValue"
                class="gate-input"
                :class="{ shake: gateShake }"
                maxlength="4"
                autocomplete="off"
                spellcheck="false"
                aria-label="四个字"
                @input="onGateInput"
                @keydown.enter="onGateEnter"
              />
            </div>
          </transition>
        </div>

        <button class="btn primary wide" type="submit" :disabled="loading || solved">
          <iconify-icon :icon="gateOpen ? 'ph:sparkle' : 'ph:user-plus'"></iconify-icon>
          {{ gateOpen ? '愿望' : '建号' }}
        </button>
      </form>

      <p class="foot">
        已经有账号了？
        <router-link to="/login">去登录</router-link>
        <span class="sep">·</span>
        <router-link to="/">回首页</router-link>
      </p>
    </div>

    <LoadingOverlay :visible="loading" title="正在建号" :steps="steps" :step="step" :patience-hint="patience" />

    <!-- 成就：从右上角划进来，停一会儿，再划回屏幕外 -->
    <transition name="toast">
      <img
        v-if="achievement"
        class="achievement"
        src="/achievement-world-peace.png"
        alt="获得成就：世界和平"
      />
    </transition>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: calc(100vh - 68px);
  display: grid;
  place-items: center;
  padding: 46px 20px;
}
.auth-card {
  width: min(460px, 100%);
  padding: 34px 32px 28px;
  transform: translateX(-4%);
}
.auth-card h1 { font-size: 27px; margin-bottom: 8px; }
.brand-logo { width: 78px; height: 78px; border-radius: 18px; display: block; margin-bottom: 16px; }
form { margin-top: 20px; }
.wide { width: 100%; justify-content: center; margin-top: 14px; }
.btn.primary:disabled {
  background: rgba(122, 132, 126, 0.55);
  color: rgba(255, 255, 255, 0.62);
}
.lead { margin: 0 0 18px; }
.err { color: #eaa79b; font-size: 13.5px; margin: 0 0 12px; }
.closed {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 20px 0 6px;
  padding: 14px 16px;
  border: 1px dashed rgba(201, 123, 60, 0.5);
  border-radius: 13px;
  color: var(--amber);
  font-size: 14px;
}
.foot { margin: 20px 0 0; font-size: 13.5px; color: var(--text-dim); }
.sep { margin: 0 8px; opacity: 0.5; }

/* ---------------- 覆盖层 ---------------- */
.gate-zone { position: relative; }

.form-body { transition: opacity 0.2s ease; }
.form-body.veiled {
  opacity: 0;
  pointer-events: none;
  user-select: none;
}

.gate {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: radial-gradient(120% 100% at 50% 0%, rgba(24, 34, 28, 0.96), rgba(9, 14, 11, 0.98));
  border: 1px dashed rgba(148, 196, 160, 0.26);
}
.gate-x {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.07);
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.gate-x:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
.gate-input {
  width: min(232px, 84%);
  padding: 12px 8px 12px 18px;
  text-align: center;
  font-size: 27px;
  letter-spacing: 10px;
  border-radius: 13px;
  border: 1px solid rgba(148, 196, 160, 0.42);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
  caret-color: var(--sage);
}
.gate-input:focus { outline: none; border-color: var(--sage); }
.shake { animation: gate-shake 0.4s; }
@keyframes gate-shake {
  0%, 100% { transform: translateX(0); }
  18% { transform: translateX(-7px); }
  38% { transform: translateX(7px); }
  58% { transform: translateX(-4px); }
  78% { transform: translateX(4px); }
}

.gate-enter-active,
.gate-leave-active { transition: opacity 0.26s ease, transform 0.26s ease; }
.gate-enter-from,
.gate-leave-to { opacity: 0; transform: scale(0.98); }

/* ---------------- 成就图 ---------------- */
.achievement {
  position: fixed;
  top: 82px;
  right: 18px;
  width: 320px;
  max-width: 78vw;
  z-index: 60;
  pointer-events: none;
  image-rendering: pixelated;
  filter: drop-shadow(0 12px 26px rgba(0, 0, 0, 0.5));
}
.toast-enter-active { transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s; }
.toast-leave-active { transition: transform 0.6s cubic-bezier(0.4, 0, 0.7, 0.2), opacity 0.35s; }
.toast-enter-from,
.toast-leave-to { transform: translateX(118%); opacity: 0; }

@media (max-width: 860px) {
  .auth-card { transform: none; }
}
</style>
