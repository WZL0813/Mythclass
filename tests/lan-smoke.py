"""局域网直连与信任记录 —— 冒烟测试

跑之前先起一个干净的服务端（默认 127.0.0.1:3111）：

    cd Mythclass/server
    $env:PORT="3111"; $env:HOST="127.0.0.1"; node src/index.js

然后：

    cd Mythclass
    python tests/lan-smoke.py

验三件事：
  1. 信任记录：同一 IP 连满 3 次 → 记成信任 + 发配对密钥；密钥错了不认
  2. 局域网端口：认密钥、能跑命令、密钥不对直接断
  3. 服务端：客户端上报的内网 IP 存下来了；同一个出口 IP 判成同一局域网
"""

import json
import os
import socket
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CLIENT = REPO.parent / "Mythclass-Client"
if not CLIENT.exists():  # 两个仓库放一起的情况
    CLIENT = REPO / "client"

os.environ.setdefault("APPDATA", tempfile.mkdtemp(prefix="mythclass-lan-"))
sys.path.insert(0, str(CLIENT))

import requests  # noqa: E402

from mythclass import identity, lanport, trust  # noqa: E402

BASE = os.environ.get("MYTHCLASS_BASE", "http://127.0.0.1:3111")
passed = failed = 0


def check(name, ok, extra=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


print("=== 0. 取本机内网 IP ===")
ips = identity.local_ips()
print(f"  {ips}")
check("拿得到至少一个内网 IP", len(ips) >= 1, str(ips))
check("都是内网段", all(i.startswith(("10.", "172.", "192.168.")) for i in ips), str(ips))

print("\n=== 1. 信任记录 ===")
trust._save({})
ip = "192.168.31.111"
for i in range(1, 3):
    info = trust.record(ip, "老师")
    check(f"第 {i} 次：还没到阈值（{info['count']}/3）", info["trusted"] is False, str(info))
info = trust.record(ip, "老师")
check("第 3 次：记成信任了", info["trusted"] is True and info["just_trusted"] is True, str(info))
key = info["key"]
print(f"  发下来的配对密钥：{key}")
check("密钥是 32 位十六进制", len(key) == 32, key)
check("对的密钥能过", trust.check(ip, key) is True)
check("错的密钥过不了", trust.check(ip, "0" * 32) is False)
check("没记录的 IP 过不了", trust.check("192.168.31.200", key) is False)
check("describe() 能看出谁被信任", "已信任" in trust.describe(), trust.describe())

print("\n=== 2. 局域网端口 ===")
ran = []


def fake_command(command, args):
    ran.append((command, args))
    return True, f"假装执行了 {command}"


# 端口收到的对端 IP 是回环地址，所以密钥得发给这个 IP
trust.record("127.0.0.1", "老师")
trust.record("127.0.0.1", "老师")
loopkey = trust.record("127.0.0.1", "老师")["key"]

port = 26999
lan = lanport.LanPort(trust=trust, on_command=fake_command, log=lambda m: None, port=port)
check("端口开起来了", lan.start() is True)
check("端口状态可读", "开着" in lan.status(), lan.status())


def talk(lines, wait=0.4):
    s = socket.create_connection(("127.0.0.1", port), timeout=5)
    s.settimeout(2)
    replies = []
    try:
        for line in lines:
            s.sendall((json.dumps(line, ensure_ascii=False) + "\n").encode("utf-8"))
            time.sleep(wait)
            try:
                buf = b""
                while not buf.endswith(b"\n"):
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    buf += chunk
                if buf.strip():
                    replies.append(json.loads(buf.decode("utf-8").strip()))
            except socket.timeout:
                pass
            except (ConnectionAbortedError, ConnectionResetError, OSError):
                break
    finally:
        s.close()
    return replies


good = talk([
    {"type": "hello", "key": loopkey, "name": "老师的笔记本"},
    {"type": "ping"},
    {"type": "command", "command": "lock", "args": {}},
])
print(f"  对的密钥：{[r.get('type') for r in good]}")
check("握手通过", bool(good) and good[0].get("ok") is True, str(good[:1]))
check("ping 有 pong", any(r.get("type") == "pong" for r in good), str(good))
check("命令执行了", any(r.get("type") == "result" and r.get("ok") for r in good), str(good))
check("命令真的到了处理函数", any(c == "lock" for c, _ in ran), str(ran))

bad = talk([{"type": "hello", "key": "0" * 32, "name": "冒充的"}])
check("错密钥被拒", bool(bad) and bad[0].get("ok") is False, str(bad[:1]))
check("错密钥不会执行任何命令", len([c for c, _ in ran if c != "lock"]) == 0, str(ran))

lan.stop()
check("端口能关", lan.running is False)

print("\n=== 3. 服务端：内网 IP 与同局域网判定 ===")
# 用 X-Forwarded-For 精确模拟两台机器的出口 IP（服务端就是这么取真实 IP 的）
uid = f"MYTH-LAN-{int(time.time()) % 100000}-TEST"
same = {"X-Forwarded-For": "203.0.113.9"}
other = {"X-Forwarded-For": "203.0.113.77"}

reg = requests.post(
    f"{BASE}/api/client/register",
    json={"clientUid": uid, "name": "同网段测试机", "os": "Windows", "version": "test", "localIps": ips},
    headers=same,
    timeout=15,
)
check("客户端注册成功", reg.status_code == 200, f"{reg.status_code} {reg.text[:120]}")

teacher = requests.post(
    f"{BASE}/api/auth/register",
    json={"username": f"lan{int(time.time()) % 100000}", "password": "pass1234"},
    timeout=15,
).json()
headers = {"Authorization": f"Bearer {teacher.get('token')}"}
bound = requests.post(f"{BASE}/api/auth/bind", json={"clientUid": uid}, headers=headers, timeout=15).json()
check("老师绑定成功", bound.get("ok") is True, str(bound)[:160])
time.sleep(0.3)

listed = requests.get(f"{BASE}/api/auth/clients", headers={**headers, **same}, timeout=15).json()
mine = [c for c in listed.get("clients", []) if c.get("clientUid") == uid]
check("列表里能找到这台机器", len(mine) == 1, str(listed)[:160])
if mine:
    c = mine[0]
    print(f"  上报的 localIps：{c.get('localIps')}")
    print(f"  老师出口 IP：{listed.get('myIp')} → sameNetwork={c.get('sameNetwork')}")
    check("服务端记住了客户端上报的内网 IP", set(c.get("localIps") or []) == set(ips), str(c.get("localIps")))
    check("带着自己的出口 IP 一起返回", listed.get("myIp") == "203.0.113.9", str(listed.get("myIp")))
    check("同一个出口 IP → 判为同一局域网", c.get("sameNetwork") is True, str(c.get("sameNetwork")))

    far = requests.get(f"{BASE}/api/auth/clients", headers={**headers, **other}, timeout=15).json()
    farc = [c for c in far.get("clients", []) if c.get("clientUid") == uid]
    if farc:
        print(f"  换成另一个出口 IP：{far.get('myIp')} → sameNetwork={farc[0].get('sameNetwork')}")
        check("不同出口 IP → 不在同一局域网", farc[0].get("sameNetwork") is False, str(farc[0].get("sameNetwork")))

print(f"\n通过 {passed} 项，失败 {failed} 项")
sys.exit(0 if failed == 0 else 1)
