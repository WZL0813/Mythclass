<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { playStarRevealThen } from '@/composables/starReveal';
import quotes from '@/data/quotes.json';

const router = useRouter();

/* 每日一言：按日期取，手动换就往后跳一条 */
const dayIndex = Math.floor(Date.now() / 86400000) % quotes.quotes.length;
const quoteIndex = ref(dayIndex);
const quote = computed(() => quotes.quotes[quoteIndex.value]);
function nextQuote() {
  quoteIndex.value = (quoteIndex.value + 1) % quotes.quotes.length;
}

const features = [
  {
    icon: 'ph:monitor-play',
    title: '看屏幕',
    text: '一体机在干什么，一眼就看见。支持全屏和缩放。',
    span: 'wide',
  },
  { icon: 'ph:cursor-click', title: '能控制', text: '鼠标键盘直接发过去。点一下就到位。' },
  { icon: 'ph:speaker-high', title: '听声音', text: '谁在放音频、放什么、音量多大，全记着。' },
  { icon: 'ph:file-text', title: '留痕迹', text: '文件改没改，几秒几分都写清楚。' },
  { icon: 'ph:users-three', title: '多人用', text: '一个账号管多台机器。机器还能自己改名。' },
  { icon: 'ph:terminal-window', title: '发命令', text: '锁屏、关机、弹窗、开网页、发文件。' },
];

const faqs = [
  { q: '需要公网 IP 吗？', a: '不用。服务端在你自己电脑上，靠 Cloudflare Tunnel 出去。路由器一个端口都不用开。' },
  { q: '学生能关掉客户端吗？', a: '进程保护默认开着，被关掉会自己回来。任务管理器默认不禁，想要就去客户端设置里勾。' },
  { q: '同一间教室会不会卡？', a: '同一局域网优先走 P2P 直连，不经服务器。跨网才走中继。' },
  { q: '教师端放哪？', a: 'EdgeOne Pages 静态托管，国内访问没问题。构建配置仓库里都写好了。' },
  { q: '收费吗？', a: '开源，AGPL-3.0。服务器钱自己出。改了再拿出去给人用，源码也得开源。' },
  { q: '能看别的学校吗？', a: '不能。每个账号只看自己绑定的机器，绑定还要机器上的 ID。' },
];

const arch = [
  { step: '01', name: '教师端', detail: 'EdgeOne Pages 静态托管', tone: 'cream' },
  { step: '02', name: 'Cloudflare', detail: 'Tunnel 出站，不用公网 IP', tone: 'amber' },
  { step: '03', name: '服务端', detail: '自己电脑 localhost:3000', tone: 'moss' },
  { step: '04', name: '一体机', detail: '局域网优先 P2P 直连', tone: 'sage' },
];

function go(path) {
  // 进控制台先拉星幕，和登录/注册那套完全一致
  if (path === '/dashboard') {
    playStarRevealThen(() => router.push(path));
    return;
  }
  router.push(path);
}
</script>

