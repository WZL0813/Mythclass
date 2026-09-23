# Admin 后台使用说明

Admin 挂在服务端上，不走 EdgeOne。

地址：`https://mythclassapi.ryokuryuneko.top/admin`

它跟教师端是**两套完全独立的账号体系**。教师端封了不影响 Admin，反过来也一样。

---

## 一、首次初始化

服务端第一次起来时，`admins` 表是空的，它会：

1. 生成一个一次性令牌（32 字节随机数的十六进制）
2. 写进本地文件 `server/data/admin-setup-token.txt`
3. 控制台打印一句：`[Mythclass] Admin setup token generated. Check ./data/admin-setup-token.txt`

**令牌内容不会通过任何接口下发，也不会打印出来。** 只能去服务器上开那个文件看。

### 操作步骤

1. 打开 `server/data/admin-setup-token.txt`，复制那串东西
2. 浏览器打开 `/admin`
3. 页面检测到还没初始化，显示「初始化管理员」表单
4. 填：令牌 + 管理员账号（默认 `admin`）+ 新密码（至少 8 位）+ 确认密码
5. 提交

成功后：

- 管理员账号创建，密码用 bcrypt 加密
- **令牌文件立刻删除**
- `POST /api/admin/setup` 永久关闭，再也建不了第二个初始管理员

### 忘了令牌怎么办

