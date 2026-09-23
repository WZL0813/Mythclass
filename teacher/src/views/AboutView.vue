<script setup>
const repo = 'https://github.com/WZL0813/Mythclass';

const points = [
  '只用于合法教学管理。',
  '学生知道、学校同意，才可以用。',
  '遵守《个人信息保护法》《网络安全法》。',
  '屏幕与控制数据不经第三方留存。',
  '隧道凭证、管理员令牌都不进 Git。',
];

const stack = [
  ['教师端', 'Vue3 · Vite · Pinia · Element Plus · TailwindCSS'],
  ['服务端', 'Node.js · Express · Socket.IO · SQLite · JWT'],
  ['客户端', 'Python 3.10+ · pystray · watchdog · pycaw · mss'],
  ['部署', 'EdgeOne Pages + Cloudflare Tunnel'],
];
</script>

<template>
  <div class="about wrap">
    <header class="head reveal">
      <p class="eyebrow">关于</p>
      <h1>Mythclass 若思班级一体机管理系统</h1>
      <p class="muted">教室一体机巡课与远程管理 · 不推门，也能巡课。</p>
    </header>

    <div class="cols">
      <section class="card">
        <h2>名字是这么来的</h2>
        <ul class="plain">
          <li><b>Ryokuryuneko</b> —— 开发者 / 工作室。</li>
          <li><b>Mythclass</b> —— Myth + Class。</li>
          <li><b>若思</b> —— 取 Ryo 的音「若」，配上 Myth 的「思」。</li>
          <li><b>班级一体机</b> —— 就是教室里那台大屏。</li>
        </ul>
      </section>

      <section class="card">
        <h2>技术栈</h2>
        <div class="kv">
          <div v-for="s in stack" :key="s[0]"><span>{{ s[0] }}</span><span>{{ s[1] }}</span></div>
        </div>
      </section>
    </div>

    <section class="card compliance">
      <h2>合规使用承诺</h2>
      <p class="muted">这套软件能看屏幕、能远控、能记文件。请认真读下面五条。</p>
      <ul class="plain">
        <li v-for="p in points" :key="p">
          <iconify-icon icon="ph:check-circle"></iconify-icon>{{ p }}
        </li>
      </ul>
      <p class="muted">
        随便用，出了事自己担。许可证是 AGPL-3.0：改过之后挂到网上给人用，
        得把改过的源码也开源出去。详见仓库里的 LICENSE。
      </p>
    </section>

    <section class="card">
      <h2>隐私政策与使用条款（摘要）</h2>
      <p class="muted">
        教师端只保存登录 token 与主题偏好，放在浏览器本地；服务端保存账号、绑定关系、以及客户端上报的文件与音频记录。
        这些数据都在你自己的服务器上，不上传任何第三方。删号即删绑定，客户端记录可在 Admin 后台随机器一起清掉。
        使用条款一句话：别拿它干坏事。
      </p>
      <p class="muted">完整条款随仓库更新，以 <a :href="repo" target="_blank" rel="noreferrer">GitHub 仓库</a> 为准。</p>
    </section>

    <p class="copyright">© 2025 Ryokuryuneko. All rights reserved.</p>
  </div>
</template>

<style scoped>
.about { padding: 56px 0 20px; }
.head { margin-bottom: 30px; }
.head h1 { font-size: clamp(24px, 3.2vw, 36px); margin-bottom: 10px; }
.cols { display: grid; grid-template-columns: 1.25fr 1fr; gap: 16px; margin-bottom: 16px; }
.card { margin-bottom: 16px; }
.card h2 { font-size: 18px; margin-bottom: 12px; }
.plain { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.plain li { font-size: 14px; color: var(--text-dim); line-height: 1.75; display: flex; gap: 9px; align-items: flex-start; }
.plain li iconify-icon { color: var(--moss-2); font-size: 17px; margin-top: 2px; }
.plain b { color: var(--text); }
.kv { display: grid; gap: 10px; }
.kv div { display: flex; justify-content: space-between; gap: 14px; border-bottom: 1px dashed var(--line); padding-bottom: 8px; font-size: 13.4px; }
.kv span:first-child { color: var(--sage); flex: 0 0 68px; }
.kv span:last-child { text-align: right; }
.copyright { text-align: center; font-size: 12.5px; color: var(--text-dim); margin: 34px 0 10px; }

@media (max-width: 900px) {
  .cols { grid-template-columns: 1fr; }
}
</style>