<template>
  <div class="home">
    <!-- Hero：左边文案压住，右边给个浮动的机器卡，故意不等宽 -->
    <section class="hero wrap">
      <div class="hero-text reveal">
        <p class="eyebrow">教室一体机巡课与远程管理</p>
        <h1>Mythclass<br />若思班级一体机<br />管理系统</h1>
        <p class="slogan">不推门，也能巡课。</p>
        <p class="lede">
          一间教室一台机器。<br />
          老师坐着就能看、能说、能动手。<br />
          机器安静待着，只在托盘露个头。
        </p>
        <div class="hero-actions">
          <button class="btn primary" @click="go('/register')">
            <iconify-icon icon="ph:user-plus"></iconify-icon>注册一个账号
          </button>
          <button class="btn" @click="go('/login')">
            <iconify-icon icon="ph:sign-in"></iconify-icon>我已有账号
          </button>
          <a class="btn ghost" href="https://github.com/WZL0813/Mythclass" target="_blank" rel="noreferrer">
            <iconify-icon icon="ph:github-logo"></iconify-icon>看源码
          </a>
        </div>
      </div>

      <div class="hero-visual reveal">
        <div class="machine">
          <div class="bar">
            <span class="dot-live"></span>
            <span class="mono">MYTH-3F-A07</span>
            <span class="pill on">在线</span>
          </div>
          <div class="screen">
            <div class="screen-line w1"></div>
            <div class="screen-line w2"></div>
            <div class="screen-line w3"></div>
            <div class="screen-tag mono">屏幕流 1280×720 · 12 fps</div>
          </div>
          <div class="machine-foot">
            <span>高一(3)班一体机</span>
            <span class="mono">刚刚心跳</span>
          </div>
        </div>
        <div class="sticker">
          <iconify-icon icon="ph:bell-ringing"></iconify-icon>
          <span>有人动过文件<br /><b class="mono">14:32:08</b></span>
        </div>
      </div>
    </section>

    <!-- 每日一言 -->
    <section class="quote wrap">
      <div class="quote-card glass">
        <p class="eyebrow">今日一言</p>
        <p class="quote-text">{{ quote }}</p>
        <button class="btn small ghost" @click="nextQuote">
          <iconify-icon icon="ph:arrows-clockwise"></iconify-icon>换一句
        </button>
      </div>
    </section>

    <!-- 功能：故意做成不等宽，谁也别想对齐 -->
    <section id="features" class="features wrap">
      <header class="sec-head">
        <p class="eyebrow">能干什么</p>
        <h2>该有的都有，不该有的没有</h2>
      </header>

      <div class="feature-grid">
        <article
          v-for="f in features"
          :key="f.title"
          :class="['feature', f.span === 'wide' ? 'wide' : '']"
        >
          <iconify-icon :icon="f.icon"></iconify-icon>
          <h3>{{ f.title }}</h3>
          <p>{{ f.text }}</p>
        </article>
      </div>
    </section>

    <!-- 架构 -->
    <section class="arch wrap">
      <header class="sec-head">
        <p class="eyebrow">怎么跑起来的</p>
        <h2>四段路，全靠出站</h2>
        <p class="muted">路由器不用开端口。隧道是往外连的。</p>
      </header>

      <div class="arch-flow">
        <div v-for="(a, i) in arch" :key="a.step" :class="['arch-node', a.tone]">
          <p class="mono step">{{ a.step }}</p>
          <h3>{{ a.name }}</h3>
          <p>{{ a.detail }}</p>
          <iconify-icon v-if="i < arch.length - 1" class="arrow" icon="ph:arrow-right-bold"></iconify-icon>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="faq wrap">
      <header class="sec-head">
        <p class="eyebrow">常见问题</p>
        <h2>先替你把话问完</h2>
      </header>
      <div class="faq-grid">
        <details v-for="f in faqs" :key="f.q">
          <summary>{{ f.q }}</summary>
          <p>{{ f.a }}</p>
        </details>
      </div>
    </section>

    <!-- 收尾 -->
    <section class="cta wrap">
      <div class="cta-box">
        <div>
          <h2>先建个号，五分钟能跑通</h2>
          <p class="muted">服务端起在自己电脑上。客户端丢到一体机里就行。</p>
        </div>
        <div class="cta-btns">
          <button class="btn primary" @click="go('/register')">开始用</button>
          <router-link class="btn ghost" to="/docs">
            <iconify-icon icon="ph:book-open-text"></iconify-icon>看部署文档
          </router-link>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home { padding-bottom: 20px; }

/* ------------------------------- Hero ------------------------------- */
.hero {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 46px;
  align-items: center;
  padding: 62px 0 30px;
}
.hero-text h1 {
  font-size: clamp(30px, 4.4vw, 50px);
  line-height: 1.16;
  letter-spacing: -0.01em;
  margin-bottom: 16px;
}
.slogan {
  display: inline-block;
  font-size: 17px;
  color: var(--amber);
  border-left: 3px solid var(--amber);
  padding-left: 11px;
  margin: 0 0 18px;
}
.lede { color: var(--text-dim); line-height: 2; font-size: 15px; margin: 0 0 26px; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 11px; }

.hero-visual { position: relative; }
.machine {
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--surface);
  backdrop-filter: blur(14px);
  padding: 16px;
  transform: rotate(-1.2deg);
  box-shadow: 0 26px 60px rgba(0, 0, 0, 0.36);
  animation: floaty 7s ease-in-out infinite;
}
.machine .bar { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; font-size: 12.5px; color: var(--sage); }
.brand-mini { width: 18px; height: 18px; border-radius: 5px; display: block; }
.machine .bar .pill { margin-left: auto; }
.dot-live {
  width: 8px; height: 8px; border-radius: 50%; background: #7fc59a;
  box-shadow: 0 0 0 4px rgba(127, 197, 154, 0.2);
}
.screen {
  position: relative;
  height: 186px;
  border-radius: 13px;
  border: 1px solid var(--line);
  background:
    linear-gradient(150deg, rgba(63, 107, 82, 0.5), rgba(16, 22, 15, 0.9)),
    repeating-linear-gradient(0deg, rgba(243, 239, 227, 0.05) 0 1px, transparent 1px 4px);
  padding: 20px;
  display: grid;
  gap: 11px;
  align-content: start;
}
.screen-line { height: 9px; border-radius: 99px; background: rgba(243, 239, 227, 0.18); }
.w1 { width: 72%; }
.w2 { width: 48%; }
.w3 { width: 60%; }
.screen-tag { position: absolute; right: 12px; bottom: 10px; font-size: 11px; color: var(--sage); }
.machine-foot { display: flex; justify-content: space-between; margin-top: 12px; font-size: 12.5px; color: var(--text-dim); }

