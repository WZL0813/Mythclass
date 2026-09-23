<script setup>
import { onMounted, ref } from 'vue';
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

onMounted(async () => {
  try {
    const s = await api.registrationStatus();
    open.value = s.open;
  } catch (_) {
    open.value = true; // 问不到就让他试，服务端还会再拦一次
  } finally {
    checking.value = false;
  }
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

        <button class="btn primary wide" type="submit" :disabled="loading">
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

@media (max-width: 860px) {
  .auth-card { transform: none; }
}
</style>
