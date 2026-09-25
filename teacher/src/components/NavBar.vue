<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { playStarRevealThen } from '@/composables/starReveal';

defineProps({ theme: { type: String, default: 'dark' } });
const emit = defineEmits(['toggle-theme']);

const router = useRouter();
const auth = useAuthStore();
const menuOpen = ref(false);

// 导航栏收起来：省空间用。状态存本地，刷新后保持
const NAV_KEY = 'mythclass.nav.tucked';
const navTucked = ref(localStorage.getItem(NAV_KEY) === '1');
// 刷新后保持：挂载时把标记也补上
if (navTucked.value) {
  try {
    document.documentElement.classList.add('nav-tucked');
  } catch (_) {
    /* 无所谓 */
  }
}

function setTucked(value) {
  navTucked.value = value;
  // 顺便在 html 上标记一下，好让页面把顶上那 62px 也省掉
  try {
    document.documentElement.classList.toggle('nav-tucked', value);
  } catch (_) {
    /* 无所谓 */
  }
  try {
    localStorage.setItem(NAV_KEY, value ? '1' : '0');
  } catch (_) {
    /* 存不了就算了 */
  }
}

// 有 token 就算已登录。
// 之前还要求 user 存在，导致「带着 token 刷新首页」时导航栏又退回未登录的样子。
const loggedIn = computed(() => auth.isLoggedIn);

// 没登录看官网那一套；登录了就是干活的三个入口
const links = computed(() =>
  loggedIn.value
    ? [
        { label: '首页', to: '/' },
        { label: '控制台', to: '/dashboard' },
        { label: '账号设置', to: '/account' },
      ]
    : [
        { label: '首页', to: '/' },
        { label: '功能', to: '/#features' },
        { label: '文档', to: '/docs' },
        { label: '关于', to: '/about' },
      ]
);

function go(to) {
  menuOpen.value = false;
  // 进控制台也走一遍星光，和登录/注册一致
  if (to === '/dashboard') {
    playStarRevealThen(() => router.push('/dashboard'));
    return;
  }
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
  <header class="nav" :class="{ tucked: navTucked }">
    <!--
      收起来之后留个小把手。
      必须 Teleport 到 body —— 写在 header 里的话，header 收起时
      translateY(-100%) + opacity:0 会把它一起藏掉，那就再也拉不回来了。
    -->
    <Teleport to="body">
      <button
        v-if="navTucked"
        class="nav-handle"
        title="把导航栏拉回来"
        @click="setTucked(false)"
      >
        <iconify-icon icon="ph:caret-down"></iconify-icon>
      </button>
    </Teleport>
    <div class="nav-inner">
      <button class="logo" @click="go('/')">
        <img class="mark" src="/logo-mark.png" alt="Mythclass" />
        <span class="word">Mythclass</span>
      </button>

      <nav class="links">
        <button v-for="l in links" :key="l.to" @click="go(l.to)">{{ l.label }}</button>
        <a v-if="!loggedIn" href="https://github.com/WZL0813/Mythclass" target="_blank" rel="noreferrer">GitHub</a>
      </nav>

      <div class="right">
        <button class="icon-btn" title="收起导航栏（省点地方）" @click="setTucked(true)">
          <iconify-icon icon="ph:caret-double-up"></iconify-icon>
        </button>
        <button class="icon-btn" :title="theme === 'dark' ? '换成浅色' : '换成深色'" @click="emit('toggle-theme')">
          <iconify-icon :icon="theme === 'dark' ? 'ph:sun' : 'ph:moon-stars'"></iconify-icon>
        </button>

        <template v-if="!loggedIn">
          <button class="btn small ghost" @click="go('/login')">登录</button>
          <button class="btn small primary" @click="go('/register')">注册</button>
        </template>

        <template v-else>
          <div class="avatar-wrap">
            <button class="avatar" @click="menuOpen = !menuOpen">{{ auth.displayName.slice(0, 1).toUpperCase() }}</button>
            <div v-if="menuOpen" class="menu">
              <p class="who">{{ auth.displayName }}</p>
              <button @click="go('/dashboard')">控制台</button>
              <button @click="go('/account')">账号设置</button>
              <button @click="logout">退出登录</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </header>
</template>

<style scoped>
/* 收起来的导航栏：整条滑出屏幕上方 */
.nav.tucked {
  transform: translateY(-100%);
  opacity: 0;
  pointer-events: none;
}

/* 收起后留在屏幕顶部中间的小把手（只要图标）——
   不点它就找不回来了 */
.nav-handle {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;   /* 要压过仪表盘自己的层，不然点不到 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(143, 168, 142, 0.28);
  border-top: 0;
  border-radius: 0 0 10px 10px;
  border: 1px solid rgba(143, 168, 142, 0.28);
  background: color-mix(in srgb, var(--ink) 82%, transparent);
  color: #e8efe6;
  font-size: 12.5px;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.nav-handle:hover { border-color: rgba(94, 154, 115, 0.55); color: #c9e6d2; }

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

@media (max-width: 860px) {
  .links { display: none; }
  .server-line { display: none; }
}
</style>