.sticker {
  position: absolute;
  left: -26px;
  bottom: -22px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 15px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--ink-soft);
  font-size: 12.5px;
  line-height: 1.5;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.34);
  transform: rotate(2.6deg);
}
.sticker iconify-icon { color: var(--amber); font-size: 19px; }

/* ------------------------------ 每日一言 ------------------------------ */
.quote { padding: 34px 0 8px; }
.quote-card {
  padding: 26px 30px;
  display: grid;
  gap: 10px;
  place-items: start;
  border-left: 4px solid var(--moss-2);
}
.quote-text { font-size: clamp(17px, 2.2vw, 23px); margin: 0; line-height: 1.6; }

/* ------------------------------- 功能 ------------------------------- */
.sec-head { margin: 0 0 22px; }
.sec-head h2 { font-size: clamp(22px, 2.8vw, 30px); margin-bottom: 8px; }
.features { padding: 62px 0 10px; }
.feature-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 15px;
}
.feature {
  grid-column: span 2;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 20px;
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.22s;
}
.feature:hover { transform: translateY(-4px); border-color: rgba(143, 168, 142, 0.5); }
.feature.wide { grid-column: span 3; }
.feature iconify-icon { font-size: 24px; color: var(--amber); }
.feature h3 { font-size: 16.5px; margin: 11px 0 7px; }
.feature p { margin: 0; font-size: 13.8px; color: var(--text-dim); line-height: 1.75; }

/* ------------------------------- 架构 ------------------------------- */
.arch { padding: 62px 0 10px; }
.arch-flow {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 13px;
}
.arch-node {
  position: relative;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 18px;
  background: var(--surface);
  /* 高度错开，别齐刷刷一排 */
}
.arch-node:nth-child(even) { margin-top: 22px; }
.arch-node .step { color: var(--sage); font-size: 12px; margin: 0 0 6px; letter-spacing: 0.2em; }
.arch-node h3 { font-size: 16px; margin: 0 0 6px; }
.arch-node p { margin: 0; font-size: 13.2px; color: var(--text-dim); line-height: 1.7; }
.arch-node.amber { border-color: rgba(201, 123, 60, 0.4); }
.arch-node.moss { border-color: rgba(63, 107, 82, 0.55); }
.arrow {
  position: absolute;
  right: -14px;
  top: 50%;
  color: var(--sage);
  font-size: 18px;
  z-index: 2;
}

/* ------------------------------- FAQ ------------------------------- */
.faq { padding: 62px 0 10px; }
.faq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
details {
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 15px 18px;
  background: var(--surface);
}
details[open] { border-color: rgba(143, 168, 142, 0.45); }
summary { cursor: pointer; font-size: 14.6px; font-weight: 600; list-style: none; }
summary::marker { content: ''; }
summary::before { content: '+'; color: var(--amber); margin-right: 9px; font-weight: 700; }
details[open] summary::before { content: '−'; }
details p { margin: 11px 0 0; font-size: 13.6px; color: var(--text-dim); line-height: 1.8; }

/* ------------------------------- CTA ------------------------------- */
.cta { padding: 62px 0 30px; }
.cta-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 30px 34px;
  background:
    linear-gradient(120deg, rgba(63, 107, 82, 0.42), rgba(201, 123, 60, 0.12)),
    var(--surface);
}
.cta-box h2 { font-size: clamp(20px, 2.4vw, 26px); margin-bottom: 8px; }
.cta-btns { display: flex; gap: 11px; flex-wrap: wrap; }

@media (max-width: 980px) {
  .hero { grid-template-columns: 1fr; gap: 40px; padding-top: 34px; }
  .feature-grid { grid-template-columns: 1fr 1fr; }
  .feature, .feature.wide { grid-column: span 1; }
  .arch-flow { grid-template-columns: 1fr 1fr; }
  .arch-node:nth-child(even) { margin-top: 0; }
  .arrow { display: none; }
  .faq-grid { grid-template-columns: 1fr; }
  .cta-box { flex-direction: column; align-items: flex-start; }
}
</style>
