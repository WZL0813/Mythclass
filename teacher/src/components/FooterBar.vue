<script setup>
const year = new Date().getFullYear();
const version = '1.0.0';
</script>

<template>
  <footer class="foot">
    <div class="wrap foot-inner">
      <div class="col brand-col">
        <p class="brand">Mythclass</p>
        <p class="muted">若思班级一体机管理系统</p>
        <p class="muted">不推门，也能巡课。</p>
      </div>

      <div class="col">
        <p class="head">项目</p>
        <a href="https://github.com/WZL0813/Mythclass" target="_blank" rel="noreferrer">GitHub 仓库</a>
        <router-link to="/docs">使用文档</router-link>
        <router-link to="/about">关于与合规</router-link>
      </div>

      <div class="col">
        <p class="head">相关</p>
        <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/" target="_blank" rel="noreferrer">Cloudflare Tunnel</a>
        <a href="https://edgeone.ai/document" target="_blank" rel="noreferrer">EdgeOne Pages</a>
        <a href="https://iconify.design" target="_blank" rel="noreferrer">Iconify 图标</a>
      </div>

      <div class="col version-col">
        <p class="head">版本</p>
        <p class="mono">v{{ version }}</p>
        <p class="muted">教师端 · 静态托管</p>
      </div>
    </div>

    <div class="wrap bottom">
      <span>© {{ year }} Ryokuryuneko. All rights reserved.</span>
      <span class="links">
        <router-link to="/about">隐私政策</router-link>
        <router-link to="/about">使用条款</router-link>
      </span>
    </div>
  </footer>
</template>

<style scoped>
.foot {
  margin-top: 72px;
  border-top: 1px solid var(--line);
  padding: 42px 0 26px;
  background: color-mix(in srgb, var(--ink) 55%, transparent);
}
.foot-inner {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 0.9fr;
  gap: 26px;
}
.brand { font-size: 19px; font-weight: 700; margin: 0 0 8px; }
.col { display: grid; gap: 8px; align-content: start; }
.col a, .col p { font-size: 13.5px; }
.col a { color: var(--text-dim); text-decoration: none; }
.col a:hover { color: var(--amber); }
.head { color: var(--sage); font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; margin: 0 0 2px; }
.muted { margin: 0; }
.bottom {
  margin-top: 34px;
  padding-top: 16px;
  border-top: 1px dashed var(--line);
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--text-dim);
}
.bottom .links { display: flex; gap: 16px; }
.bottom a { color: var(--text-dim); }

@media (max-width: 860px) {
  .foot-inner { grid-template-columns: 1fr 1fr; }
  .bottom { flex-direction: column; gap: 8px; }
}
</style>
