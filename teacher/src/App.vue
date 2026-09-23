<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from '@/components/NavBar.vue';
import FooterBar from '@/components/FooterBar.vue';
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
  <div class="app-shell">
    <NavBar :theme="theme" @toggle-theme="applyTheme(theme === 'dark' ? 'light' : 'dark')" />

    <main :class="['app-main', { 'is-dashboard': route.name === 'dashboard' }]">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>

    <FooterBar v-if="route.name !== 'dashboard'" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.app-main {
  flex: 1;
  padding-top: 68px;
}
.app-main.is-dashboard {
  padding-top: 62px;
}
</style>
