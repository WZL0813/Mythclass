<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { api, APP_NAME, currentBase, measureEndpoints, setEndpoint } from '@/api';

const router = useRouter();
const auth = useAuthStore();

// 线路测速：每次进页面测一遍，点按钮也能重测
const lines = ref([]);
const probing = ref(false);
const switching = ref(false);
const currentEndpoint = ref(currentBase());

function hostOf(base) {
  try {
    return new URL(base).host;
  } catch (_) {
    return base;
  }
}

function msText(row) {
  if (probing.value) return '…';
  return row.ms === null ? '不通' : `${row.ms} ms`;
}

async function probeLines() {
  probing.value = true;
  try {
    lines.value = await measureEndpoints({ timeout: 3000 });
    currentEndpoint.value = currentBase();
  } finally {
    probing.value = false;
  }
}

async function useLine(row) {
  switching.value = true;
  try {
    setEndpoint(row.base);
    window.location.reload();
  } finally {
    switching.value = false;
  }
}

const form = ref({ oldPassword: '', newPassword: '', confirm: '' });
const busy = ref(false);
const clientCount = ref(null);

const user = computed(() => auth.user || {});
const joined = computed(() => (user.value.createdAt ? String(user.value.createdAt).slice(0, 10) : '—'));
const lastLogin = computed(() => (user.value.lastLoginAt ? String(user.value.lastLoginAt).replace('T', ' ').slice(0, 16) : '—'));

// ---- 改用户名 / 改邮箱 ----
// 服务端把用户名和邮箱当唯一键，重名会返回 409，这儿不用自己先查一遍
const profile = ref({ username: '', email: '' });
const savingProfile = ref(false);

function resetProfile() {
  profile.value = { username: user.value.username || '', email: user.value.email || '' };
}

const profileDirty = computed(() => {
  const name = profile.value.username.trim();
  const mail = profile.value.email.trim().toLowerCase();
  return name !== (user.value.username || '') || mail !== (user.value.email || '').toLowerCase();
});

async function saveProfile() {
  const name = profile.value.username.trim();
  const mail = profile.value.email.trim();

  if (name.length < 3) return ElMessage.warning('用户名至少 3 位。');
  if (name.length > 32) return ElMessage.warning('用户名最多 32 位。');
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return ElMessage.warning('邮箱格式看着不对。');
  if (!profileDirty.value) return ElMessage.info('还没改什么呢。');

  savingProfile.value = true;
  try {
    const data = await api.updateProfile({ username: name, email: mail });
    auth.user = data.user; // 直接换上，导航栏的名字跟着变
    resetProfile();
    ElMessage.success('资料改好了。');
  } catch (err) {
    ElMessage.error(err.message); // 重名之类，服务端说得比自己清楚
  } finally {
    savingProfile.value = false;
  }
  return undefined;
}

onMounted(async () => {
  if (!auth.user) await auth.restore();
  resetProfile();
  try {
    await auth.fetchClients();
    clientCount.value = auth.clients.length;
  } catch (_) {
    clientCount.value = null; // 拿不到就不显示，别报错吓人
  }
  // 顺手把四条线路的延迟量一遍
  probeLines();
});

async function changePassword() {
  const f = form.value;
  if (!f.oldPassword || !f.newPassword) {
    ElMessage.warning('原密码和新密码都得填。');
    return;
  }
  if (f.newPassword.length < 6) {
    ElMessage.warning('新密码至少 6 位。');
    return;
  }
  if (f.newPassword !== f.confirm) {
    ElMessage.warning('两次输入的新密码不一样。');
    return;
  }

  busy.value = true;
  try {
    await api.changePassword({ oldPassword: f.oldPassword, newPassword: f.newPassword });
    // 服务端会把所有旧凭证一次性作废，所以这边必须重新登录
    ElMessage.success('密码换好了，请用新密码重新登录。');
    auth.logout();
    router.push('/login');
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    busy.value = false;
  }
}

async function logout() {
  try {
    await ElMessageBox.confirm('退出后要重新登录才能看机器。', '确定退出？', {
      confirmButtonText: '退出',
      cancelButtonText: '算了',
      type: 'warning',
    });
  } catch (_) {
    return;
  }
  auth.logout();
  router.push('/');
}
</script>

