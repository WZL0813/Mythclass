<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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
// 彩蛋：盖在表单上的四字输入框
//
// 错 3 次给两个字，再错 6 次给三个字（都塞进输入框里当提示），
// 再错 2 次给个叉号让人能跑。答对「世界和平」就弹成就。
// ------------------------------------------------------------------
const ANSWER = '世界和平';
const HINT_TWO_AT = 3;   // 错够这么多次，框里出现「世界」
const HINT_THREE_AT = 9; // 再错这么多，变成「世界和」
const CLOSE_AT = 11;     // 再错两次，给个叉号

const gateOpen = ref(true);
const gateText = ref('');
const wrongCount = ref(0);
const gateShake = ref(false);
const solved = ref(false);       // 答对了：按钮变灰
const achievement = ref(false);  // 成就图滑进来了
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

function focusGate() {
  gateInput.value?.focus();
}

function tryGate() {
  if (solved.value) return;
  const value = gateText.value.trim();
  if (!value) return;

  if (value === ANSWER) {
    solved.value = true;
    gateText.value = '';
    achievement.value = true;                 // 从右往左划进来
    later(() => (achievement.value = false), 3600); // 停 3 秒左右，再划回去
    later(() => {
      gateOpen.value = false;                 // 覆盖层消失，露出注册界面
      solved.value = false;                   // 按钮恢复可用
      wrongCount.value = 0;
    }, 4400);
    return;
  }

  wrongCount.value += 1;
  gateText.value = '';
  gateShake.value = true;
  later(() => (gateShake.value = false), 420);
  focusGate();
}

function closeGate() {
  gateOpen.value = false;
  wrongCount.value = 0;
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
  // 进来就把光标放上去：这是要「先答个题」的
  later(focusGate, 120);
});

onBeforeUnmount(() => {
  timers.forEach(clearTimeout);
});

async function submit() {
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
      <p class="muted">建好号，回头把一体机绑上来就行。</p>

      <p v-if="!checking && !open" class="closed">
        <iconify-icon icon="ph:lock-simple"></iconify-icon>
        注册已关闭。想要账号，联系管理员。
      </p>

      <form v-else @submit.prevent="submit">
        <div class="fields">
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

          <transition name="gate">
            <div v-if="gateOpen" class="gate" @click="focusGate">
              <button v-if="showClose" class="gate-x" type="button" title="不玩了" @click.stop="closeGate">
                <iconify-icon icon="ph:x-bold"></iconify-icon>
              </button>
              <p class="gate-title">先答个题</p>
              <input
                ref="gateInput"
                v-model="gateText"
                class="gate-input"
                :class="{ shake: gateShake }"
                maxlength="4"
                :placeholder="gateHint || '四个字'"
                @keyup.enter="tryGate"
              />
              <p class="gate-sub">答对有奖励。不想答，点右上角。</p>
            </div>
          </transition>
        </div>

        <p v-if="error" class="err">{{ error }}</p>

        <button class="btn primary wide" type="submit" :disabled="loading || solved">
          <iconify-icon icon="ph:user-plus"></iconify-icon>建号
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
.wide { width: 100%; justify-content: center; margin-top: 6px; }
.btn.primary:disabled {
  background: rgba(122, 132, 126, 0.55);
  color: rgba(255, 255, 255, 0.62);
}
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

/* ---------------- 彩蛋：盖在输入框上的那一层 ---------------- */
.fields { position: relative; }

.gate {
  position: absolute;
  inset: -10px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px 18px;
  border-radius: 16px;
  background: rgba(11, 17, 14, 0.92);
  backdrop-filter: blur(7px);
  border: 1px dashed rgba(148, 196, 160, 0.32);
  cursor: text;
}
.gate-title { font-size: 15px; color: var(--sage); margin: 0; }
.gate-sub { font-size: 12.5px; color: var(--text-dim); margin: 0; }
.gate-x {
  position: absolute;
  top: 8px;
  right: 8px;
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
  width: min(230px, 100%);
  padding: 10px 6px 10px 22px;
  text-align: center;
  font-size: 26px;
  letter-spacing: 10px;
  border-radius: 12px;
  border: 1px solid rgba(148, 196, 160, 0.42);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
}
.gate-input:focus { outline: none; border-color: var(--sage); }
.gate-input::placeholder { color: rgba(148, 196, 160, 0.6); letter-spacing: 10px; }
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
