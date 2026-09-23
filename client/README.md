# Mythclass Client

教室一体机上跑的那个。没主界面，只在托盘露个头。

学生关不掉它——默认开了进程保护和禁用任务管理器。

---

## 它平时在干什么

| 干什么 | 怎么做 | 什么时候 |
|---|---|---|
| 看文件改动 | `watchdog` 盯目录 | 一直在 |
| 听声音 | `pycaw` 扫音频会话 | 每 5 秒 |
| 看屏幕 | `mss` 抓屏转 JPEG | 老师点了「开始看」才开 |
| 报心跳 | REST + WebSocket | 每 15-20 秒 |
| 清旧记录 | SQLite 删除 | 每 5 分钟 |
| 保护自己 | 跟班进程 + 计划任务 | 一直在 |

屏幕流不常开。没人看就不抓屏，不浪费一体机的性能。

---

## 跑起来

```bash
pip install -r requirements.txt
python -m mythclass --console      # 前台跑，日志打屏上
python -m mythclass                # 正常跑，托盘模式
python -m mythclass --status       # 看状态就退出
```

第一次启动会做这些事：

1. 在 `%APPDATA%\Mythclass\` 建目录
2. 复制一份 `config.json` 过去
3. 算出机器 ID，形如 `MYTH-3F2A-9C21-B4D8`
4. 按官方 → 自定义的顺序连服务器

### 看机器 ID

托盘图标左键单击，弹出的「关于」窗口里有。

去教师端点「绑定」，填这串 ID。

---

## 托盘

| 操作 | 结果 |
|---|---|
| 左键单击 | 关于窗口（含机器 ID、复制仓库地址） |
| 右键 → 关于 | 同上 |
| 右键 → 设置 | 先要密码，默认 `admin123` |
| 右键 → 状态 | 连接状态、记录条数 |
| 右键 → 退出 | 也要密码 |

设置界面分四页：基本、服务器、监控与记录、保护。

---

## 设置里能改什么

| 项目 | 默认 | 说明 |
|---|---|---|
| 机器名 | 教室一体机 | 教师端列表里显示的名字 |
| 管理员密码 | `admin123` | 第一次进设置请改掉 |
| 服务器列表 | 官方 + 自定义 | 官方那条删不掉 |
| 监控目录 | 桌面、文档 | 一行一个路径 |
| 记录上限 | 5000 条 / 200 MB | 超了删最旧的 |
| 进程保护 | 开 | 被关掉会自动回来 |
| 禁用任务管理器 | 开 | 要注销一次才彻底 |
| 开机自启 | 开 | Run 键 + 登录计划任务 |
| 合规使用承诺 | 未勾 | 勾了才算你真的知道在装什么 |

---

## 打包

```bash
pip install pyinstaller
pyinstaller build/mythclass.spec
```

产物 `dist/Mythclass.exe`，单文件、无控制台。

---

## 安装与卸载

管理员身份打开 PowerShell：

```powershell
cd client\build
.\install-service.ps1      # 装：拷文件、建计划任务、写自启、收紧权限
.\uninstall-service.ps1    # 卸：停任务、杀进程、放开任务管理器、删目录
```

细节看 [docs/客户端安装与自启.md](../docs/客户端安装与自启.md)。

---

## 命令支持

客户端认这些命令（都从教师端下发）：

`screen_start` `screen_stop` `lock` `unlock` `shutdown` `reboot` `logout`
`message` `open_url` `open_app` `file_distribute` `screen_broadcast` `net_ban`

`unlock` 有个说明：Windows 不允许程序替人解锁。客户端只能提示，密码还得人在机器前敲。

---

## 依赖说明

`pycaw` 只用于音频检测，装不上不影响其他功能，音频那块会静默降级。

`pywin32` 用于服务、自启、进程保护。没有它，保护功能会退化但不会崩。

---

## 合规

这软件能看屏幕、能记文件。装之前请确认：

- 学生知道这件事
- 学校同意了
- 只在正常教学管理里用

---

© 2025 Ryokuryuneko · [AGPL-3.0](../LICENSE)