停掉服务端，清空管理员表，再启动。服务端会重新生成一份令牌文件。

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('./data/mythclass.db');d.exec('DELETE FROM admins');d.close()"
npm start
```

（如果装的是 `better-sqlite3`，把那句话换成 `const D=require('better-sqlite3');const d=new D('./data/mythclass.db');d.exec('DELETE FROM admins');d.close()` 就行。）

---

## 二、登录

打开 `/admin`：

- 没初始化 → 初始化表单
- 初始化了但没登录 → 登录表单
- 登录了 → 直接进后台

登录凭证存在浏览器 `localStorage`，键名 `mythclass.admin.token`。

Admin JWT 用**独立的密钥**（`ADMIN_JWT_SECRET`），有效期 1 小时，载荷里带 `role: "admin"`。

过期了会自动跳回登录页。

---

## 三、仪表盘

四块数字：

| 卡片 | 内容 |
|---|---|
| 用户总数 | 在线几个、封禁几个 |
| 客户端 | 总数、在线数、已绑定数 |
| 文件记录 | 一共多少条 |
| 注册开关 | 开放中 / 已关闭 |

下面一张「服务端状态」：运行时间、WebSocket 连接数、内存占用、Node 版本、系统、服务端版本。

---

## 四、用户管理

### 列表

显示 ID、用户名、邮箱、状态、客户端数、最后登录、注册时间。

顶部能按用户名或邮箱搜索，能按状态筛（正常 / 封禁）。在线用户会额外挂一个「在线」标。

### 能做的操作

| 操作 | 说明 |
|---|---|
| 主动建号 | 管理员直接开账号，不用等注册开关 |
| 编辑 | 改用户名、邮箱 |
| 重置密码 | 直接设新密码 |
| 封禁 | 状态改 `banned`，JWT 立刻失效，WebSocket 被掐断 |
| 解封 | 恢复 `active` |
| 删除 | 永久删除，同时解绑它的所有客户端 |
| 看机器 | 展开这个用户绑定的客户端列表 |

### 封禁为什么是即时的

`users` 表有个 `token_version` 字段，JWT 里带 `tv`。

封禁、解封、重置密码、改密码，都会把 `token_version` 加一。服务端每次校验都比对，不一致就 401。同时主动断开这个用户所有 WebSocket。

所以不用等 token 过期，一秒钟内就踢干净。

---

## 五、客户端管理

### 列表

显示 ID、客户端 ID、名字、归属用户、在线状态、系统 / 版本、最后 IP、最后心跳、记录条数。

能按客户端 ID、名字、归属用户名搜。

### 能做的操作

| 操作 | 说明 |
|---|---|
| 详情 | 系统、版本、在线、最后 IP、最后心跳、记录条数、最近音频 |
| 改归属 | 把机器转给另一个用户（会先解开原来的绑定） |
| 解绑 | 从所属账号里摘出来，机器还在线上 |
| 删除 | 删掉这台机器的记录，连带它的文件记录。下次启动会当新机器重新注册 |

### 什么时候用得上

- 学生把机器绑错账号了 → 改归属
- 机器报废换新 → 删掉旧的
- 老师离职 → 先改归属，再删账号

---

## 六、注册开关

`system_settings` 表里的 `registration_open`，默认 `true`。

后台「系统设置」页有个开关，拨一下实时生效。

关掉之后：

- 教师端注册页会先请求 `GET /api/auth/registration-status`，拿到 `open: false` 就显示「注册已关闭」
- 就算有人绕过前端直接打 `POST /api/auth/register`，服务端也会回 `403 REGISTRATION_CLOSED`

前端拦一次，后端再拦一次。

---

## 七、系统设置

### 改管理员密码

填原密码 + 新密码（至少 8 位）。

### 数据导出

四个按钮：用户 JSON / 用户 CSV / 客户端 JSON / 客户端 CSV。

导出的是清单，**不含密码哈希**。

### 注册开关

见上一节。

---

## 八、API 一览

所有 `/api/admin/*` 都要 `Authorization: Admin-Bearer <admin_jwt>`，除了前三个。

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/api/admin/setup-status` | 是否已初始化 | 无 |
| POST | `/api/admin/setup` | 用令牌建首个管理员 | setup_token |
| POST | `/api/admin/login` | Admin 登录 | 无 |
| GET | `/api/admin/me` | 当前管理员 | Admin JWT |
| POST | `/api/admin/change-password` | 改密码 | Admin JWT |
| GET | `/api/admin/dashboard` | 仪表盘数据 | Admin JWT |
| GET | `/api/admin/users` | 用户列表 | Admin JWT |
| POST | `/api/admin/users` | 主动建用户 | Admin JWT |
| PUT | `/api/admin/users/:id` | 编辑用户 | Admin JWT |
| POST | `/api/admin/users/:id/ban` | 封禁 | Admin JWT |
| POST | `/api/admin/users/:id/unban` | 解封 | Admin JWT |
| POST | `/api/admin/users/:id/reset-password` | 重置密码 | Admin JWT |
| DELETE | `/api/admin/users/:id` | 删除用户 | Admin JWT |
| GET | `/api/admin/users/:id/clients` | 用户绑定的客户端 | Admin JWT |
| GET | `/api/admin/clients` | 客户端列表 | Admin JWT |
| GET | `/api/admin/clients/:id` | 客户端详情 | Admin JWT |
| DELETE | `/api/admin/clients/:id` | 删除客户端 | Admin JWT |
| POST | `/api/admin/clients/:id/unbind` | 解绑 | Admin JWT |
| POST | `/api/admin/clients/:id/rebind` | 改归属 | Admin JWT |
| GET | `/api/admin/settings` | 系统设置 | Admin JWT |
| PUT | `/api/admin/settings/registration` | 开 / 关注册 | Admin JWT |
| GET | `/api/admin/export` | 导出（`type`、`format`） | Admin JWT |

---

## 九、安全建议

1. **两个密钥必须不一样**：`JWT_SECRET` 管教师端和客户端，`ADMIN_JWT_SECRET` 管 Admin
2. **给 `/admin` 加一道门**：Cloudflare Zero Trust → Access，只允许你自己的邮箱访问这个路径
3. **令牌文件不进 Git**：`.gitignore` 里已经有 `data/` 了
4. **密码至少 8 位**，别用 `admin123`
5. **定期导出备份**，SQLite 文件在 `server/data/mythclass.db`
6. **admins 表只放一个账号**。要多人管，就共用，别乱开

---

## 十、故障排查

| 现象 | 原因 |
|---|---|
| 打开 `/admin` 是 404 | 服务端没起来，或者静态目录路径不对 |
| 说「还没初始化」但令牌文件没了 | 表被清过。重启服务端会重新生成 |
| 令牌不对 | 复制时带了空格 / 换行，重开文件复制 |
| 登录后一小时就退 | 正常，Admin JWT 就是 1 小时 |
| 教师端还说注册开着 | 页面缓存，刷新一下；或者服务端没连上 |
| 封禁后对方还能用 | 不太可能。让他刷新页面再试；还不行就看客户端连的是不是另一个服务端 |

---

© 2025 Ryokuryuneko · [AGPL-3.0](../LICENSE)
