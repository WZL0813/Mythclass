# Mythclass Server

服务端。认证、客户端登记、信令与中继都在这儿。靠 Cloudflare Tunnel 接入公网。

**它管三件事**

1. 教师端账号：注册、登录、JWT 鉴权
2. 客户端登记：一体机上报自己，拿到长期凭证
3. 牵线：P2P 打洞的信令，打不通就走它中继

顺带还开着一个 `/admin` 管理后台。

---

## 目录速览

```
server/
├── src/
│   ├── index.js              # 入口：Express + Socket.IO
│   ├── config.js             # 配置加载（.env > config.json > 自动生成密钥）
│   ├── routes/
│   │   ├── auth.js           # 教师端 API       /api/auth
│   │   ├── client.js         # 客户端 API       /api/client
│   │   └── admin.js          # 管理后台 API     /api/admin
│   ├── middleware/auth.js    # 三套鉴权中间件
│   ├── sockets/index.js      # 信令 / 中继 / 在线状态
│   ├── db/index.js           # SQLite 建表与初始数据
│   └── admin/setupToken.js   # 一次性初始化令牌
├── public/admin/             # Admin 后台页面（原生 HTML/CSS/JS）
├── cloudflared/              # 隧道配置示例
├── data/                     # 数据库与令牌文件（不进 Git）
├── config.example.json
└── .env.example
```

---

## 跑起来

```bash
npm install
cp config.example.json config.json     # Windows: copy config.example.json config.json
# 改里面的 jwtSecret / adminJwtSecret，或改用 .env
npm start
```

看到这段就是好了：

```
Mythclass 若思班级一体机管理系统 · 服务端
监听地址   http://127.0.0.1:3000
Admin 后台 http://127.0.0.1:3000/admin
```

### 关于密钥

没填 `JWT_SECRET` / `ADMIN_JWT_SECRET` 也能跑——服务端会自己生成一份丢进 `data/runtime-secrets.json`，并在控制台提醒你。

正式部署请老实写进 `.env`。两个密钥必须不一样。

### 关于数据库

服务端优先用 `better-sqlite3`，没装就用 **Node 自带的 `node:sqlite`**。

所以默认不需要任何编译工具链——不用装 Visual Studio，一条 `npm install` 就完事。

- Node **22.5+**（推荐 24）：自带 `node:sqlite`，直接跑
- Node 22.5 ~ 23.3：要加 `--experimental-sqlite`，或者装 better-sqlite3
- 想快一点：`npm install better-sqlite3`，代码会自动切过去

启动日志里会告诉你现在用的是哪一个。

### 关于 bcrypt

用的是 `bcryptjs`（纯 JS），不需要编译。要更快可以换 `bcrypt`，但没必要。

---

## 接口一览

### 教师端 `/api/auth`

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/registration-status` | 现在还开放注册吗 | 无 |
| POST | `/register` | 注册 | 无 |
| POST | `/login` | 登录 | 无 |
| GET | `/me` | 我是谁 | Bearer |
| POST | `/change-password` | 改密码 | Bearer |
| GET | `/clients` | 我绑了哪些机器 | Bearer |
| POST | `/bind` | 绑定客户端 | Bearer |
| PUT | `/clients/:id` | 给机器改名 | Bearer |
| DELETE | `/clients/:id` | 解绑 | Bearer |
| GET | `/clients/:id/info` | 机器详情 | Bearer |
| GET | `/clients/:id/file-logs` | 文件记录（分页/筛选） | Bearer |
| DELETE | `/clients/:id/file-logs` | 清空记录 | Bearer |
| GET | `/clients/:id/audio-logs` | 音频记录 | Bearer |
| GET/PUT | `/clients/:id/settings` | 记录保留策略（双端同步） | Bearer |
| POST | `/clients/:id/command` | 下发命令（REST 兜底） | Bearer |

### 客户端 `/api/client`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/register` | 上报 client_uid，换长期 token |
| GET | `/config` | 拉自己的策略 |
| POST | `/heartbeat` | 心跳 |
| POST | `/file-logs` | 批量上报文件改动 |
| POST | `/audio-info` | 上报音频状态 |
| POST | `/command-result` | 回报执行结果 |

### Admin `/api/admin`

见 [docs/Admin后台使用说明.md](../docs/Admin后台使用说明.md)。

---

## WebSocket 事件

路径 `/socket.io`，握手时带 `{ auth: { token } }`。

| 方向 | 事件 | 用途 |
|---|---|---|
| 上行 | `register` | 客户端注册（服务端回的） |
| 上行 | `heartbeat` | 客户端心跳 |
| 上行 | `watch` / `unwatch` | 老师开始/停止观看某台机器 |
| 上行 | `command` | 老师下发命令 |
| 上行 | `control_event` | 鼠标键盘事件 |
| 上行 | `screen_frame` | 屏幕帧 |
| 上行 | `audio_info` / `file_log` | 状态上报 |
| 上行 | `command_result` | 执行结果 |
| 上行 | `offer` / `answer` / `ice` | WebRTC 信令 |
| 下行 | `client:presence` | 上线/离线推送 |
| 下行 | `settings:update` | 策略变更 |
| 下行 | `force:logout` | 封禁/改密后强踢 |

细节看 [docs/通信协议.md](../docs/通信协议.md)。

---

## Cloudflare Tunnel

```bash
cd cloudflared
copy config.example.yml config.yml    # 填 Tunnel ID 与凭证路径
cloudflared tunnel run mythclass-server
```

出站连接，路由器不用开任何入站端口。

---

© 2025 Ryokuryuneko · [AGPL-3.0](../LICENSE)
