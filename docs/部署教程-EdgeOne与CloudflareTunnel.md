# 部署教程：EdgeOne 与 Cloudflare Tunnel

照这个顺序做完，一套就跑起来了。

- 第一部分：服务端 + Cloudflare Tunnel
- 第二部分：教师端（EdgeOne Pages）
- 第三部分：客户端（教室一体机）
- 第四部分：Admin 后台

需要准备的东西：一台能常开的电脑、一个 Cloudflare 账号、一个腾讯云账号、一个域名。

---

## 第一部分：服务端部署

### 1. 环境准备

- Node.js 22.5 或更高（推荐 24，自带 `node:sqlite`，不用装任何编译工具）
- 想要更快的 SQLite 可以再装 `better-sqlite3`（这个才需要 C++ 编译工具链）
- 电脑能上外网，最好别关机别休眠

```bash
cd server
npm install
```

### 2. 装 cloudflared

去 Cloudflare Dashboard → Zero Trust → Networks → Tunnels，下载对应系统的 `cloudflared`，丢进 `C:\cloudflared\` 并把目录加进 PATH。

```bash
cloudflared --version
```

### 3. 登录与建隧道

```bash
cloudflared tunnel login
cloudflared tunnel create mythclass-server
```

第二条命令会吐出一个 Tunnel ID，还有一份凭证 JSON，记下来。

### 4. 配路由

```bash
cloudflared tunnel route dns mythclass-server mythclassapi.ryokuryuneko.top
```

然后复制配置：

```bash
cd server\cloudflared
copy config.example.yml config.yml
```

`config.yml` 里填上 Tunnel ID 和凭证路径：

```yaml
tunnel: 你的TunnelID
credentials-file: C:\Users\你的用户名\.cloudflared\你的TunnelID.json
ingress:
  - hostname: mythclassapi.ryokuryuneko.top
    service: http://localhost:3000
  - service: http_status:404
```

### 5. 起服务端

```bash
cd server
copy config.example.json config.json
```

编辑 `config.json`，把 `jwtSecret` 和 `adminJwtSecret` 换成两串**不一样**的随机值（至少 32 位）。不想用 JSON 也行，复制 `.env.example` 为 `.env` 填进去。

```bash
npm start
```

看到这段就成了：

```
Mythclass 若思班级一体机管理系统 · 服务端
监听地址   http://127.0.0.1:3000
Admin 后台 http://127.0.0.1:3000/admin
```

第一次启动还会生成 `data/admin-setup-token.txt`，待会儿初始化 Admin 要用。

### 6. 起隧道

另开一个窗口：

```bash
cloudflared tunnel run mythclass-server
```

Dashboard 里看隧道状态是不是 Healthy。

### 7. 验证

浏览器打开 `https://mythclassapi.ryokuryuneko.top/healthz`，应该回一段 JSON。

回不来就查这几条：

| 症状 | 大概率是 |
|---|---|
| 502 | 服务端没起来，或不是 3000 端口 |
| 1033 | tunnel 进程没跑 |
| DNS 不对 | 重跑一次 `cloudflared tunnel route dns` |

### 8. 安全建议

- 服务端只监听 `127.0.0.1`，别改成 `0.0.0.0`
- 淘宝式骚操作不要有：别把 `data/` 和 `config.json` 传到任何地方
- 想再紧一点：Zero Trust → Access 给 `/admin` 加一条策略，只允许你自己的邮箱
- Tunnel Token 定期轮换

### 9. 开机自启（可选）

```powershell
# 管理员 PowerShell
cloudflared service install
```

服务端本身用 `nssm` 或任务计划程序挂上，工作目录指向 `server\`。

---

## 第二部分：教师端部署（EdgeOne Pages）

### 1. 推代码

把仓库推到 GitHub：

```bash
cd Mythclass
git init
git add .
git commit -m "chore: 初始提交"
git branch -M main
git remote add origin https://github.com/WZL0813/Mythclass.git
git push -u origin main
```

### 2. 连接仓库

1. 登录腾讯云，开通 EdgeOne Pages
2. 新建项目 → 导入 Git 仓库 → 选 `Mythclass`
3. 框架预设选 Vue（或自定义）

### 3. 构建配置

| 项 | 值 |
|---|---|
| 根目录 | `teacher` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 安装命令 | `npm install` |

这些 `teacher/edgeone.json` 里也有，多半会自动带出来。

### 4. 环境变量

控制台里加：

| 变量 | 值 |
|---|---|
| `VITE_SERVER_URL` | `https://mythclassapi.ryokuryuneko.top` |
| `VITE_APP_NAME` | `Mythclass` |

