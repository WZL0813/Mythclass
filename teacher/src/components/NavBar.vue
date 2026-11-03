<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { playStarRevealThen } from '@/composables/starReveal';
import { currentBase, endpointCandidates, measureEndpoints, setEndpoint } from '@/api';

defineProps({ theme: { type: String, default: 'dark' } });
const emit = defineEmits(['toggle-theme']);

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();
const menuOpen = ref(false);

/* ---------------- 线路：点一下就能看到每条多少毫秒、手动切 ---------------- */
const lineOpen = ref(false);
const lines = ref([]);
const lineProbing = ref(false);
const lineCurrent = ref(currentBase());

function hostOf(base) {
  try {
    return new URL(base).host;
  } catch (_) {
    return base;
  }
}

function msText(row) {
  if (lineProbing.value) return '…';
  return row.ms === null || row.ms === undefined ? '不通' : `${row.ms} ms`;
}

async function probeLines() {
  lineProbing.value = true;
  try {
    lineCurrent.value = currentBase();
    // 先把要测的几条列出来，别让面板空着
    lines.value = endpointCandidates().map((base) => ({ base, ms: null }));
    lines.value = await measureEndpoints({ timeout: 3000 });
    lineCurrent.value = currentBase();
  } finally {
    lineProbing.value = false;
  }
}

function toggleLines() {
  lineOpen.value = !lineOpen.value;
  if (lineOpen.value) {
    menuOpen.value = false;
    probeLines();
  }
}

function useLine(row) {
  if (!row || row.base === currentBase() || row.ms === null || row.ms === undefined) return;
  setEndpoint(row.base, { manual: true });
  window.location.reload();
}

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
  // 走导航 = 离开那套新样子，回来还是原来的控制台
  ui.setLook(false);
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

/**
 * 「新界面」：就在控制台这一页里换个样子（功能一模一样，还是教师端自己发命令）。
 * 地址栏一个字不动；按钮自己会变成「旧界面」，再点一下回来。
 * 老地址 /localwebui?clientId=1 还留着，那是走服务器中转的那套。
 */
const onDashboard = computed(() => route.name === 'dashboard');
const lookLabel = computed(() => (ui.newLook ? '旧界面' : '新界面'));

function toggleLook() {
  if (!onDashboard.value) return;
  ui.toggleLook();
}

function goRegister() {
  playStarRevealThen(() => router.push('/register'), '', { plain: true });
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

        <!-- 新界面：同一个控制台换个新样子，地址栏不动；再点一下回旧的 -->
        <button
          v-if="loggedIn && onDashboard"
          class="btn small ghost lan-btn"
          :title="ui.newLook ? '回到原来的那个界面' : '换个新样子（功能一样，还是本机直连那套）'"
          @click="toggleLook"
        >
          <iconify-icon icon="ph:monitor-duotone" width="15" />
          {{ lookLabel }}
        </button>

        <template v-if="!loggedIn">
          <button class="btn small ghost" @click="go('/login')">登录</button>
          <button class="btn small primary" @click="goRegister">注册</button>
        </template>

        <template v-else>
          <!-- 线路：在账号设置右边。点开能看每条延迟，也能手动切 -->
          <div class="line-wrap">
            <button
              class="icon-btn"
              :title="'网络线路：' + hostOf(currentBase())"
              @click="toggleLines"
            >
              <iconify-icon icon="ph:wifi-high"></iconify-icon>
            </button>
            <div v-if="lineOpen" class="line-menu">
              <p class="line-title">网络线路</p>
              <p class="line-sub">
                {{ lineProbing ? '正在测…' : '延迟最短的会先用；也可以手动切' }}
              </p>
              <ul class="line-list">
                <li v-for="row in lines" :key="row.base" :class="{ on: row.base === lineCurrent }">
                  <span class="l-host mono">{{ hostOf(row.base) }}</span>
                  <span class="l-ms mono">{{ msText(row) }}</span>
                  <span v-if="row.base === lineCurrent" class="l-tag">在用</span>
                  <button
                    v-else
                    class="l-go"
                    :disabled="lineProbing || row.ms === null || row.ms === undefined"
                    @click="useLine(row)"
                  >切</button>
                </li>
              </ul>
              <button class="line-re" :disabled="lineProbing" @click="probeLines">
                {{ lineProbing ? '测着呢…' : '重新测延迟' }}
              </button>
            </div>
          </div>

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
  /* 线路那个小面板：贴在按钮下面，窄一点，别挡住控制台 */
  .line-wrap { position: relative; }
  .line-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    z-index: 70;
    width: 302px;
    padding: 12px;
    border: 1px solid rgba(143, 168, 142, 0.28);
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(20, 29, 23, 0.98), rgba(11, 17, 13, 0.98));
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  }
  .line-title { margin: 0 0 2px; font-size: 13.5px; color: #dbe8dd; }
  .line-sub { margin: 0 0 10px; font-size: 11.5px; color: var(--sage); }
  .line-list { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 6px; }
  .line-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid rgba(143, 168, 142, 0.18);
    border-radius: 9px;
    font-size: 12px;
  }
  .line-list li.on { border-color: rgba(143, 168, 142, 0.5); background: rgba(63, 107, 82, 0.26); }
  .l-host { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .l-ms { color: #9fd0ac; min-width: 56px; text-align: right; }
  .l-tag { font-size: 11px; color: #9fd0ac; }
  .l-go {
    padding: 2px 8px;
    border: 1px solid rgba(143, 168, 142, 0.3);
    border-radius: 7px;
    background: transparent;
    color: var(--sage);
    font-size: 11.5px;
    cursor: pointer;
  }
  .l-go:hover:not(:disabled) { background: rgba(63, 107, 82, 0.3); color: #eaf4ec; }
  .l-go:disabled { opacity: 0.4; cursor: default; }
  .line-re {
    width: 100%;
    padding: 7px;
    border: 1px solid rgba(143, 168, 142, 0.3);
    border-radius: 9px;
    background: transparent;
    color: var(--sage);
    font-size: 12px;
    cursor: pointer;
  }
  .line-re:hover:not(:disabled) { background: rgba(63, 107, 82, 0.26); }

  /* 局域网界面那个按钮：跟旁边的小控件对齐 */
  .lan-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: 6px;
  }
  /* 还没选机器的时候不让点：点了也没东西可连，提示写在 title 里 */
  .lan-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

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
