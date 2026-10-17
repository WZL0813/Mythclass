<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from '@/components/NavBar.vue';
import FooterBar from '@/components/FooterBar.vue';
import LanConsole from '@/components/LanConsole.vue';
import StarReveal from '@/components/StarReveal.vue';
import {
  closeStarReveal,
  pageVeiled,
  revealActive,
  revealLocal,
  revealPlain,
  revealText,
  unveilPage,
} from '@/composables/starReveal';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

const route = useRoute();
const auth = useAuthStore();
const ui = useUiStore();
const theme = ref(localStorage.getItem('mythclass.theme') || 'dark');

// 「新界面」：就在控制台这一页里把内容换成局域网控制台。
// 地址栏一个字不动 —— 所以这里是 v-if，不是换路由。
const lanInline = computed(() => ui.lanMode && route.name === 'dashboard');

function applyTheme(value) {
  theme.value = value;
  document.documentElement.dataset.theme = value;
  document.documentElement.classList.toggle('dark', value === 'dark');
  localStorage.setItem('mythclass.theme', value);
}

onMounted(async () => {
  applyTheme(theme.value);
  // 带着 token 刷新任何页面时，把用户信息补回来；
  // 不然导航栏只知道「有 token」，头像那里就是空的
  await auth.restore();
});
</script>

<template>
  <div class="app-shell" :class="{ veiled: pageVeiled }">
    <NavBar
      v-if="!route.meta.fullscreen"
      :theme="theme"
      @toggle-theme="applyTheme(theme === 'dark' ? 'light' : 'dark')"
    />

    <main
      :class="[
        'app-main',
        { 'is-dashboard': route.name === 'dashboard', 'is-full': route.meta.fullscreen },
      ]"
    >
      <LanConsole v-if="lanInline" :client-id="ui.clientId" inline />
      <router-view v-else v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>

    <FooterBar v-if="route.name !== 'dashboard' && !route.meta.fullscreen" />

    <!-- 登录成功那一下的星光汇聚。
         必须 teleport 到 body：.app-shell 隐身时是 opacity:0，
         opacity 会让**所有后代跟着透明**，挂在里面星幕就白画了。 -->
    <Teleport to="body">
      <StarReveal
          v-if="revealActive"
          :text="revealText"
          :plain="revealPlain"
          :local="revealLocal"
          @unveil="unveilPage"
          @closed="closeStarReveal"
        />
    </Teleport>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  transition: opacity 0.6s ease;
}
/* 星幕在的时候整页透明：页面其实已经铺好了，只是还没显形 */
.app-shell.veiled {
  opacity: 0;
  pointer-events: none;
}
.app-main {
  flex: 1;
  padding-top: 68px;
}
.app-main.is-dashboard {
  padding-top: 62px;
}
/* 导航栏收起来时，顶上那 62px 也一起省掉（这才叫真省空间） */
html.nav-tucked .app-main,
html.nav-tucked .app-main.is-dashboard {
  padding-top: 0;
}
</style>
