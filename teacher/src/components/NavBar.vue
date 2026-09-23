<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { OFFICIAL_SERVER } from '@/api';

defineProps({ theme: { type: String, default: 'dark' } });
const emit = defineEmits(['toggle-theme']);

const router = useRouter();
const auth = useAuthStore();
const menuOpen = ref(false);

const links = [
  { label: '首页', to: '/' },
  { label: '功能', to: '/#features' },
  { label: '文档', to: '/docs' },
  { label: '关于', to: '/about' },
];

const loggedIn = computed(() => auth.isLoggedIn && !!auth.user);

function go(to) {
  menuOpen.value = false;
  if (to.includes('#')) {
    const [path, hash] = to.split('#');
    router.push(path || '/').then(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else {
    router.push(to);
  }
}

function logout() {
  menuOpen.value = false;
  auth.logout();
  router.push('/');
}
</script>

<template>
  <header class="nav">
    <div class="nav-inner">
      <button class="logo" @click="go('/')">
        <img class="mark" src="/logo-mark.png" alt="Mythclass" />
        <span class="word">Mythclass</span>
      </button>

      <nav class="links">
        <button v-for="l in links" :key="l.to" @click="go(l.to)">{{ l.label }}</button>
        <a href="https://github.com/WZL0813/Mythclass" target="_blank" rel="noreferrer">GitHub</a>
      </nav>

      <div class="right">
        <button class="icon-btn" :title="theme === 'dark' ? '换成浅色' : '换成深色'" @click="emit('toggle-theme')">
          <iconify-icon :icon="theme === 'dark' ? 'ph:sun' : 'ph:moon-stars'"></iconify-icon>
        </button>

        <template v-if="!loggedIn">
          <button class="btn small ghost" @click="go('/login')">登录</button>
          <button class="btn small primary" @click="go('/register')">注册</button>
        </template>

        <template v-else>
          <button class="btn small primary" @click="go('/dashboard')">进入控制台</button>
          <div class="avatar-wrap">
            <button class="avatar" @click="menuOpen = !menuOpen">{{ auth.user.username.slice(0, 1).toUpperCase() }}</button>
            <div v-if="menuOpen" class="menu">
              <p class="who">{{ auth.user.username }}</p>
              <button @click="go('/dashboard')">控制台</button>
              <button @click="go('/dashboard')">账号设置</button>
              <button class="danger" @click="logout">退出登录</button>
            </div>
          </div>
        </template>
      </div>
    </div>
    <p class="server-line mono">{{ OFFICIAL_SERVER }}</p>
  </header>
</template>

<style scoped>
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--ink) 78%, transparent);
  backdrop-filter: blur(16px);
}
.nav-inner {
  width: min(1180px, 92vw);
  margin: 0 auto;
  height: 62px;
  display: flex;
  align-items: center;
  gap: 22px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 9px;
  background: none;
  border: 0;
  color: var(--text);
  cursor: pointer;
  padding: 0;
}
.mark {
  width: 26px;
  height: 26px;
  display: block;
  border-radius: 8px;
  object-fit: contain;
}
.word { font-weight: 700; letter-spacing: 0.02em; }

.links { display: flex; gap: 4px; margin-left: 6px; }
.links button,
.links a {
  background: none;
  border: 0;
  color: var(--text-dim);
  font-size: 14px;
  padding: 8px 11px;
  border-radius: 9px;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.18s, background 0.18s;
}
.links button:hover,
.links a:hover { color: var(--text); background: rgba(243, 239, 227, 0.07); }

.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.icon-btn {
  width: 34px; height: 34px;
  display: grid; place-items: center;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 17px;
}
.icon-btn:hover { background: rgba(243, 239, 227, 0.08); }

.avatar-wrap { position: relative; }
.avatar {
  width: 34px; height: 34px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: linear-gradient(135deg, var(--moss-2), var(--moss));
  color: #f4fbef;
  font-weight: 600;
  cursor: pointer;
}
.menu {
  position: absolute;
  right: 0;
  top: 44px;
  min-width: 168px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--ink-soft);
  padding: 8px;
  display: grid;
  gap: 2px;
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.34);
}
.menu .who { margin: 4px 8px 8px; font-size: 13px; color: var(--text-dim); }
.menu button {
  text-align: left;
  background: none;
  border: 0;
  color: var(--text);
  padding: 9px 10px;
  border-radius: 9px;
  font-size: 14px;
  cursor: pointer;
}
.menu button:hover { background: rgba(243, 239, 227, 0.08); }
.menu button.danger { color: #eaa79b; }

.server-line {
  margin: 0;
  padding: 0 0 6px;
  text-align: center;
  font-size: 11px;
  color: var(--sage);
  opacity: 0.7;
}

@media (max-width: 860px) {
  .links { display: none; }
  .server-line { display: none; }
}
</style>
