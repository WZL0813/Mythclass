<script setup>
const repo = 'https://github.com/WZL0813/Mythclass';

const docs = [
  { icon: 'ph:cloud-arrow-up', title: '部署教程：EdgeOne 与 Cloudflare Tunnel', file: 'docs/部署教程-EdgeOne与CloudflareTunnel.md', desc: '服务端、教师端、客户端三头怎么摆。' },
  { icon: 'ph:desktop', title: '客户端安装与自启', file: 'docs/客户端安装与自启.md', desc: '打包、注册服务、防关掉。' },
  { icon: 'ph:chalkboard-teacher', title: '教师端使用说明', file: 'docs/教师端使用说明.md', desc: '绑定、看屏幕、发命令。' },
  { icon: 'ph:shield-check', title: 'Admin 后台使用说明', file: 'docs/Admin后台使用说明.md', desc: '初始化、管人、关注册。' },
  { icon: 'ph:plug', title: '通信协议', file: 'docs/通信协议.md', desc: '消息长什么样，事件怎么走。' },
];

const api = [
  ['GET', '/api/auth/registration-status', '注册开关状态'],
  ['POST', '/api/auth/login', '登录换 token'],
  ['GET', '/api/auth/clients', '我绑的机器'],
  ['POST', '/api/auth/bind', '绑定客户端'],
  ['GET', '/api/auth/clients/:id/file-logs', '文件记录'],
  ['POST', '/api/auth/clients/:id/command', '下发命令（兜底）'],
];
</script>

<template>
  <div class="docs wrap">
    <header class="head reveal">
      <p class="eyebrow">文档</p>
      <h1>想自己搭一套？照着做</h1>
      <p class="muted">所有文档都在仓库的 docs/ 里，改起来也方便。</p>
    </header>

    <section class="grid">
      <a v-for="d in docs" :key="d.file" class="doc-card" :href="`${repo}/blob/main/${encodeURIComponent(d.file)}`" target="_blank" rel="noreferrer">
        <iconify-icon :icon="d.icon"></iconify-icon>
        <h3>{{ d.title }}</h3>
        <p>{{ d.desc }}</p>
        <span class="mono path">{{ d.file }}</span>
      </a>
    </section>

    <section class="api-block card">
      <h2>教师端常用接口</h2>
      <p class="muted">服务端地址由 VITE_SERVER_URL 决定。留空就是同源。</p>
      <table>
        <thead><tr><th>方法</th><th>路径</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="row in api" :key="row[1]">
            <td class="mono">{{ row[0] }}</td>
            <td class="mono">{{ row[1] }}</td>
            <td>{{ row[2] }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted">完整的看 <a :href="`${repo}/blob/main/docs/通信协议.md`" target="_blank" rel="noreferrer">通信协议</a>。</p>
    </section>
  </div>
</template>

<style scoped>
.docs { padding: 56px 0 20px; }
.head { margin-bottom: 30px; }
.head h1 { font-size: clamp(26px, 3.4vw, 38px); margin-bottom: 10px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
.doc-card {
  display: block;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 20px;
  text-decoration: none;
  color: var(--text);
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s;
}
.doc-card:nth-child(2n) { transform: translateY(10px); }
.doc-card:hover { transform: translateY(-4px); border-color: rgba(143, 168, 142, 0.5); text-decoration: none; }
.doc-card iconify-icon { font-size: 23px; color: var(--amber); }
.doc-card h3 { font-size: 16px; margin: 11px 0 7px; }
.doc-card p { margin: 0 0 12px; font-size: 13.4px; color: var(--text-dim); line-height: 1.7; }
.path { font-size: 11.5px; color: var(--sage); word-break: break-all; }

.api-block { margin-top: 40px; }
.api-block h2 { font-size: 20px; margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13.4px; }
th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid var(--line); }
th { color: var(--sage); font-weight: 500; font-size: 12.4px; }

@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
  .doc-card:nth-child(2n) { transform: none; }
}
</style>