<template>
  <div class="account wrap">
    <header class="head reveal">
      <p class="eyebrow">账号设置</p>
      <h1>{{ auth.displayName }}</h1>
      <p class="muted">账号在服务端。这儿改资料、改密码，也能看你绑了几台机器。</p>
    </header>

    <section class="card profile">
      <h2>改资料</h2>
      <p class="muted">用户名和邮箱随时能改。改完照旧登录，不用重新登一次。</p>
      <!-- novalidate：不加的话，email 框里填了非法值时浏览器会自己拦下提交，
           我们自己的中文提示永远轮不到显示 -->
      <form class="profile-form" novalidate @submit.prevent="saveProfile">
        <div class="field">
          <label>用户名（3-32 位）</label>
          <input v-model.trim="profile.username" autocomplete="username" />
        </div>
        <div class="field">
          <label>邮箱（可留空）</label>
          <input v-model.trim="profile.email" type="email" autocomplete="email" placeholder="找回密码时会用" />
        </div>
        <button class="btn primary" type="submit" :disabled="savingProfile || !profileDirty">
          <iconify-icon icon="ph:floppy-disk"></iconify-icon>{{ savingProfile ? '正在保存…' : '保存' }}
        </button>
      </form>
    </section>

    <div class="cols">
      <section class="card">
        <h2>账号信息</h2>
        <div class="kv">
          <div><span>用户名</span><span>{{ user.username || '—' }}</span></div>
          <div><span>邮箱</span><span>{{ user.email || '没填' }}</span></div>
          <div><span>注册时间</span><span>{{ joined }}</span></div>
          <div><span>上次登录</span><span>{{ lastLogin }}</span></div>
          <div><span>绑定的机器</span><span>{{ clientCount === null ? '读取中…' : clientCount + ' 台' }}</span></div>
        </div>
        <button class="btn" @click="router.push('/dashboard')">
          <iconify-icon icon="ph:monitor"></iconify-icon>去控制台
        </button>
      </section>

      <section class="card">
        <h2>改密码</h2>
        <p class="muted">改完所有设备都要重新登录一次，这是服务端的规矩。</p>
        <form @submit.prevent="changePassword">
          <div class="field">
            <label>原密码</label>
            <input v-model="form.oldPassword" type="password" autocomplete="current-password" />
          </div>
          <div class="field">
            <label>新密码（至少 6 位）</label>
            <input v-model="form.newPassword" type="password" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>再输一遍</label>
            <input v-model="form.confirm" type="password" autocomplete="new-password" />
          </div>
          <button class="btn primary" type="submit" :disabled="busy">
            <iconify-icon icon="ph:key"></iconify-icon>{{ busy ? '正在提交…' : '换密码' }}
          </button>
        </form>
      </section>
    </div>

    <section class="card">
      <h2>网络线路</h2>
      <p class="muted tiny">
        官方四条：主站 / 英国 / 意大利 / Cloudflare。开页面时自动挑延迟最短的那条，
        断了也会自己换。下面可以手动再测一遍。
      </p>
      <ul class="lines">
        <li v-for="row in lines" :key="row.base" :class="{ on: row.base === currentEndpoint }">
          <span class="dot"></span>
          <span class="host mono">{{ hostOf(row.base) }}</span>
          <span class="ms mono">{{ msText(row) }}</span>
          <span v-if="row.base === currentEndpoint" class="tag">正在用</span>
          <button v-else class="btn small" :disabled="row.ms === null || switching" @click="useLine(row)">
            切到这条
          </button>
        </li>
      </ul>
      <div class="row" style="margin-top: 12px">
        <button class="btn small" :disabled="probing" @click="probeLines">
          {{ probing ? '测着呢…' : '重新测延迟' }}
        </button>
      </div>
    </section>

    <section class="card">
      <h2>其它</h2>
      <div class="kv">
        <div><span>教师端</span><span>{{ APP_NAME }}</span></div>
        <div><span>当前服务端</span><span class="mono">{{ currentBase() || '同源部署' }}</span></div>
      </div>
      <button class="btn danger" @click="logout">
        <iconify-icon icon="ph:sign-out"></iconify-icon>退出登录
      </button>
    </section>
  </div>
</template>

<style scoped>
.account { padding: 48px 0 20px; }
/* 线路那几张：谁在用它标出来，延迟一眼看清 */
.lines { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 8px; }
.lines li {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border: 1px solid rgba(143, 168, 142, 0.22); border-radius: 12px;
  background: rgba(12, 18, 14, 0.55); font-size: 13px;
}
.lines li.on { border-color: rgba(143, 168, 142, 0.55); background: rgba(63, 107, 82, 0.28); }
.lines .dot { width: 8px; height: 8px; border-radius: 50%; background: #6f8a70; flex: 0 0 auto; }
.lines li.on .dot { background: #9fd0ac; box-shadow: 0 0 8px rgba(159, 208, 172, 0.7); }
.lines .host { flex: 1 1 auto; }
.lines .ms { color: #9fd0ac; min-width: 68px; text-align: right; }
.lines .tag { font-size: 11.5px; color: #9fd0ac; }
.head { margin-bottom: 26px; }
.head h1 { font-size: clamp(24px, 3vw, 34px); margin-bottom: 8px; }
.cols { display: grid; grid-template-columns: 1fr 1.1fr; gap: 16px; margin-bottom: 16px; }
.profile { margin-bottom: 16px; }
.profile-form {
  display: grid;
  grid-template-columns: 1fr 1.2fr auto;
  align-items: end;
  gap: 14px;
}
.profile-form .btn { height: 42px; white-space: nowrap; }
@media (max-width: 780px) {
  .profile-form { grid-template-columns: 1fr; }
}
.card { margin-bottom: 0; }
.card h2 { font-size: 18px; margin-bottom: 12px; }
.kv { display: grid; gap: 10px; margin-bottom: 16px; }
.kv div {
  display: flex; justify-content: space-between; gap: 14px;
  font-size: 13.6px; border-bottom: 1px dashed var(--line); padding-bottom: 8px;
}
.kv span:first-child { color: var(--sage); }
form { display: grid; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
@media (max-width: 900px) {
  .cols { grid-template-columns: 1fr; }
}
</style>
