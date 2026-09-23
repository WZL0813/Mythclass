<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import LoadingOverlay from '@/components/LoadingOverlay.vue';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const form = ref({ username: '', password: '' });
const loading = ref(false);
const step = ref(0);
const patience = ref(false);
const error = ref('');

const steps = ['正在登录…', '正在连接服务器…', '正在寻找客户端…'];

async function submit() {
  if (!form.value.username || !form.value.password) {
    error.value = '账号和密码都得填。';
    return;
  }
  error.value = '';
  loading.value = true;
  step.value = 0;
  patience.value = false;

  const patienceTimer = setTimeout(() => (patience.value = true), 10000);

  try {
    const user = await auth.login({ username: form.value.username, password: form.value.password });

    step.value = 1;
    await new Promise((r) => setTimeout(r, 320));

    step.value = 2;
    try {
      await auth.fetchClients();
    } catch (_) {
      /* 拿不到列表不算登录失败 */
    }
    await new Promise((r) => setTimeout(r, 260));

    ElMessage.success(`欢迎回来，${user.username}`);
    router.push(route.query.redirect || '/dashboard');
  } catch (err) {
    error.value = err.message;
    loading.value = false;
  } finally {
    clearTimeout(patienceTimer);
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card glass reveal">
      <img class="brand-logo" src="/logo.png" alt="Mythclass" />
      <p class="eyebrow">若思班级 · 教师端</p>
      <h1>登录</h1>
      <p class="muted">账号在服务端，这儿只存 token。</p>

      <form @submit.prevent="submit">
        <div class="field">
          <label>用户名 / 邮箱</label>
          <input v-model.trim="form.username" autocomplete="username" placeholder="例如 teacher" />
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="form.password" type="password" autocomplete="current-password" placeholder="至少 6 位" />
        </div>

        <p v-if="error" class="err">{{ error }}</p>

        <button class="btn primary wide" type="submit" :disabled="loading">
          <iconify-icon icon="ph:sign-in"></iconify-icon>进去
        </button>
      </form>

      <p class="foot">
        还没账号？
        <router-link to="/register">去注册</router-link>
        <span class="sep">·</span>
        <router-link to="/">回首页</router-link>
      </p>
    </div>

    <LoadingOverlay :visible="loading" title="正在进门" :steps="steps" :step="step" :patience-hint="patience" />
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
  width: min(430px, 100%);
  padding: 34px 32px 28px;
  /* 不居中，故意往左偏一点 */
  transform: translateX(-4%);
}
.auth-card h1 { font-size: 27px; margin-bottom: 8px; }
.brand-logo { width: 78px; height: 78px; border-radius: 18px; display: block; margin-bottom: 16px; }
form { margin-top: 22px; }
.wide { width: 100%; justify-content: center; margin-top: 6px; }
.err { color: #eaa79b; font-size: 13.5px; margin: 0 0 12px; }
.foot { margin: 20px 0 0; font-size: 13.5px; color: var(--text-dim); }
.sep { margin: 0 8px; opacity: 0.5; }

@media (max-width: 860px) {
  .auth-card { transform: none; }
}
</style>