### 5. 部署

点开始部署，等它跑完，会给你一个 `xxx.edgeone.app` 域名。先点开看看首页出没出来。

### 6. 绑自定义域名

项目设置 → 域名管理 → 添加 `mythclass.ryokuryuneko.top`，按提示在 DNS 里加 CNAME。

> 如果加速区域包含中国大陆，域名需要完成工信部备案。不备案就先别开大陆加速。

### 7. 开 WebSocket

控制台 → 站点加速 → 网络优化 → 打开 WebSocket 开关 → 最大连接超时设 300 秒。

不开的话，屏幕流会连不上，列表也刷不出在线状态。

---

## 第三部分：客户端部署

### 1. 打包

```bash
cd client
pip install -r requirements.txt
pip install pyinstaller
pyinstaller build/mythclass.spec
```

产物 `dist/Mythclass.exe`。

### 2. 安装

把 `dist/Mythclass.exe` 和 `client/build/` 一起拷到一体机上，管理员 PowerShell：

```powershell
cd build
.\install-service.ps1
```

脚本会做五件事：拷到 `%ProgramFiles%\Mythclass`、写配置、建 SYSTEM 计划任务、写 Run 键、收紧目录权限。

### 3. 确认

托盘出现绿色小图标 → 左键 → 抄下机器 ID。

设置里记得：

1. 改掉默认密码 `admin123`
2. 勾上「合规使用承诺」
3. 确认服务器列表里有官方那条

### 4. 绑定

教师端登录 → 控制台 → 「绑定」 → 填机器 ID → 起个名。

---

## 第四部分：Admin 后台初始化

1. 打开 `https://mythclassapi.ryokuryuneko.top/admin`
2. 页面会说「还没初始化」，让你填三样：setup token、新密码、确认密码
3. setup token 在服务端 `server/data/admin-setup-token.txt` 里（本地文件，没走网络）
4. 提交后会创建管理员，**令牌文件立即销毁**，这个接口永久关闭

之后就能管用户、管客户端、开关注册了。细节看 [Admin后台使用说明.md](Admin后台使用说明.md)。

---

## 第五部分：验收清单

挨个走一遍，全过就算成了：

- [ ] 服务端本机 `http://127.0.0.1:3000/healthz` 通
- [ ] 域名 `https://mythclassapi.ryokuryuneko.top/healthz` 通
- [ ] 教师端首页能打开，样式正常
- [ ] 能注册、能登录
- [ ] Admin 后台能初始化、能登录
- [ ] 客户端托盘有图标，能拿到机器 ID
- [ ] 教师端能绑定，列表里显示「在线」
- [ ] 点「开始看」能出画面
- [ ] 发一条 `message` 命令，一体机弹窗
- [ ] 文件记录页有几条记录
- [ ] Admin 后台关掉注册，教师端注册页显示「注册已关闭」

---

## 第六部分：常见故障

| 现象 | 排查方向 |
|---|---|
| 教师端报「连不上服务端」 | `VITE_SERVER_URL` 写错；CORS 没放行；隧道没跑 |
| 登录一直转圈 | 服务端日志里看有没有收到请求；EdgeOne 的 WebSocket 没开 |
| 客户端连不上 | 一体机能不能上外网；域名拼错；系统时间不准（JWT 会过期） |
| 绑定提示「已被别的账号绑定」 | 去 Admin 后台「改归属」 |
| 屏幕流是黑的 | 一体机没登录桌面 / 屏幕捕获被安全软件拦了 |
| 文件记录空的 | 监控目录里真没改动；或者目录配错了 |
| WebSocket 每 5 分钟断一次 | EdgeOne 300 秒超时到了，正常，会自动重连 |
| 音频一直空 | 一体机没装 `pycaw`，或者真没人放声音 |

---

© 2025 Ryokuryuneko · [AGPL-3.0](../LICENSE)
