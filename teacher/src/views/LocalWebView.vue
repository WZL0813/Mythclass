<script setup>
/**
 * 老地址：/localwebui?clientId=1
 *
 * 主人说了：这个地址留着（会用的人自己敲），但教师端不再摆按钮指向它。
 * 平时切界面用的是控制台里那个「新界面」按钮 —— 那套地址栏不动，
 * 走的是同一个组件（LanConsole），所以两边永远一模一样。
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LanConsole from '@/components/LanConsole.vue';

const route = useRoute();
const router = useRouter();

const clientId = computed(() => Number(route.query.clientId || 0) || 0);

function back() {
  router.push('/dashboard');
}
</script>

<template>
  <LanConsole :client-id="clientId" @back="back" />
</template>
