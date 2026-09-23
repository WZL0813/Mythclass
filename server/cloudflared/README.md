# cloudflared 目录

这里放 Cloudflare Tunnel 的配置与说明。

**只有 `config.example.yml` 会进 Git。** `config.yml` 和 `<TunnelID>.json` 凭证文件都在 `.gitignore` 里。

---

## 三条命令搞定

```bash
# 1. 登录（会打开浏览器）
cloudflared tunnel login

# 2. 建一条命名隧道
cloudflared tunnel create mythclass-server

# 3. 把域名挂上去（DNS 自动生成 CNAME）
cloudflared tunnel route dns mythclass-server mythclassapi.ryokuryuneko.top
```

然后把 `config.example.yml` 复制成 `config.yml`，填上第 2 步输出里的 Tunnel ID 和凭证路径，跑：

```bash
cloudflared tunnel run mythclass-server
```

Dashboard 里 Tunnel 状态变 Healthy 就成了。

---

## 为什么不用快速隧道

`cloudflared tunnel --url http://localhost:3000` 那种会给你随机域名，重启就换。

客户端里内置的官方域名是固定的，所以必须用命名隧道。

---

## WebSocket 会被拦吗

不会。Cloudflare Tunnel 对 WebSocket 完全支持，不用额外配置。

真正要留意 WebSocket 的是 **EdgeOne 那边**：

- 只支持 HTTP/1.1 的 WebSocket，不支持 HTTP/2
- 最大连接超时 300 秒，要在控制台开开关、设超时

屏幕流如果走 EdgeOne 中转，记得在教师端做重连。

---

## 安全建议

- 服务端只监听 `127.0.0.1`，别监听 `0.0.0.0`
- 隧道用完后 `cloudflared tunnel cleanup mythclass-server`
- Tunnel Token 定期轮换，泄露了就 `cloudflared tunnel token mythclass-server --cred-file ...` 重发
- 想再狠一点：Cloudflare Zero Trust → Access → 给 `mythclassapi.ryokuryuneko.top/admin` 加一条策略，只允许你自己的邮箱进

---

## 常见毛病

| 症状 | 大概是 |
|---|---|
| 502 Bad Gateway | 服务端没起来，或者端口不是 3000 |
| 1033 错误 | 隧道进程没跑 |
| WebSocket 连上就断 | `originRequest.keepAliveTimeout` 太短，或中间有代理在砍长连接 |
| 域名解析到旧地址 | `cloudflared tunnel route dns` 会覆盖，重跑一次 |
