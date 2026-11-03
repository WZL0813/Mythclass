<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from '@/components/NavBar.vue';
import FooterBar from '@/components/FooterBar.vue';
import StarReveal from '@/components/StarReveal.vue';
import { failoverIfDead } from '@/api';
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

const route = useRoute();
const auth = useAuthStore();
const theme = ref(localStorage.getItem('mythclass.theme') || 'dark');

function applyTheme(value) {
  theme.value = value;
  document.documentElement.dataset.theme = value;
  document.documentElement.classList.toggle('dark', value === 'dark');
  localStorage.setItem('mythclass.theme', value);
}

/**
 * 线路守夜：不管停在哪个页面，每 30 秒看一眼现在这条还活着没有。
 * 死了就换到最快的那条（换完刷新，页面状态干净）。
 * 控制台那边断线也会触发一次，这里是兜底 —— 比如正好停在账号设置页。
 */
let lineTimer = 0;

onMounted(async () => {
  applyTheme(theme.value);
  // 带着 token 刷新任何页面时，把用户信息补回来；
  // 不然导航栏只知道「有 token」，头像那里就是空的
  await auth.restore();

  lineTimer = setInterval(async () => {
    try {
      const switched = await failoverIfDead({ timeout: 2500, minGapMs: 30000 });
      if (switched) {
        try {
          sessionStorage.setItem('mythclass.teacher.switchedTo', switched);
        } catch (_) {
          /* 无所谓 */
        }
        window.location.reload();
      }
    } catch (_) {
      /* 测不到就算了，别影响正常用 */
    }
  }, 30000);
});

onBeforeUnmount(() => {
  if (lineTimer) clearInterval(lineTimer);
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
      <router-view v-slot="{ Component }">
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
