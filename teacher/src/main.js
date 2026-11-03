import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';

import App from './App.vue';
import router from './router';
import { resolveEndpoint } from './api';
import './style.css';

/**
 * 先把线路挑好再开渲染：主站、英国、意大利、Cloudflare 四条，
 * 谁先答应用谁；挑不到就照常起来，让页面自己去报错。
 */
(async () => {
  try {
    await resolveEndpoint({ timeout: 3500 });
  } catch (_) {
    /* 挑不到就先用打包时写死的那条 */
  }

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(ElementPlus);
  app.mount('#app');
})();
