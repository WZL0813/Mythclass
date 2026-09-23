# 测试

两个冒烟脚本。都对着一个**跑在本机、端口 3111、干净的数据库**的服务端跑。（客户端侧的测试在 [Mythclass-Client](https://github.com/WZL0813/Mythclass-Client) 的 `tests/` 里。）

跑之前先这样起服务端：

```bash
cd server
# Windows PowerShell
$env:PORT=3111
node src/index.js
```

```bash
# macOS / Linux
PORT=3111 node src/index.js
```

`rest-smoke.cjs` 会初始化管理员并把 setup token 文件删掉，所以要跑它就得用**全新的 data 目录**：

```bash
rm -rf server/data        # 或者 PowerShell: Remove-Item server/data -Recurse -Force
```

---

## 两个脚本

| 脚本 | 测什么 | 依赖 |
|---|---|---|
| `rest-smoke.cjs` | 50 项 REST：注册登录、客户端登记、绑定、记录、越权、Admin 全套、封禁即时生效、注册开关 | 服务端 |
| `ws-smoke.cjs` | 19 项 WebSocket：握手鉴权、房间、屏幕帧与命令中继、越权隔离、心跳、策略同步、封禁强踢、上下线广播 | 服务端 + `teacher/node_modules` |

---

## 跑

```bash
# 1) 先跑 REST（它会初始化管理员，密码设成 newadminpass）
node tests/rest-smoke.cjs

# 2) 再跑 WebSocket（要用上一步的 admin 密码）
node tests/ws-smoke.cjs
```

顺序不能反：`ws-smoke.cjs` 里那几项封禁测试要用 `rest-smoke.cjs` 建好的管理员。

## 期望输出

```
通过 50 项，失败 0 项
通过 19 项，失败 0 项
```

---

## 它们不测什么

- 真实屏幕捕获、音频会话、文件监控（要 Windows 一体机和真桌面）
- P2P 打洞（要两台在不同网络的机器）
- EdgeOne / Cloudflare 那一层（要真域名）

这些得按 [部署教程](../docs/部署教程-EdgeOne与CloudflareTunnel.md) 的验收清单手动走一遍。

---

© 2025 Ryokuryuneko · [AGPL-3.0](../LICENSE)
