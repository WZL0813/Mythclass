<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from '@/components/NavBar.vue';
import FooterBar from '@/components/FooterBar.vue';

const route = useRoute();
const theme = ref(localStorage.getItem('mythclass.theme') || 'dark');

function applyTheme(value) {
  theme.value = value;
  document.documentElement.dataset.theme = value;
  document.documentElement.classList.toggle('dark', value === 'dark');
  localStorage.setItem('mythclass.theme', value);
}

onMounted(() => applyTheme(theme.value));
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
