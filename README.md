# Mythclass 若思班级一体机管理系统

> 教室一体机巡课与远程管理
> **不推门，也能巡课。**

[![License](https://img.shields.io/badge/license-AGPL--3.0-2F4F3E.svg)](LICENSE)
[![Server](https://img.shields.io/badge/server-Node.js%20%2B%20SQLite-3F6B52.svg)](server/)
[![Teacher](https://img.shields.io/badge/teacher-Vue3%20%2B%20Vite-C97B3C.svg)](teacher/)
[![Client](https://img.shields.io/badge/client-Python%203.10%2B-6B7C5A.svg)](https://github.com/WZL0813/Mythclass-Client)

---

## 这是什么

一间教室一台一体机，老师不必挨个推门看。

Mythclass 把教室一体机变成「能被远程看见、能被远程指挥」的终端：

- 老师用浏览器打开网页，就能看到屏幕、发指令
- 一体机安静待机，只在托盘露一个小图标
- 服务端通过 Cloudflare Tunnel 接入公网，两端连同一个服务端才能互相看见

功能定位对齐极域电子教室，但界面更现代、部署更轻。

---

## 功能特性

| 模块 | 能力 |
|---|---|
| 屏幕查看 | 实时画面、全屏、缩放、一键截图 |
| 远程控制 | 在画面上直接发鼠标 / 键盘事件 |
| 音频监测 | 谁在放声音、放什么、音量多大 |
| 文件记录 | 目录改动留痕，精确到秒，可筛选可导出 |
| 命令面板 | 锁屏 / 解锁、关机 / 重启 / 注销、弹窗、开网页、发文件 |
| 多用户绑定 | 一个账号绑多台一体机，可改名可解绑 |
| Admin 后台 | 管用户、管客户端、一键关注册 |
| 情绪价值 | 每日一言、加载进度、主题切换 |

---

## 部署架构

```
┌──────────────────────────────┐
│ 教师端 Teacher               │
│ EdgeOne Pages 静态托管        │
│ https://mythclass.ryokuryuneko.top │
└──────────────┬───────────────┘
               │ HTTPS / WebSocket
               ▼
┌──────────────────────────────┐
│ Cloudflare Edge Network      │
│ wss://mythclassapi.ryokuryuneko.top │
└──────────────┬───────────────┘
               │ 加密隧道 cloudflared（出站）
               ▼
┌──────────────────────────────┐
│ 服务端 Server                │
│ localhost:3000               │
│ 兼 /admin 管理后台            │
└──────────────┬───────────────┘
               │ HTTPS / WebSocket
               ▼
┌──────────────────────────────┐
│ 客户端 Client                │
│ 教室一体机，局域网优先 P2P     │
└──────────────────────────────┘
```

### 域名规划

| 用途 | 域名 | 指向 |
|---|---|---|
| 官方服务器 | `mythclassapi.ryokuryuneko.top` | Cloudflare Tunnel 入口 |
| 教师端网页 | `mythclass.ryokuryuneko.top` | EdgeOne Pages |
| 官网（预留） | `ryokuryuneko.top` | 未来 EdgeOne / GitHub Pages |
| 文档站（预留） | `mythclassdocs.ryokuryuneko.top` | 可选 |
| 客户端下载（预留） | `mythclassdl.ryokuryuneko.top` | 可选 |

官方服务器域名内置在客户端与教师端里，**不可删除**。

---

## 目录结构

```
Mythclass/
├── server/                 # 服务端
│   ├── src/
│   │   ├── index.js
│   │   ├── config.js
│   │   ├── routes/         # auth / client / admin
│   │   ├── middleware/     # teacherAuth / adminAuth / clientAuth
│   │   ├── sockets/        # 信令与中继
│   │   ├── db/             # SQLite 建表与访问
│   │   └── admin/          # setup token 生成
│   ├── public/admin/       # Admin 后台静态页面
│   ├── data/               # 数据库、setup token（不提交）
│   ├── cloudflared/        # 隧道配置示例
│   ├── config.example.json
│   └── package.json

├── teacher/                # 教师端 HTML 网页
│   ├── src/
│   ├── public/
│   ├── edgeone.json
│   └── package.json
├── docs/                   # 全部部署与使用文档
├── README.md
├── LICENSE
└── .gitignore
```

客户端（教室里那台一体机）单独一个仓库：
[Mythclass-Client](https://github.com/WZL0813/Mythclass-Client)

---

## 快速开始

### 1. 起服务端

```bash
cd server
npm install
cp config.example.json config.json     # 填入 JWT_SECRET / ADMIN_JWT_SECRET
npm start
```

首次启动会生成 `data/admin-setup-token.txt`，里面是一串一次性初始化令牌。

### 2. 起教师端

```bash
cd teacher
npm install
echo "VITE_SERVER_URL=wss://mythclassapi.ryokuryuneko.top" > .env.local
npm run dev
```

打开 http://localhost:5173 就是官网首页 + 登录入口。

### 3. 起客户端

客户端在另一个仓库：[Mythclass-Client](https://github.com/WZL0813/Mythclass-Client)

```bash
git clone https://github.com/WZL0813/Mythclass-Client.git
cd Mythclass-Client
pip install -r requirements.txt
python -m mythclass
```

托盘出现绿色小图标即成功。

### 4. 初始化 Admin

访问 `https://mythclassapi.ryokuryuneko.top/admin`（本地则是 `http://127.0.0.1:3000/admin`），
填入 `data/admin-setup-token.txt` 里的令牌 + 新密码，完成初始化。

---

## 文档

- [部署教程：EdgeOne 与 Cloudflare Tunnel](docs/部署教程-EdgeOne与CloudflareTunnel.md)
- [客户端安装与自启](https://github.com/WZL0813/Mythclass-Client/blob/main/docs/客户端安装与自启.md)（在客户端仓库）
- [教师端使用说明](docs/教师端使用说明.md)
- [Admin 后台使用说明](docs/Admin后台使用说明.md)
- [通信协议](docs/通信协议.md)
- [测试怎么跑](tests/README.md)

---

## 技术栈

| 端 | 栈 |
|---|---|
| 服务端 | Node.js 22.5+ / Express / Socket.IO / SQLite / JWT / bcryptjs |
| 教师端 | Vue3 / Vite / Pinia / Vue Router / Element Plus / TailwindCSS / Iconify |
| 客户端 | Python 3.10+ / pystray / Pillow / watchdog / pycaw / mss / websocket-client |

---

## 贡献指南

1. Fork 本仓库
2. 新建分支 `feat/你的功能`
3. 提交前跑一遍 `npm run build`（teacher）与 `node --check`（server）
4. 提 PR，说清楚改了什么、为什么

别提交 `config.json`、`.env`、`data/`、`*.db`、隧道凭证文件。`.gitignore` 已经拦好了。

---

## 安全与合规

这套软件能看屏幕、能远控、能记文件。请务必：

- 只在合法教学管理场景使用
- 在学生知情、学校同意的前提下启用
- 遵守《个人信息保护法》《网络安全法》等法律法规
- 客户端设置里有「合规使用承诺」勾选项，第一次运行必须勾

---

## 许可证

[AGPL-3.0](LICENSE)

这套项目用的是 **GNU Affero 通用公共许可证 v3.0**。

翻译成人话：你可以随便用、随便改。但**只要你把它改过之后挂到网上给人用**（比如学校里跑着一套），就得把改过的源码也开源出去。这是 AGPL 的规矩，不是可选项。

---

© 2025 Ryokuryuneko. All rights reserved.
GitHub: https://github.com/WZL0813/Mythclass
