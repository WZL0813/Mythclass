# Mythclass 教师端

浏览器打开就能巡课的那一端。

一份代码同时干两件事：官网介绍页 + 教师控制台。

---

## 界面上有什么

| 路由 | 是什么 |
|---|---|
| `/` | 介绍首页。功能、架构、每日一言、常见问题 |
| `/login` | 登录 |
| `/register` | 注册 |
| `/dashboard` | 控制台。看屏幕、听音频、查文件、发命令 |
| `/docs` | 文档索引 |
| `/about` | 关于与合规说明 |

设计上没走 SaaS 那一套：苔绿配米白，背景有噪点，卡片故意不等宽。

---

## 跑起来

```bash
npm install
copy .env.example .env.local     # 按需改
npm run dev
```

打开 http://127.0.0.1:5173 。

本地开发时 `/api` 和 `/socket.io` 会被代理到 `127.0.0.1:3000`，所以先起服务端。

### 环境变量

| 变量 | 说明 |
|---|---|
| `VITE_SERVER_URL` | 服务端地址。留空 = 同源 |
| `VITE_APP_NAME` | 应用名，默认 Mythclass |
| `VITE_OFFICIAL_SERVER` | 内置官方服务器，正式环境别改 |

---

## 构建

```bash
npm run build      # 产物在 dist/
```

---

## 部署到 EdgeOne Pages

1. 把仓库推到 GitHub
2. EdgeOne Pages 新建项目，选这个仓库
3. 根目录填 `teacher`，构建命令 `npm run build`，输出目录 `dist`
4. 环境变量加 `VITE_SERVER_URL=https://mythclassapi.ryokuryuneko.top`
5. 绑定自定义域名 `mythclass.ryokuryuneko.top`（CNAME）

`edgeone.json` 已经在仓库里了，一般不用手填。

### WebSocket 的坑

EdgeOne 只支持 HTTP/1.1 的 WebSocket，最大连接超时 300 秒。

- 控制台 → 站点加速 → 网络优化 → 打开 WebSocket 开关
- 最大连接超时设 300 秒
- 教师端已经做了断线重连，超时了会自己接回来

服务端那边是 Cloudflare Tunnel，WebSocket 没限制。

---

## 目录

```
teacher/
├── src/
│   ├── api/index.js          # REST + Socket.IO 封装
│   ├── stores/auth.js        # 登录态、客户端列表、长连接
│   ├── router/index.js
│   ├── data/quotes.json      # 每日一言
│   ├── components/           # 导航、页脚、加载遮罩
│   └── views/                # 首页 / 登录 / 注册 / 控制台 / 文档 / 关于
├── edgeone.json
├── tailwind.config.js        # 自定义色板，不用默认色
└── vite.config.js
```

---

## 控制台怎么用

1. 登录后进 `/dashboard`
2. 左边是机器列表，点一台
3. 「屏幕」页点「开始看」，画面就来了
4. 想看它听什么，切「音频」
5. 想查谁动过文件，切「文件记录」，能搜能导 CSV
6. 要锁屏关机，切「命令」

远程控制打开后，你在画面上的点击和按键会真的落到那台机器上。用之前想清楚。

---

© 2025 Ryokuryuneko · [AGPL-3.0](../LICENSE)
