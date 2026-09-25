<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from '@/components/NavBar.vue';
import FooterBar from '@/components/FooterBar.vue';
import StarReveal from '@/components/StarReveal.vue';
import { closeStarReveal, pageVeiled, revealActive, unveilPage } from '@/composables/starReveal';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const auth = useAuthStore();
const theme = ref(localStorage.getItem('mythclass.theme') || 'dark');

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
    <NavBar :theme="theme" @toggle-theme="applyTheme(theme === 'dark' ? 'light' : 'dark')" />

    <main :class="['app-main', { 'is-dashboard': route.name === 'dashboard' }]">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>

    <FooterBar v-if="route.name !== 'dashboard'" />

    <!-- 登录成功那一下的星光汇聚。
         必须 teleport 到 body：.app-shell 隐身时是 opacity:0，
         opacity 会让**所有后代跟着透明**，挂在里面星幕就白画了。 -->
    <Teleport to="body">
      <StarReveal v-if="revealActive" text="Mythclass" @unveil="unveilPage" @closed="closeStarReveal" />
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
