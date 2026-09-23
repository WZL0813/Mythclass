"""客户端 WebSocket 实现冒烟测试

验证 mythclass.api.SocketClient 自己实现的 Engine.IO v4 帧能不能跟服务端对上话。

用法：
    cd server && set PORT=3111 && node src/index.js     # 另开一个窗口
    python tests/client-ws-smoke.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "client"))

from mythclass.api import SocketClient  # noqa: E402

HOST = "127.0.0.1:3111"
BASE = f"http://{HOST}"
WS = f"ws://{HOST}"

passed = 0
failed = 0


def check(name: str, ok: bool, extra: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def main() -> int:
    stamp = str(int(time.time()))[-6:]

    teacher = requests.post(
        f"{BASE}/api/auth/register",
        json={"username": f"pyteacher{stamp}", "password": "pass1234"},
        timeout=10,
    ).json()

    uid = f"MYTH-PY{stamp[-4:]}-AAAA-BBBB"
    client = requests.post(
        f"{BASE}/api/client/register",
        json={"clientUid": uid, "name": "Python 测试机", "os": "Windows", "version": "1.0.0"},
        timeout=10,
    ).json()
    client_id = client["client"]["id"]

    requests.post(
        f"{BASE}/api/auth/bind",
        json={"clientUid": uid},
        headers={"Authorization": f"Bearer {teacher['token']}"},
        timeout=10,
    )

    teacher_events: list = []
    client_events: list = []

    teacher_sock = SocketClient(WS, teacher["token"], lambda e, p: teacher_events.append((e, p)))
    client_sock = SocketClient(WS, client["token"], lambda e, p: client_events.append((e, p)))

    print("== 连接 ==")
    teacher_sock.start()
    client_sock.start()
    time.sleep(3)
    check("teacher connected", teacher_sock.connected)
    check("client connected", client_sock.connected)
    check(
        "presence pushed on connect",
        any(event == "client:presence" for event, _ in teacher_events),
        str(teacher_events),
    )

    print("== 双向事件 ==")
    teacher_sock.emit("watch", {"clientId": client_id})
    time.sleep(1)
    teacher_sock.emit("command", {"clientId": client_id, "command": "lock", "args": {}, "requestId": "py1"})
    time.sleep(2)
    commands = [payload for event, payload in client_events if event == "command"]
    check("client got command", bool(commands), str(client_events))
    check("command payload intact", bool(commands) and commands[0].get("command") == "lock")

    client_sock.emit("command_result", {"requestId": "py1", "command": "lock", "ok": True, "output": "已锁屏"})
    time.sleep(2)
    results = [payload for event, payload in teacher_events if event == "command_result"]
    check("teacher got command_result", bool(results), str(teacher_events))
    check("result payload intact", bool(results) and results[0].get("output") == "已锁屏")

    teacher_events.clear()
    client_sock.emit("screen_frame", {"data": "data:image/jpeg;base64,ZZZ", "width": 1280, "height": 720, "ts": 1})
    time.sleep(2)
    check("screen_frame relayed", any(event == "screen_frame" for event, _ in teacher_events), str(teacher_events))

    print("== 心跳 ==")
    client_events.clear()
    client_sock.emit("heartbeat")
    time.sleep(3)
    check("heartbeat:ack received", any(event == "heartbeat:ack" for event, _ in client_events), str(client_events))

    print("== 断线重连 ==")
    client_sock.stop()
    time.sleep(2)
    check("reports disconnected", client_sock.connected is False)
    client_sock.start()
    time.sleep(4)
    check("reconnected", client_sock.connected)

    teacher_sock.stop()
    client_sock.stop()

    print("")
    print(f"通过 {passed} 项，失败 {failed} 项")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
